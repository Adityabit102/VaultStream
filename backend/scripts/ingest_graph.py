"""One-off batch load of VaultStream's existing IEEE-CIS data into Neo4j, then
fraud-ring detection, then a committed JSON snapshot for the API to serve.

This is not a new ETL pipeline. It reads the same `data/raw` CSVs the existing
model was trained on, scores them with the existing XGBoost artifact and the
existing label encoders, and writes a graph. The streaming pipeline, the feature
store and the PySpark batch job are untouched and unaware of it.

    # graph db up first:  docker compose up -d neo4j
    cd backend && python scripts/ingest_graph.py --limit 200000

    --limit N       transactions to read (0 = all 590,540). Default 200,000,
                    which keeps peak memory near 1 GB.
    --reset         wipe Account/Device/Card/Address nodes before loading
    --detect-only   skip ingestion, re-run detection on what is already loaded
    --min-shared N  identifiers two accounts must share to be linked (default 2)
    --max-degree N  above this an identifier is a supernode and is ignored

Outputs `backend/graph/snapshot/fraud_rings.json`, which is what production
serves — Render runs no Neo4j.
"""
import argparse
import datetime as dt
import json
import os
import sys
import time

import joblib
import numpy as np
import pandas as pd

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
sys.path.insert(0, BACKEND_DIR)
sys.path.insert(0, os.path.join(BACKEND_DIR, "ml"))

from graph import client, cypher  # noqa: E402
from graph.schema import (  # noqa: E402
    DEFAULT_MAX_IDENTIFIER_DEGREE,
    DEFAULT_MIN_KINDS,
    DEFAULT_MIN_RING_SIZE,
    DEFAULT_MIN_SHARED,
    GDS_GRAPH_NAME,
    IDENTIFIER_RELS,
)
from graph.service import SNAPSHOT_PATH, _ring_from_record  # noqa: E402

DATA_DIR = os.path.join(PROJECT_ROOT, "data", "raw")
ENCODER_DIR = os.path.join(BACKEND_DIR, "ml", "encoders")
MODEL_PATH = os.path.join(BACKEND_DIR, "models", "fraud_model.pkl")
METADATA_PATH = os.path.join(BACKEND_DIR, "models", "model_metadata.json")

BATCH = 5000


def log(msg: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# 1. Load + score, reusing the existing model artifact and encoders
# ---------------------------------------------------------------------------
def load_scored_frame(limit: int) -> pd.DataFrame:
    tx_path = os.path.join(DATA_DIR, "train_transaction.csv")
    id_path = os.path.join(DATA_DIR, "train_identity.csv")
    if not os.path.exists(tx_path):
        raise FileNotFoundError(
            f"{tx_path} not found. The IEEE-CIS CSVs are gitignored — download them "
            "into data/raw before running the graph ingest."
        )

    log(f"Reading transactions (limit={limit or 'all'})…")
    tx = pd.read_csv(tx_path, nrows=limit or None)
    ident = pd.read_csv(id_path) if os.path.exists(id_path) else None
    if ident is not None:
        tx = tx.merge(ident, on="TransactionID", how="left")
        del ident
    log(f"Loaded {len(tx):,} transactions, {len(tx.columns)} columns")

    from feature_engineering import engineer_features

    log("Engineering features (same code path as training)…")
    df = engineer_features(tx)

    log("Scoring with the existing XGBoost model…")
    df["risk"] = score_frame(df)
    log(f"Scored. mean risk={df['risk'].mean():.4f}  fraud rate={df['isFraud'].mean():.4f}")
    return df


def score_frame(df: pd.DataFrame) -> np.ndarray:
    """Per-transaction fraud probability from the existing model artifact.

    Falls back to the dataset's own isFraud label if the model or its metadata
    is missing, so the graph still carries a real risk signal rather than zeros.
    """
    if not (os.path.exists(MODEL_PATH) and os.path.exists(METADATA_PATH)):
        log("WARNING: model artifact missing — using isFraud labels as the risk signal")
        return df["isFraud"].astype(float).to_numpy()

    model = joblib.load(MODEL_PATH)
    with open(METADATA_PATH) as fh:
        features = json.load(fh)["features"]

    X = pd.DataFrame(index=df.index)
    for col in features:
        enc_path = os.path.join(ENCODER_DIR, f"{col}_encoder.pkl")
        if os.path.exists(enc_path):
            # Categorical: map through the encoder fitted at training time.
            enc = joblib.load(enc_path)
            values = df[col].fillna("unknown").astype(str) if col in df.columns else pd.Series(
                "unknown", index=df.index
            )
            lookup = {c: i for i, c in enumerate(enc.classes_)}
            fallback = lookup.get("unknown", 0)
            X[col] = values.map(lookup).fillna(fallback).astype(np.int32)
        else:
            X[col] = pd.to_numeric(df[col], errors="coerce") if col in df.columns else np.nan

    X = X.fillna(-999)
    out = np.empty(len(X), dtype=np.float32)
    for start in range(0, len(X), 50_000):  # chunked to keep peak memory flat
        chunk = X.iloc[start : start + 50_000]
        out[start : start + 50_000] = model.predict_proba(chunk)[:, 1]
    return out


# ---------------------------------------------------------------------------
# 2. Derive graph entities from the scored frame
# ---------------------------------------------------------------------------
def _clean(series: pd.Series) -> pd.Series:
    """Normalise an identifier column to a string, blanking missing values."""
    return series.astype("object").where(series.notna(), "").astype(str).str.strip()


def build_entities(df: pd.DataFrame):
    """Return (accounts_df, identifiers, edges) derived from real columns.

    Account identity is card1 + addr1 + card-open-day (the Kaggle "UID"
    heuristic) — IEEE-CIS has no account column. See graph/schema.py.
    """
    log("Deriving entities…")
    df = df.copy()
    df["day"] = (df["TransactionDT"] // 86400).astype(int)

    # Rows with no card1 have no identity to anchor on at all — drop them first
    # so every derived column below is computed on the same index.
    df = df[_clean(df["card1"]) != ""].copy()
    card1, addr1 = _clean(df["card1"]), _clean(df["addr1"])
    df["account"] = "acct_" + card1 + "_" + addr1.replace("", "na")

    # --- identifier keys -------------------------------------------------
    dev_type, dev_info = _clean(df["DeviceType"]), _clean(df["DeviceInfo"])
    dev_type = dev_type.replace("unknown", "")
    dev_info = dev_info.replace("unknown", "")
    df["Device"] = np.where(dev_info != "", "dev_" + dev_type + "|" + dev_info, "")
    df["Device_label"] = np.where(dev_info != "", dev_info + " (" + dev_type + ")", "")

    card_parts = [_clean(df[c]) for c in ("card1", "card2", "card3", "card4", "card5", "card6")]
    df["Card"] = "card_" + card_parts[0]
    for part in card_parts[1:]:
        df["Card"] = df["Card"] + "|" + part
    df["Card_label"] = card_parts[3].replace("", "card") + " ••••" + card_parts[0].str[-4:] + " " + card_parts[5]

    addr2 = _clean(df["addr2"])
    df["Address"] = np.where(addr1 != "", "addr_" + addr1 + "|" + addr2, "")
    df["Address_label"] = np.where(addr1 != "", "addr " + addr1 + " / " + addr2.replace("", "—"), "")

    # --- account aggregates ---------------------------------------------
    # card1/addr1 ride along on the node so detection can reject pairs that
    # differ only by the D1-derived open day (see graph/schema.py).
    df["_card1"], df["_addr1"] = card1, addr1
    accounts = df.groupby("account").agg(
        card1=("_card1", "first"),
        addr1=("_addr1", "first"),
        transactions=("TransactionID", "count"),
        fraud_transactions=("isFraud", "sum"),
        avg_risk=("risk", "mean"),
        max_risk=("risk", "max"),
        total_amount=("TransactionAmt", "sum"),
        first_seen_day=("day", "min"),
        last_seen_day=("day", "max"),
    ).reset_index()
    log(f"  {len(accounts):,} accounts")

    identifiers, edges = {}, {}
    for label in IDENTIFIER_RELS:
        sub = df[df[label] != ""]
        pairs = sub.groupby([label, "account"]).size().reset_index(name="transactions")
        degree = pairs.groupby(label)["account"].nunique()
        labels = sub.groupby(label)[f"{label}_label"].first()
        identifiers[label] = pd.DataFrame(
            {"id": degree.index, "degree": degree.values, "label": labels.reindex(degree.index).values}
        )
        edges[label] = pairs.rename(columns={label: "identifier"})
        log(f"  {len(identifiers[label]):,} {label} nodes, {len(edges[label]):,} edges")

    return accounts, identifiers, edges


# ---------------------------------------------------------------------------
# 3. Write to Neo4j
# ---------------------------------------------------------------------------
def write_batches(session, query: str, rows: list, what: str) -> None:
    total = len(rows)
    for start in range(0, total, BATCH):
        session.run(query, rows=rows[start : start + BATCH])
        if start and start % (BATCH * 20) == 0:
            log(f"    {what}: {start:,}/{total:,}")
    log(f"  wrote {total:,} {what}")


def ingest(driver, accounts, identifiers, edges, reset: bool) -> None:
    from graph.client import NEO4J_DATABASE

    with driver.session(database=NEO4J_DATABASE) as session:
        for stmt in cypher.CONSTRAINTS:
            session.run(stmt)
        if reset:
            log("Resetting graph nodes…")
            session.run(cypher.RESET_PLAIN)

        log("Writing accounts…")
        acct_rows = accounts.to_dict("records")
        for row in acct_rows:
            row["id"] = row.pop("account")
            row["card1"] = str(row["card1"])
            row["addr1"] = str(row["addr1"])
            row["transactions"] = int(row["transactions"])
            row["fraud_transactions"] = int(row["fraud_transactions"])
            row["avg_risk"] = float(row["avg_risk"])
            row["max_risk"] = float(row["max_risk"])
            row["total_amount"] = float(row["total_amount"])
            row["first_seen_day"] = int(row["first_seen_day"])
            row["last_seen_day"] = int(row["last_seen_day"])
        write_batches(session, cypher.MERGE_ACCOUNTS, acct_rows, "accounts")

        for label, rel in IDENTIFIER_RELS.items():
            log(f"Writing {label} nodes…")
            rows = [
                {"id": r["id"], "degree": int(r["degree"]), "props": {"label": str(r["label"])}}
                for r in identifiers[label].to_dict("records")
            ]
            write_batches(session, cypher.MERGE_IDENTIFIERS % {"label": label}, rows, f"{label} nodes")

            log(f"Writing {rel} edges…")
            erows = [
                {"account": r["account"], "identifier": r["identifier"], "transactions": int(r["transactions"])}
                for r in edges[label].to_dict("records")
            ]
            write_batches(
                session, cypher.MERGE_EDGES % {"label": label, "rel": rel}, erows, f"{rel} edges"
            )


# ---------------------------------------------------------------------------
# 4. Detect rings — shared-identifier clustering, then WCC, then Louvain
# ---------------------------------------------------------------------------
def detect(driver, min_shared: int, min_kinds: int, max_degree: int, min_ring_size: int, limit: int) -> dict:
    from graph.client import NEO4J_DATABASE

    with driver.session(database=NEO4J_DATABASE) as session:
        log("Linking accounts that share identifiers…")
        session.run(cypher.DROP_SHARED_LINKS)
        t0 = time.time()
        session.run(cypher.LINK_SHARED_IDENTIFIERS, maxDegree=max_degree)
        rec = session.run(
            cypher.AGGREGATE_SHARED_LINKS, minShared=min_shared, minKinds=min_kinds
        ).single()
        links = rec["links"] if rec else 0
        session.run(cypher.DROP_CANDIDATE_LINKS)
        log(f"  {links:,} account-to-account links in {time.time() - t0:.1f}s")

        if not links:
            log("No shared-identifier links found — nothing to cluster.")
            return {"rings": [], "stats": {}, "algorithms": {}}

        try:
            session.run(cypher.GDS_DROP, name=GDS_GRAPH_NAME)
        except Exception:
            pass  # first run: nothing to drop

        log("Projecting graph into GDS…")
        proj = session.run(cypher.GDS_PROJECT, name=GDS_GRAPH_NAME).single()
        log(f"  projected {proj['nodes']:,} nodes / {proj['rels']:,} relationships")

        log("Running Weakly Connected Components…")
        wcc = session.run(cypher.GDS_WCC, name=GDS_GRAPH_NAME).single()
        log(f"  {wcc['componentCount']:,} components")

        log("Running Louvain for sub-community structure…")
        louvain = session.run(cypher.GDS_LOUVAIN, name=GDS_GRAPH_NAME).single()
        log(f"  {louvain['communityCount']:,} communities, modularity={louvain['modularity']:.4f}")

        session.run(cypher.GDS_DROP, name=GDS_GRAPH_NAME)

        log("Fetching rings…")
        t0 = time.time()
        rows = [
            dict(r)
            for r in session.run(
                cypher.FETCH_RINGS, minRingSize=min_ring_size, maxDegree=max_degree, limit=limit
            )
        ]
        log(f"  {len(rows)} rings in {time.time() - t0:.1f}s")
        stats_row = session.run(cypher.GRAPH_STATS).single()

        return {
            "rings": [_ring_from_record(r) for r in rows],
            "stats": {k: int(v or 0) for k, v in dict(stats_row).items()} if stats_row else {},
            "algorithms": {
                "components": wcc["componentCount"],
                "communities": louvain["communityCount"],
                "modularity": round(float(louvain["modularity"]), 4),
                "account_links": links,
            },
        }


def write_snapshot(result: dict, params: dict) -> None:
    os.makedirs(os.path.dirname(SNAPSHOT_PATH), exist_ok=True)
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "snapshot",
        "params": params,
        "stats": result.get("stats", {}),
        "algorithms": result.get("algorithms", {}),
        "rings": result.get("rings", []),
    }
    with open(SNAPSHOT_PATH, "w") as fh:
        json.dump(payload, fh, indent=1)
    size_kb = os.path.getsize(SNAPSHOT_PATH) / 1024
    log(f"Snapshot written: {SNAPSHOT_PATH} ({size_kb:.0f} KB, {len(payload['rings'])} rings)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=200_000, help="transactions to read (0 = all)")
    ap.add_argument("--reset", action="store_true", help="wipe graph nodes first")
    ap.add_argument("--detect-only", action="store_true", help="skip ingestion")
    ap.add_argument("--min-shared", type=int, default=DEFAULT_MIN_SHARED)
    ap.add_argument("--min-kinds", type=int, default=DEFAULT_MIN_KINDS,
                    help="distinct identifier kinds a link must span")
    ap.add_argument("--max-degree", type=int, default=DEFAULT_MAX_IDENTIFIER_DEGREE)
    ap.add_argument("--min-ring-size", type=int, default=DEFAULT_MIN_RING_SIZE)
    ap.add_argument("--top", type=int, default=40, help="rings to keep in the snapshot")
    args = ap.parse_args()

    driver = client.get_driver(force=True)
    if driver is None:
        log("ERROR: cannot reach Neo4j. Start it with: docker compose up -d neo4j")
        return 1

    started = time.time()
    if not args.detect_only:
        df = load_scored_frame(args.limit)
        accounts, identifiers, edges = build_entities(df)
        del df
        ingest(driver, accounts, identifiers, edges, reset=args.reset)

    result = detect(
        driver, args.min_shared, args.min_kinds, args.max_degree, args.min_ring_size, args.top
    )
    # transactions_scanned comes from the graph, not from --limit: on a
    # --detect-only run the flag describes nothing that happened.
    write_snapshot(
        result,
        {
            "transactions_scanned": result.get("stats", {}).get("transactions", 0),
            "min_shared_identifiers": args.min_shared,
            "min_shared_kinds": args.min_kinds,
            "max_identifier_degree": args.max_degree,
            "min_ring_size": args.min_ring_size,
        },
    )
    log(f"Done in {time.time() - started:.1f}s")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

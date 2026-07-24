"""Generate a small IEEE-CIS-shaped sample dataset so the pipeline runs anywhere.

The real IEEE-CIS CSVs are ~677 MB and git-ignored. This produces schema-
compatible `train_transaction.csv` + `train_identity.csv` (same column names the
pipeline expects) at a fraction of the size, so `run_pipeline.py` works with no
external data download. Point the pipeline at the real CSVs by setting
VAULTSTREAM_RAW_DIR when you have them.

It deliberately seeds the data with the exact conditions the DQ layer checks for
(a few duplicate transaction ids, some null amounts/accounts, orphan identity
rows) so the Silver DQ report has something real to catch.

Usage:
    python -m batch_pipeline.generate_sample_data --rows 5000 --out batch_pipeline/sample_data
"""
from __future__ import annotations

import argparse
import csv
import os
import random

# Realistic-ish categorical vocabularies (a subset of the real IEEE-CIS values).
PRODUCT_CDS = ["W", "C", "R", "H", "S"]
EMAIL_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "anonymous.com", "aol.com"]
DEVICE_TYPES = ["desktop", "mobile"]
DEVICE_INFOS = ["Windows", "iOS", "MacOS", "Android", "SAMSUNG", "Trident/7.0", "Linux"]
CARD4 = ["visa", "mastercard", "discover", "american express"]
CARD6 = ["debit", "credit"]


def _rng(seed: int) -> random.Random:
    return random.Random(seed)


def generate(rows: int, out_dir: str, seed: int = 7) -> tuple[str, str]:
    rng = _rng(seed)
    os.makedirs(out_dir, exist_ok=True)
    tx_path = os.path.join(out_dir, "train_transaction.csv")
    id_path = os.path.join(out_dir, "train_identity.csv")

    # A bounded pool of accounts so velocity windows actually have repeat activity.
    n_accounts = max(20, rows // 25)
    accounts = [10000 + i for i in range(n_accounts)]
    # Each account has a "home" device; fraud rings shift devices.
    home_device = {a: rng.randrange(len(DEVICE_INFOS)) for a in accounts}

    tx_fields = [
        "TransactionID", "isFraud", "TransactionDT", "TransactionAmt",
        "ProductCD", "card1", "card4", "card6", "P_emaildomain", "R_emaildomain",
    ]
    id_fields = ["TransactionID", "DeviceType", "DeviceInfo", "id_01", "id_31"]

    identity_rows: list[dict] = []
    base_dt = 86400  # IEEE-CIS TransactionDT starts ~1 day in.

    with open(tx_path, "w", newline="") as ftx:
        w = csv.DictWriter(ftx, fieldnames=tx_fields)
        w.writeheader()

        dt = base_dt
        for i in range(rows):
            txid = 2987000 + i
            account = rng.choice(accounts)
            # Bursty arrival: sometimes cluster many txns close together (velocity).
            dt += rng.choice([2, 5, 12, 40, 300, 3600, 7200])

            is_fraud = 0
            amount = round(rng.lognormvariate(3.6, 0.9), 2)
            device_idx = home_device[account]

            roll = rng.random()
            if roll < 0.07:
                # velocity fraud: rapid-fire, elevated amount
                is_fraud = 1
                dt += rng.choice([1, 2, 3])
                amount = round(rng.lognormvariate(4.4, 1.0), 2)
            elif roll < 0.11:
                # account-takeover fraud: device shift + high amount
                is_fraud = 1
                device_idx = rng.randrange(len(DEVICE_INFOS))
                amount = round(rng.lognormvariate(6.6, 0.8), 2)

            # --- DQ seeding: inject a controlled amount of dirtiness ---
            amount_out: object = amount
            card1_out: object = account
            if rng.random() < 0.004:            # ~0.4% null amount
                amount_out = ""
            if rng.random() < 0.008:            # ~0.8% null account
                card1_out = ""

            row = {
                "TransactionID": txid,
                "isFraud": is_fraud,
                "TransactionDT": dt,
                "TransactionAmt": amount_out,
                "ProductCD": rng.choice(PRODUCT_CDS),
                "card1": card1_out,
                "card4": rng.choice(CARD4),
                "card6": rng.choice(CARD6),
                # Payer email domain doubles as the merchant proxy (see config).
                "P_emaildomain": rng.choice(EMAIL_DOMAINS),
                "R_emaildomain": rng.choice(EMAIL_DOMAINS + [""]),  # legitimately sparse
            }
            w.writerow(row)

            # ~72% of transactions have an identity record (matches IEEE-CIS sparsity).
            if rng.random() < 0.72:
                identity_rows.append({
                    "TransactionID": txid,
                    "DeviceType": rng.choice(DEVICE_TYPES),
                    "DeviceInfo": DEVICE_INFOS[device_idx],
                    "id_01": round(rng.uniform(-100, 0), 1),
                    "id_31": rng.choice(["chrome 65.0", "mobile safari 11.0", "ie 11.0 for desktop", ""]),
                })

            # DQ seeding: a couple of exact duplicate transaction rows.
            if rng.random() < 0.002:
                w.writerow(row)

    # DQ seeding: a few orphan identity rows (identity with no transaction).
    for k in range(max(2, rows // 2000)):
        identity_rows.append({
            "TransactionID": 9990000 + k,
            "DeviceType": rng.choice(DEVICE_TYPES),
            "DeviceInfo": rng.choice(DEVICE_INFOS),
            "id_01": 0.0,
            "id_31": "",
        })

    with open(id_path, "w", newline="") as fid:
        w = csv.DictWriter(fid, fieldnames=id_fields)
        w.writeheader()
        for r in identity_rows:
            w.writerow(r)

    print(f"Wrote {rows} transactions -> {tx_path}")
    print(f"Wrote {len(identity_rows)} identity rows -> {id_path}")
    return tx_path, id_path


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Generate IEEE-CIS-shaped sample data.")
    ap.add_argument("--rows", type=int, default=5000)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample_data"))
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    generate(args.rows, args.out, args.seed)

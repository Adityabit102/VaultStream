# Databricks run — manual steps runbook

Everything a machine could automate has been automated and **actually run locally**
(real Spark + Delta + Airflow — see `RUN_EVIDENCE.md`). What's left are the steps
that require a browser, a human, and a Databricks account. This is the exact
click-path.

> **Honesty note on "large-scale":** the real IEEE-CIS transaction file is 652 MB /
> **590,540 rows / 13,553 accounts / 182 days**. That's a *real production fraud
> dataset with real cardinality and skew* — but it is **not** big-data-by-volume;
> it fits comfortably on a single Databricks node. Claim "real-world fraud dataset
> at full cardinality," not "terabyte-scale."

---

## 0. What you're proving by doing this

Running it here makes two resume claims honest that local runs cannot:
- **Databricks** — a real managed Spark cluster, not local mode.
- **Delta Lake on cloud storage** — Delta tables on DBFS/Volumes, with
  `DESCRIBE HISTORY` proving ACID commits.

---

## 1. Sign up (5 min)

Databricks' current free tier is **Free Edition** (serverless) at
<https://www.databricks.com/learn/free-edition>. The older **Community Edition**
(classic single-node cluster) may still be available at
<https://community.cloud.databricks.com>.

- **Free Edition** → you get managed *serverless* compute; there is **no cluster to
  create** (skip §2, compute "just runs").
- **Community Edition** → you create one small cluster yourself (§2).

Either works for this dataset. Exact button labels shift between editions/releases;
the concepts below are stable.

---

## 2. Create a cluster — *Community Edition only* (2 min)

Compute → **Create compute** →
- Runtime: **DBR 14.3 LTS** or newer (includes Spark 3.5 + Delta — matches what we
  ran locally).
- Node: the single default node CE gives you (~15 GB) is **plenty** — at 590k rows
  even the hottest account's window (see below) fits in memory.
- Leave everything else default → **Create**.

**Cluster sizing rationale (data-grounded):** median account = 4 transactions,
p99 = 786, and the single hottest `card1` has 14,932 lifetime transactions. The one
scaling risk is the **unbounded expanding z-score window in `gold.py`** (see
`WINDOW_FUNCTION_NOTE.md`): that hot account builds a per-partition frame up to
14,932 rows. On one node that's trivial; the note matters more if you later run
this at true scale. No special Spark config needed for CE.

---

## 3. Get the code onto the workspace (5 min)

**Option A — Git Repos (cleanest).** Repos → **Add Repo** → paste this repo's URL →
Clone. The code lands at `/Workspace/Repos/<you>/VaultStream`.

**Option B — upload a zip (works everywhere, incl. no-git).**
```bash
# on your laptop:
cd /Users/aditya/Downloads/VaultStream
zip -r batch_pipeline.zip batch_pipeline -x '*/warehouse*/*' '*/sample_data/*' '*/__pycache__/*'
```
Then in the workspace: **Catalog → Volumes** (Free Edition) or **DBFS → FileStore**
(CE) → **Upload** `batch_pipeline.zip`, and unzip it from a notebook cell:
```python
%sh cd /Volumes/main/vaultstream/code && unzip -o batch_pipeline.zip   # adjust path
```

---

## 4. Upload the real IEEE-CIS files (10 min — they're 652 MB + 25 MB)

Upload `data/raw/train_transaction.csv` and `data/raw/train_identity.csv` to the
**same folder**, e.g. a Volume `/Volumes/main/vaultstream/raw` (Free Edition) or
`dbfs:/vaultstream/raw` (CE). The browser uploader handles the 652 MB file; if it
balks, use the Databricks CLI: `databricks fs cp train_transaction.csv dbfs:/vaultstream/raw/`.

---

## 5. Run the pipeline (2 min of clicking, ~1–3 min compute)

Import **`batch_pipeline/databricks/vaultstream_medallion_notebook.py`** as a
notebook (Workspace → Import → File). It's already written as Databricks cells.

Edit the **three path constants** in cells 1–2 to match where you put things:
- `CODE_PARENT` → parent folder of `batch_pipeline/` (§3)
- `VAULTSTREAM_RAW_DIR` → where the CSVs are (§4)
- `VAULTSTREAM_BATCH_ROOT` → any writable Delta location, e.g. `dbfs:/vaultstream/warehouse`

Attach the notebook to your cluster/serverless compute and **Run all**. The cells:
1. put the code on `sys.path`,
2. set the env-driven paths,
3. `confirm_delta(...)` — **asserts Delta is active** (fails loudly if it somehow fell back to Parquet),
4. run `bronze → silver → gold → export` (DQ gate in silver),
5. `display()` the Gold fact table + `DESCRIBE HISTORY` (your ACID proof).

---

## 6. Capture the evidence for the resume claim

Screenshot / save:
- the `STORAGE FORMAT ACTIVE = delta ... databricks=True` log line,
- the `DESCRIBE HISTORY` output on `gold/fact_transactions`,
- the Gold row count on the **real** 590,540-row input (Silver/Gold row counts in
  the stage output).

That's the difference between "portable to Databricks" and "ran on Databricks."

---

## Why this part isn't automated

Databricks account creation requires email verification and accepting terms; there
is no unattended path to a free workspace, and no API token exists until *after* a
human signs in. So §1 and the browser uploads (§3–4) are irreducibly manual. Once
you have a workspace + token, the run itself (§5) is the notebook above — no
debugging, because the identical code already ran end-to-end locally on Spark+Delta.

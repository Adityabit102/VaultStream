# Window-function scaling decision — expanding z-score in `gold.py`

**Status: DECIDED — Option B (leave unbounded, observe on cluster). `gold.py`
keeps the unbounded window; a comment there records this decision and the bound-it
plan for future scale. This note is kept as the rationale of record.**

**Observed so far:** the full 590,540-row IEEE-CIS file (13,553 accounts, hottest
`card1` = 14,932 txns) ran through the unbounded window in **~33 s with no spill /
no OOM** on a single local JVM (`RUN_EVIDENCE.md` §5). At this dataset's scale the
unbounded frame is a non-issue; the Databricks run is the next place to observe it
on managed compute. Revisit only if pointed at ~100× volume.

## Current implementation (`batch_pipeline/gold.py`, `_add_features`)

```python
expanding = (
    Window.partitionBy("account_id")
    .orderBy(F.col("event_time_seconds"), F.col("transaction_id"))
    .rowsBetween(Window.unboundedPreceding, Window.currentRow)
)
...
.withColumn("_amt_mean", F.avg("amount").over(expanding))
.withColumn("_amt_std",  F.stddev_samp("amount").over(expanding))
...
.withColumn(
    "amount_zscore",
    F.when((F.col("_amt_std").isNotNull()) & (F.col("_amt_std") > 0),
           (F.col("amount") - F.col("_amt_mean")) / F.col("_amt_std")).otherwise(F.lit(0.0)),
)
```

It's an **unbounded** per-account frame: every transaction's z-score is computed
over *all* of that account's prior history.

## Why it's the scaling risk

The parity test proves this is **correct**; it says nothing about **scale**. On the
real IEEE-CIS data (measured, not guessed):

| metric | value |
|---|---|
| rows | 590,540 |
| distinct accounts (`card1`) | 13,553 |
| tx/account — median | 4 |
| tx/account — p99 | 786 |
| tx/account — **max (one hot account)** | **14,932** |
| max rows in any **30-day** window on that hot account | **3,289** |

Two failure modes at real scale:
1. **Key skew** — one `card1` holds 14,932 rows while the median holds 4. That one
   partition dominates the shuffle after `partitionBy("account_id")`.
2. **Unbounded frame growth** — the expanding aggregate's state grows with account
   history, so the hot account is the worst case for both memory and the running
   aggregate. It's fine on one node at 590k rows; it's the first thing that spills
   at 100×.

## Option A — bound to a 30-day rolling time window *(recommended)*

```python
z_window = (
    Window.partitionBy("account_id")
    .orderBy(F.col("event_time_seconds"))
    .rangeBetween(-2_592_000, 0)   # 30 days, in seconds
)
```

**Why 30 days specifically — this is the strong argument.** The real-time path's
Welford stats keys in Redis expire after `ex=2592000` seconds = **exactly 30 days**
(see `backend/api/predict.py` / `feature_store_consumer.py`). So the live z-score is
*already* a 30-day rolling statistic, not a lifetime one. Bounding the batch window
to 30 days therefore makes it **more faithful to the real-time feature**, not less —
the parity story gets *stronger*, and the hot-account frame drops from 14,932 →
3,289 rows and stops growing with account age.

- Pros: caps window state, tighter RT parity, kills the unbounded-growth mode.
- Cons: ties at the same `event_time_seconds` are all included (no row tiebreak
  possible with `rangeBetween`) — a negligible, arguably-more-correct difference;
  the parity test would need its z-score reference switched from expanding to
  30-day-windowed to keep asserting equality.
- Alternative sizing if you prefer a **row** bound over time: `rowsBetween(-499, 0)`
  (last 500 txns). Simpler, but 500 is arbitrary and doesn't match any RT semantic —
  I'd only use it if wall-clock windows are unavailable.

## Option B — leave it unbounded, observe real spill behavior on the cluster

Keep the current code and run it on Databricks against the full file specifically to
*watch* what happens — does the hot partition spill, how long does the stage take,
does it OOM. Useful precisely because "designed-for vs. actually-observed" is the
gap we're closing.

- Pros: you get a real, honest data point about the failure mode instead of
  pre-empting it; at 590k rows it will very likely just work, which is itself worth
  knowing.
- Cons: leaves a known unbounded operation in the code; if you later point this at a
  bigger source it's a latent problem.

## My recommendation

**Option A (30-day window), for one decisive reason beyond scaling:** it matches the
real-time path's 30-day Redis TTL, so it's the *more correct* parity implementation,
and the scaling benefit comes for free. I'd make the change **and** update the parity
test's z-score reference to a 30-day window so the equality assertion still holds.

But per your instruction I've left `gold.py` untouched — tell me A or B and I'll
apply it (A) or annotate the code with the observed-behavior plan (B).

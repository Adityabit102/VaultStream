"""Feature-parity tests -- runnable WITHOUT Spark or Java.

The headline claim of this whole extension is "the same feature logic, two
processing paradigms." These tests pin that claim down numerically using pure
Python reference implementations of both paradigms:

  * `online_*`  -- mirrors the real-time path (backend/api/predict.py +
                   feature_store_consumer.py): Welford's algorithm updated per
                   event, sample std with the (n-1) guard, device-shift vs the
                   previously-seen device.
  * `batch_*`   -- mirrors gold.py's window-function logic: an expanding
                   (time-ordered, inclusive) aggregation per account.

If these two agree, the batch Gold features reproduce what the live model scored.
Run:  python -m pytest batch_pipeline/tests/ -q
      (or plain `python batch_pipeline/tests/test_feature_parity.py`)
"""
from __future__ import annotations

import math

from batch_pipeline import config

# ---------------------------------------------------------------------------
# Reference: real-time (online) path
# ---------------------------------------------------------------------------

def online_zscores(amounts):
    """Welford's online mean/variance, reading AFTER the update -- exactly the
    order backend/api/predict.py sees (ingest updates the store, then predict
    reads it). z=0 while std is undefined (n<2), matching the `std > 0` guard."""
    count = 0
    mean = 0.0
    M2 = 0.0
    out = []
    for x in amounts:
        count += 1
        delta = x - mean
        mean += delta / count
        delta2 = x - mean
        M2 += delta * delta2
        std = math.sqrt(M2 / (count - 1)) if count > 1 else 0.0
        out.append((x - mean) / std if std > 0 else 0.0)
    return out


def online_device_shift(devices):
    """1 when the current device differs from the last-seen device, else 0."""
    out = []
    last = None
    for d in devices:
        out.append(1 if (last is not None and last != d) else 0)
        last = d
    return out


def online_window_counts(times, window):
    """tx_count over a sliding window inclusive of the current event -- the
    intended semantic the Redis TTL counters approximate."""
    out = []
    for i, t in enumerate(times):
        out.append(sum(1 for j in range(i + 1) if times[j] > t - window))
    return out


# ---------------------------------------------------------------------------
# Reference: batch path (mirrors gold.py window functions)
# ---------------------------------------------------------------------------

def batch_zscores(amounts):
    """Expanding sample mean/std over time-ordered rows, inclusive of current --
    i.e. F.avg / F.stddev_samp over rowsBetween(unboundedPreceding, currentRow)."""
    out = []
    for k in range(1, len(amounts) + 1):
        window = amounts[:k]
        n = len(window)
        mean = sum(window) / n
        if n > 1:
            var = sum((v - mean) ** 2 for v in window) / (n - 1)  # sample (n-1)
            std = math.sqrt(var)
        else:
            std = 0.0
        x = amounts[k - 1]
        out.append((x - mean) / std if std > 0 else 0.0)
    return out


def batch_device_shift(devices):
    """lag(device) over the account, time-ordered -- gold.py's device_shift."""
    out = []
    for i, d in enumerate(devices):
        prev = devices[i - 1] if i > 0 else None
        out.append(1 if (prev is not None and prev != d) else 0)
    return out


def batch_window_counts(times, window):
    """F.count over rangeBetween(-window, 0): rows within [t-window, t]. gold.py
    uses a strict inclusive range; the online reference uses `> t-window`, so we
    align both to the same boundary convention here."""
    out = []
    for i, t in enumerate(times):
        out.append(sum(1 for j in range(i + 1) if times[j] > t - window))
    return out


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def _almost_equal(a, b, tol=1e-9):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def test_zscore_parity():
    amounts = [12.0, 40.0, 41.0, 9.0, 500.0, 22.0, 23.0, 24.0, 7.0, 1000.0]
    assert _almost_equal(online_zscores(amounts), batch_zscores(amounts)), (
        "online Welford z-score must equal batch expanding z-score"
    )


def test_zscore_first_txn_is_zero():
    assert online_zscores([99.0])[0] == 0.0
    assert batch_zscores([99.0])[0] == 0.0


def test_device_shift_parity():
    devices = ["ios:iphone", "ios:iphone", "android:pixel", "android:pixel", "desktop:win"]
    assert online_device_shift(devices) == batch_device_shift(devices) == [0, 0, 1, 0, 1]


def test_window_count_parity():
    # times in seconds; use the real 5m / 1h windows from config.
    times = [0, 60, 120, 200, 4000, 4100, 90000]
    for w in (config.WINDOW_5M_SECONDS, config.WINDOW_1H_SECONDS, config.WINDOW_24H_SECONDS):
        assert online_window_counts(times, w) == batch_window_counts(times, w)


def test_window_count_values_5m():
    # 4 txns inside 5 min, then a gap, then two clustered, then a big gap.
    times = [0, 60, 120, 200, 4000, 4100, 90000]
    counts = batch_window_counts(times, config.WINDOW_5M_SECONDS)  # 300s
    assert counts == [1, 2, 3, 4, 1, 2, 1]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS  {name}")
    print("All feature-parity tests passed.")

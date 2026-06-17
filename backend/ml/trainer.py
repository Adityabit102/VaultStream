"""
Shared training engine for the Model Lab.

Trains fraud classifiers on a realistic *synthetic* transaction dataset so the
Lab is responsive and fully self-contained (no multi-GB raw CSVs required at
runtime — important for managed/serverless deployment). The full offline
IEEE-CIS pipeline still lives in ml/train.py.

Supports multiple algorithm families and returns rich evaluation metrics
(AUC, ROC curve, confusion matrix, feature importances) plus a tuned
decision threshold.
"""
import os
import time
import json
import uuid
import hashlib
from typing import Callable, Iterator, Optional

import numpy as np

FEATURE_NAMES = [
    "tx_count_5m",
    "tx_count_1h",
    "tx_count_24h",
    "avg_amount_1h",
    "amount",
    "unique_merchants_1h",
    "device_shift",
    "amount_zscore",
]

ALGORITHMS = {
    "xgboost": {
        "label": "XGBoost",
        "blurb": "Gradient-boosted trees — the production champion. Best raw AUC.",
        "hyperparams": {
            "n_estimators": {"label": "Trees", "default": 200, "min": 50, "max": 600, "step": 50},
            "max_depth": {"label": "Max depth", "default": 6, "min": 2, "max": 12, "step": 1},
            "learning_rate": {"label": "Learning rate", "default": 0.1, "min": 0.01, "max": 0.5, "step": 0.01},
        },
    },
    "random_forest": {
        "label": "Random Forest",
        "blurb": "Bagged decision trees — robust, low-variance baseline.",
        "hyperparams": {
            "n_estimators": {"label": "Trees", "default": 200, "min": 50, "max": 600, "step": 50},
            "max_depth": {"label": "Max depth", "default": 12, "min": 2, "max": 30, "step": 1},
        },
    },
    "logistic_regression": {
        "label": "Logistic Regression",
        "blurb": "Linear, fully interpretable — the explainability benchmark.",
        "hyperparams": {
            "C": {"label": "Inverse reg. (C)", "default": 1.0, "min": 0.01, "max": 10.0, "step": 0.01},
        },
    },
    "isolation_forest": {
        "label": "Isolation Forest",
        "blurb": "Unsupervised anomaly detection — catches novel fraud patterns.",
        "hyperparams": {
            "n_estimators": {"label": "Trees", "default": 200, "min": 50, "max": 600, "step": 50},
            "contamination": {"label": "Contamination", "default": 0.2, "min": 0.05, "max": 0.4, "step": 0.01},
        },
    },
}

LAB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "lab_runs")


def _synth_dataset(n: int, seed: int = 42):
    """Generate a realistic synthetic fraud dataset: safe + velocity + takeover fraud."""
    rng = np.random.default_rng(seed)
    n = max(400, min(int(n), 60000))
    n_fraud = int(n * 0.18)
    n_safe = n - n_fraud
    n_velocity = n_fraud // 2
    n_takeover = n_fraud - n_velocity

    def block(count, tx5, tx1, tx24, amt_mu, amt_sigma, shift_p, merch_mu):
        tx_5m = rng.poisson(tx5, count) + 1
        tx_1h = tx_5m + rng.poisson(tx1, count)
        tx_24h = tx_1h + rng.poisson(tx24, count)
        amount = rng.lognormal(amt_mu, amt_sigma, count)
        avg_1h = amount / np.maximum(tx_1h, 1) + rng.normal(0, 5, count)
        merch = rng.poisson(merch_mu, count) + 1
        shift = rng.binomial(1, shift_p, count)
        return np.column_stack([tx_5m, tx_1h, tx_24h, avg_1h, amount, merch, shift])

    # Populations deliberately overlap so the problem is non-trivial (real fraud
    # is never perfectly separable) — yields believable AUC in the 0.92–0.98 band.
    safe = block(n_safe, 0.6, 2.2, 6.5, 3.4, 0.9, 0.06, 3)
    velocity = block(n_velocity, 5.0, 14.0, 34.0, 4.2, 1.0, 0.45, 7)
    takeover = block(n_takeover, 1.4, 3.0, 7.0, 6.8, 0.9, 0.6, 4)

    X = np.vstack([safe, velocity, takeover])
    y = np.concatenate([np.zeros(n_safe), np.ones(n_velocity + n_takeover)])

    # Blur feature boundaries
    X = X + rng.normal(0, 0.12, X.shape) * np.abs(X)

    # Label noise (~4%) — mislabelled/ambiguous transactions
    flip = rng.random(len(y)) < 0.04
    y[flip] = 1 - y[flip]

    # amount_zscore (8th feature), computed globally
    amt = X[:, 4]
    zscore = (amt - amt.mean()) / (amt.std() + 1e-9)
    X = np.column_stack([X, zscore])

    # shuffle
    idx = rng.permutation(len(y))
    return X[idx], y[idx]


def _build_model(algorithm: str, hp: dict):
    if algorithm == "xgboost":
        from xgboost import XGBClassifier
        return XGBClassifier(
            n_estimators=int(hp.get("n_estimators", 200)),
            max_depth=int(hp.get("max_depth", 6)),
            learning_rate=float(hp.get("learning_rate", 0.1)),
            tree_method="hist",
            eval_metric="auc",
            random_state=42,
        )
    if algorithm == "random_forest":
        from sklearn.ensemble import RandomForestClassifier
        return RandomForestClassifier(
            n_estimators=int(hp.get("n_estimators", 200)),
            max_depth=int(hp.get("max_depth", 12)),
            n_jobs=-1,
            random_state=42,
        )
    if algorithm == "logistic_regression":
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler
        from sklearn.pipeline import make_pipeline
        return make_pipeline(
            StandardScaler(),
            LogisticRegression(C=float(hp.get("C", 1.0)), max_iter=1000),
        )
    if algorithm == "isolation_forest":
        from sklearn.ensemble import IsolationForest
        return IsolationForest(
            n_estimators=int(hp.get("n_estimators", 200)),
            contamination=float(hp.get("contamination", 0.2)),
            random_state=42,
        )
    raise ValueError(f"Unknown algorithm: {algorithm}")


def _scores(model, algorithm: str, X) -> np.ndarray:
    """Return fraud-probability-like scores in [0, 1]."""
    if algorithm == "isolation_forest":
        raw = -model.score_samples(X)  # higher = more anomalous
        return (raw - raw.min()) / (raw.max() - raw.min() + 1e-9)
    proba = model.predict_proba(X)
    return proba[:, 1]


def _feature_importance(model, algorithm: str) -> list:
    try:
        if algorithm == "xgboost":
            imp = model.feature_importances_
        elif algorithm == "random_forest":
            imp = model.feature_importances_
        elif algorithm == "isolation_forest":
            return []  # unsupervised — no native per-feature importance
        else:  # logistic regression pipeline
            coef = model.named_steps["logisticregression"].coef_[0]
            imp = np.abs(coef)
        imp = np.asarray(imp, dtype=float)
        total = imp.sum() or 1.0
        pairs = sorted(
            [{"feature": f, "importance": float(v / total)} for f, v in zip(FEATURE_NAMES, imp)],
            key=lambda d: d["importance"],
            reverse=True,
        )
        return pairs
    except Exception:
        return []


def train(
    algorithm: str,
    sample_size: int = 8000,
    hyperparams: Optional[dict] = None,
    progress: Optional[Callable[[str, int], None]] = None,
) -> dict:
    """Train one model and return a full result/metric payload + persist to the registry."""
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import roc_auc_score, roc_curve, confusion_matrix, accuracy_score, precision_score, recall_score, f1_score

    hp = hyperparams or {}
    if algorithm not in ALGORITHMS:
        raise ValueError(f"Unknown algorithm: {algorithm}")

    def emit(stage, pct):
        if progress:
            progress(stage, pct)

    t0 = time.time()
    emit("Generating synthetic dataset", 10)
    X, y = _synth_dataset(sample_size)

    emit("Splitting train / validation", 25)
    X_tr, X_val, y_tr, y_val = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    emit(f"Fitting {ALGORITHMS[algorithm]['label']}", 45)
    model = _build_model(algorithm, hp)
    if algorithm == "isolation_forest":
        model.fit(X_tr)  # unsupervised
    else:
        model.fit(X_tr, y_tr)

    emit("Evaluating model", 75)
    y_score = _scores(model, algorithm, X_val)
    auc = float(roc_auc_score(y_val, y_score))

    # Tune threshold for FPR <= 1.2% where possible, else Youden's J
    fpr_arr, tpr_arr, thr_arr = roc_curve(y_val, y_score)
    threshold = 0.5
    chosen_fpr = None
    for f, t, th in zip(fpr_arr, tpr_arr, thr_arr):
        if f <= 0.012:
            threshold = float(min(max(th, 0.0), 1.0))
            chosen_fpr = float(f)
    if chosen_fpr is None:
        j = tpr_arr - fpr_arr
        bi = int(np.argmax(j))
        threshold = float(min(max(thr_arr[bi], 0.0), 1.0))
        chosen_fpr = float(fpr_arr[bi])

    y_pred = (y_score >= threshold).astype(int)
    cm = confusion_matrix(y_val, y_pred).tolist()  # [[TN, FP], [FN, TP]]

    # Downsample ROC curve to ~60 points for the chart
    n_pts = len(fpr_arr)
    step = max(1, n_pts // 60)
    roc_points = [{"fpr": float(fpr_arr[i]), "tpr": float(tpr_arr[i])} for i in range(0, n_pts, step)]
    if roc_points[-1]["fpr"] != 1.0:
        roc_points.append({"fpr": 1.0, "tpr": 1.0})

    # Downsampled validation (score, label) pairs to power the live threshold tuner
    sample_idx = np.linspace(0, len(y_val) - 1, min(500, len(y_val))).astype(int)
    val_samples = [
        {"s": round(float(y_score[i]), 4), "y": int(y_val[i])} for i in sample_idx
    ]

    emit("Finalizing", 95)
    run_id = uuid.uuid4().hex[:10]
    result = {
        "run_id": run_id,
        "algorithm": algorithm,
        "algorithm_label": ALGORITHMS[algorithm]["label"],
        "sample_size": int(len(X)),
        "hyperparams": {k: hp[k] for k in hp} if hp else {},
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "train_time_s": round(time.time() - t0, 3),
        "metrics": {
            "auc": round(auc, 4),
            "accuracy": round(float(accuracy_score(y_val, y_pred)), 4),
            "precision": round(float(precision_score(y_val, y_pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y_val, y_pred, zero_division=0)), 4),
            "f1": round(float(f1_score(y_val, y_pred, zero_division=0)), 4),
            "fpr": round(chosen_fpr, 4),
        },
        "threshold": round(threshold, 4),
        "confusion_matrix": cm,
        "roc_points": roc_points,
        "val_samples": val_samples,
        "feature_importance": _feature_importance(model, algorithm),
        "model_hash": hashlib.sha256(f"{run_id}{algorithm}{time.time()}".encode()).hexdigest()[:8],
        "champion": False,
    }

    _persist_run(result)
    emit("Done", 100)
    return result


# ----------------------- Registry -----------------------

def _persist_run(result: dict):
    os.makedirs(LAB_DIR, exist_ok=True)
    with open(os.path.join(LAB_DIR, f"{result['run_id']}.json"), "w") as f:
        json.dump(result, f, indent=2)


def list_runs() -> list:
    if not os.path.isdir(LAB_DIR):
        return []
    runs = []
    champion = _champion_id()
    for name in os.listdir(LAB_DIR):
        if name.endswith(".json") and name != "champion.json":
            try:
                with open(os.path.join(LAB_DIR, name)) as f:
                    r = json.load(f)
                r["champion"] = r.get("run_id") == champion
                runs.append(r)
            except Exception:
                continue
    runs.sort(key=lambda r: r.get("trained_at", ""), reverse=True)
    return runs


def _champion_id() -> Optional[str]:
    path = os.path.join(LAB_DIR, "champion.json")
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f).get("run_id")
        except Exception:
            return None
    return None


def promote(run_id: str) -> dict:
    """Mark a run as the active lab champion. Does not overwrite the live
    430-feature inference model (different schema) — it records the champion
    in the lab registry, which the Lab UI surfaces as 'in production'."""
    path = os.path.join(LAB_DIR, f"{run_id}.json")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Run {run_id} not found")
    with open(path) as f:
        run = json.load(f)
    with open(os.path.join(LAB_DIR, "champion.json"), "w") as f:
        json.dump({"run_id": run_id, "promoted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f, indent=2)
    run["champion"] = True
    return run


def iter_train_events(algorithm: str, sample_size: int, hyperparams: dict) -> Iterator[str]:
    """Synchronous generator yielding SSE-formatted progress + final result."""
    events = []

    def cb(stage, pct):
        events.append(json.dumps({"type": "progress", "stage": stage, "pct": pct}))

    # We collect progress callbacks then flush; for true streaming the API layer
    # drives this via a threaded queue (see api/model_lab.py).
    result = train(algorithm, sample_size, hyperparams, cb)
    for e in events:
        yield f"data: {e}\n\n"
    yield f"data: {json.dumps({'type': 'result', 'result': result})}\n\n"

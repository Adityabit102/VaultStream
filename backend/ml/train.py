import os
import sys
import json
import time
import hashlib
import joblib
import numpy as np
import pandas as pd
from xgboost import XGBClassifier
from sklearn.metrics import roc_auc_score

# Ensure backend/ml is in the Python search path
ML_DIR = os.path.dirname(os.path.abspath(__file__))
if ML_DIR not in sys.path:
    sys.path.append(ML_DIR)

from preprocess import preprocess_data

def train_model():
    # Setup absolute directories
    BACKEND_DIR = os.path.dirname(ML_DIR)
    PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
    
    data_dir = os.path.join(PROJECT_ROOT, "data", "raw")
    encoders_dir = os.path.join(ML_DIR, "encoders")
    models_dir = os.path.join(BACKEND_DIR, "models")
    os.makedirs(models_dir, exist_ok=True)
    
    print(f"Project root resolved to: {PROJECT_ROOT}")
    print(f"Loading and preprocessing data from {data_dir}...")
    
    start_time = time.time()
    X_train, y_train, X_val, y_val = preprocess_data(data_dir=data_dir, encoders_dir=encoders_dir)
    preprocess_duration = time.time() - start_time
    print(f"Data loading and preprocessing finished in {preprocess_duration:.2f}s")
    
    print("Fitting XGBoost Classifier...")
    # Removing scale_pos_weight as it can sometimes degrade AUC on chronological splits
    print("Hyperparameters: max_depth=9, learning_rate=0.10, n_estimators=350, no weight scaling.")
    
    model = XGBClassifier(
        n_estimators=350,
        max_depth=9,
        learning_rate=0.10,
        random_state=42,
        tree_method='hist',
        eval_metric='auc',
        early_stopping_rounds=30
    )
    
    start_time = time.time()
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        verbose=10
    )
    fit_duration = time.time() - start_time
    print(f"Model fitting finished in {fit_duration:.2f}s")
    
    # Evaluate
    print("Evaluating model...")
    y_prob = model.predict_proba(X_val)[:, 1]
    val_auc = roc_auc_score(y_val, y_prob)
    print(f"Validation AUC: {val_auc:.5f}")
    
    if val_auc < 0.92:
        print("WARNING: Validation AUC is below the required 0.92 target threshold!")
    else:
        print("SUCCESS: Validation AUC matches or exceeds 0.92 target threshold.")
        
    # Find decision threshold where FPR <= 1.2% (0.012)
    # y_pred = (y_prob >= threshold)
    # FPR = FP / (FP + TN)
    target_fpr = 0.012
    thresholds = np.linspace(0.001, 0.999, 1000)
    best_threshold = 0.5
    final_fpr = 1.0
    
    for th in thresholds:
        y_pred = (y_prob >= th).astype(int)
        tn = np.sum((y_val == 0) & (y_pred == 0))
        fp = np.sum((y_val == 0) & (y_pred == 1))
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
        if fpr <= target_fpr:
            best_threshold = float(th)
            final_fpr = float(fpr)
            break
            
    print(f"Determined optimal classification threshold: {best_threshold:.4f}")
    print(f"Validation FPR at this threshold: {final_fpr * 100:.3f}% (Target: <= {target_fpr * 100}%)")
    
    # Save the model
    model_path = os.path.join(models_dir, "fraud_model.pkl")
    joblib.dump(model, model_path)
    print(f"Saved trained model to {model_path}")
    
    # Compute model hash
    sha256 = hashlib.sha256()
    with open(model_path, "rb") as f:
        while chunk := f.read(8192):
            sha256.update(chunk)
    model_hash = sha256.hexdigest()[:8]
    
    # Save metadata
    metadata = {
        "model_hash": model_hash,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset": "IEEE-CIS Fraud Detection Dataset",
        "n_train_samples": len(X_train),
        "val_auc": float(val_auc),
        "val_fpr": float(final_fpr),
        "features": list(X_train.columns),
        "threshold": best_threshold
    }
    
    metadata_path = os.path.join(models_dir, "model_metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=4)
    print(f"Saved model metadata to {metadata_path}")

if __name__ == "__main__":
    train_model()

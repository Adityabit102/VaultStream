import os
import sys
import json
import joblib
import numpy as np
from sklearn.metrics import roc_auc_score

ML_DIR = os.path.dirname(os.path.abspath(__file__))
if ML_DIR not in sys.path:
    sys.path.append(ML_DIR)

from preprocess import preprocess_data

def evaluate_serialized_model():
    BACKEND_DIR = os.path.dirname(ML_DIR)
    PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
    
    model_path = os.path.join(BACKEND_DIR, "models", "fraud_model.pkl")
    metadata_path = os.path.join(BACKEND_DIR, "models", "model_metadata.json")
    
    if not os.path.exists(model_path) or not os.path.exists(metadata_path):
        print("Error: Serialized model files not found. Train the model first.")
        sys.exit(1)
        
    with open(metadata_path, "r") as f:
        metadata = json.load(f)
        
    print(f"Loading model: {model_path} (Hash: {metadata['model_hash']})")
    model = joblib.load(model_path)
    
    data_dir = os.path.join(PROJECT_ROOT, "data", "raw")
    encoders_dir = os.path.join(ML_DIR, "encoders")
    _, _, X_val, y_val = preprocess_data(data_dir=data_dir, encoders_dir=encoders_dir)
    
    print("Evaluating validation set...")
    y_prob = model.predict_proba(X_val)[:, 1]
    val_auc = roc_auc_score(y_val, y_prob)
    
    threshold = metadata["threshold"]
    y_pred = (y_prob >= threshold).astype(int)
    
    tn = np.sum((y_val == 0) & (y_pred == 0))
    fp = np.sum((y_val == 0) & (y_pred == 1))
    fn = np.sum((y_val == 1) & (y_pred == 0))
    tp = np.sum((y_val == 1) & (y_pred == 1))
    
    val_fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    
    print(f"--- EVALUATION RESULTS ---")
    print(f"Validation AUC: {val_auc:.5f} (Target: >= 0.92)")
    print(f"Decision Threshold: {threshold:.4f}")
    print(f"Validation FPR: {val_fpr * 100:.3f}% (Target: <= 1.20%)")
    print(f"Validation Precision: {precision * 100:.2f}%")
    print(f"Validation Recall (TPR): {recall * 100:.2f}%")
    
    success = (val_auc >= 0.92) and (val_fpr <= 0.012)
    if success:
        print("STATUS: SUCCESS. All validation bounds met.")
    else:
        print("STATUS: FAILED. Validation bounds not met.")
        sys.exit(1)

if __name__ == "__main__":
    evaluate_serialized_model()

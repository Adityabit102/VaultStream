import xgboost as xgb
import numpy as np
import joblib
import os
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

def train_professional_model():
    print("Generating vast synthetic transaction dataset (10,000 samples)...")
    np.random.seed(42)
    n_samples = 10000
    
    # 1. Safe transactions (8,000 samples)
    n_safe = 8000
    tx_5m_safe = np.random.poisson(0.3, n_safe) + 1
    tx_1h_safe = tx_5m_safe + np.random.poisson(1.2, n_safe)
    tx_24h_safe = tx_1h_safe + np.random.poisson(4.5, n_safe)
    amount_safe = np.random.lognormal(3.2, 0.7, n_safe) # median ~$25
    device_shift_safe = np.random.binomial(1, 0.01, n_safe)
    
    # 2. Velocity fraud attacks (1,000 samples)
    n_f1 = 1000
    tx_5m_f1 = np.random.poisson(9.0, n_f1) + 2
    tx_1h_f1 = tx_5m_f1 + np.random.poisson(25.0, n_f1)
    tx_24h_f1 = tx_1h_f1 + np.random.poisson(60.0, n_f1)
    amount_f1 = np.random.lognormal(5.0, 0.8, n_f1) # median ~$150
    device_shift_f1 = np.random.binomial(1, 0.7, n_f1)
    
    # 3. High-amount takeover fraud (1,000 samples)
    n_f2 = 1000
    tx_5m_f2 = np.random.poisson(1.0, n_f2) + 1
    tx_1h_f2 = tx_5m_f2 + np.random.poisson(2.0, n_f2)
    tx_24h_f2 = tx_1h_f2 + np.random.poisson(5.0, n_f2)
    amount_f2 = np.random.lognormal(9.0, 0.6, n_f2) # median ~$8100
    device_shift_f2 = np.random.binomial(1, 0.95, n_f2)
    
    # Combine feature lists
    tx_5m = np.concatenate([tx_5m_safe, tx_5m_f1, tx_5m_f2])
    tx_1h = np.concatenate([tx_1h_safe, tx_1h_f1, tx_1h_f2])
    tx_24h = np.concatenate([tx_24h_safe, tx_24h_f1, tx_24h_f2])
    amount = np.concatenate([amount_safe, amount_f1, amount_f2])
    device_shift = np.concatenate([device_shift_safe, device_shift_f1, device_shift_f2])
    
    X = np.column_stack([tx_5m, tx_1h, tx_24h, amount, device_shift])
    
    # Set labels: 0 for safe, 1 for fraud
    y = np.zeros(n_samples)
    y[n_safe:] = 1
    
    # Train/Test Split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    print(f"Training set shape: {X_train.shape}, Test set shape: {X_test.shape}")
    
    # Fit model
    model = xgb.XGBClassifier(
        eval_metric='logloss',
        max_depth=4,
        n_estimators=100,
        learning_rate=0.1,
        random_state=42
    )
    model.fit(X_train, y_train)
    
    # Evaluate
    preds = model.predict(X_test)
    probs = model.predict_proba(X_test)[:, 1]
    
    acc = accuracy_score(y_test, preds)
    prec = precision_score(y_test, preds)
    rec = recall_score(y_test, preds)
    f1 = f1_score(y_test, preds)
    auc = roc_auc_score(y_test, probs)
    
    print("\n" + "="*40)
    print("MODEL TRAINING EVALUATION REPORT")
    print("="*40)
    print(f"Accuracy:  {acc:.5f}")
    print(f"Precision: {prec:.5f}")
    print(f"Recall:    {rec:.5f}")
    print(f"F1-Score:  {f1:.5f}")
    print(f"ROC-AUC:   {auc:.5f}")
    print("="*40 + "\n")
    
    # Save model to both root and backend subdirectories to ensure synchronization
    for p in ["backend/models", "models"]:
        os.makedirs(p, exist_ok=True)
        joblib.dump(model, os.path.join(p, "fraud_model.pkl"))
        print(f"Professional model saved at {p}/fraud_model.pkl")

if __name__ == "__main__":
    train_professional_model()

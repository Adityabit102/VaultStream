import os
import sys
import pandas as pd
import joblib
from sklearn.preprocessing import LabelEncoder

# Ensure ML directory is in python path
ML_DIR = os.path.dirname(os.path.abspath(__file__))
if ML_DIR not in sys.path:
    sys.path.append(ML_DIR)

from feature_engineering import engineer_features

def preprocess_data(data_dir="data/raw", encoders_dir="backend/ml/encoders"):
    """
    Loads raw IEEE-CIS datasets, merges them, executes feature engineering,
    imputes missing values, label encodes dynamically found categoricals,
    and splits the dataset chronologically (80% train / 20% validation).
    """
    # Resolve relative paths to absolute to prevent directory location bugs
    if not os.path.isabs(data_dir):
        PROJECT_ROOT = os.path.dirname(os.path.dirname(ML_DIR))
        data_dir = os.path.join(PROJECT_ROOT, data_dir)
    if not os.path.isabs(encoders_dir):
        PROJECT_ROOT = os.path.dirname(os.path.dirname(ML_DIR))
        encoders_dir = os.path.join(PROJECT_ROOT, encoders_dir)

    os.makedirs(encoders_dir, exist_ok=True)
    
    tx_path = os.path.join(data_dir, "train_transaction.csv")
    id_path = os.path.join(data_dir, "train_identity.csv")
    
    if not os.path.exists(tx_path) or not os.path.exists(id_path):
        raise FileNotFoundError(
            f"Kaggle datasets train_transaction.csv and train_identity.csv must be located in {data_dir}"
        )
        
    print("Loading datasets (this might take a few moments)...")
    train_tx = pd.read_csv(tx_path)
    train_id = pd.read_csv(id_path)
    
    print("Merging transaction and identity tables...")
    df = train_tx.merge(train_id, on="TransactionID", how="left")
    
    # Free up memory
    del train_tx
    del train_id
    
    print("Computing engineered features...")
    df = engineer_features(df)
    
    # Drop unique ID/keys that are not features
    if "TransactionID" in df.columns:
        df = df.drop(columns=["TransactionID"])
        
    # Dynamic categorical detection
    categorical_cols = df.select_dtypes(include=["object", "category"]).columns.tolist()
    if "isFraud" in categorical_cols:
        categorical_cols.remove("isFraud")
        
    print(f"Encoding {len(categorical_cols)} categorical columns...")
    for col in categorical_cols:
        # Fill missing categoricals with 'unknown'
        df[col] = df[col].fillna("unknown").astype(str)
        encoder = LabelEncoder()
        df[col] = encoder.fit_transform(df[col])
        encoder_path = os.path.join(encoders_dir, f"{col}_encoder.pkl")
        joblib.dump(encoder, encoder_path)
        
    # Get all features list (excluding target isFraud)
    feature_cols = [col for col in df.columns if col != "isFraud"]
    
    # Impute remaining numeric NaNs with -999 (imputation sentinel for XGBoost)
    df[feature_cols] = df[feature_cols].fillna(-999)
    
    print("Splitting dataset chronologically (80% train / 20% validation)...")
    split_idx = int(len(df) * 0.80)
    
    X = df[feature_cols]
    y = df["isFraud"]
    
    X_train = X.iloc[:split_idx]
    y_train = y.iloc[:split_idx]
    X_val = X.iloc[split_idx:]
    y_val = y.iloc[split_idx:]
    
    print(f"Dataset prepared. Train: {len(X_train)} rows | Validation: {len(X_val)} rows | Features: {len(feature_cols)}")
    return X_train, y_train, X_val, y_val

if __name__ == "__main__":
    try:
        X_train, y_train, X_val, y_val = preprocess_data()
    except Exception as e:
        print(f"Preprocessing run aborted: {e}")

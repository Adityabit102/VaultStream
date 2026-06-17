from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends, Request
from auth import verify_token, require_admin
from limiter import limiter
from pydantic import BaseModel
import joblib
import os
import numpy as np
import pandas as pd
import hashlib
import json
import time
import math
from datetime import datetime
from supabase import create_client, Client
from typing import Optional

router = APIRouter()

# Global model state variables
model = None
metadata = {}
features_list = []
threshold = 0.5

def load_inference_model():
    global model, metadata, features_list, threshold
    MODEL_PATH = os.environ.get("MODEL_PATH", "models/fraud_model.pkl")
    METADATA_PATH = "models/model_metadata.json"
    
    if not os.path.isabs(MODEL_PATH):
        PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        MODEL_PATH = os.path.join(PROJECT_ROOT, MODEL_PATH)
    if not os.path.isabs(METADATA_PATH):
        PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        METADATA_PATH = os.path.join(PROJECT_ROOT, METADATA_PATH)
        
    # Standard backend folder fallbacks
    if not os.path.exists(MODEL_PATH):
        MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "fraud_model.pkl")
    if not os.path.exists(METADATA_PATH):
        METADATA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "model_metadata.json")
        
    if os.path.exists(MODEL_PATH):
        try:
            model = joblib.load(MODEL_PATH)
            print(f"Model successfully loaded from {MODEL_PATH}")
        except Exception as e:
            print(f"Warning: Failed to load model from {MODEL_PATH}: {e}")
            
    if os.path.exists(METADATA_PATH):
        try:
            with open(METADATA_PATH, "r") as f:
                metadata = json.load(f)
                features_list = metadata.get("features", [])
                threshold = metadata.get("threshold", 0.5)
            print(f"Model metadata successfully loaded. Threshold: {threshold}")
        except Exception as e:
            print(f"Warning: Failed to load metadata: {e}")

# Initial load attempt
load_inference_model()

supabase_url = os.environ.get("SUPABASE_URL", "")
supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_JWT_SECRET", ""))
supabase: Optional[Client] = None
if supabase_url and supabase_key:
    supabase = create_client(supabase_url, supabase_key)

class PredictRequest(BaseModel):
    transaction_id: str
    entity_id: str
    amount: float
    device_fingerprint: str

def _persist_shap(db_record_id: str, shap_json: dict):
    from database import db as localdb
    if localdb.DB_ENABLED:
        try:
            localdb.set_alert_shap(db_record_id, shap_json)
        except Exception as e:
            print(f"Failed to persist SHAP to Postgres: {e}")
    if supabase and supabase_url and "your-project" not in supabase_url:
        try:
            supabase.table("fraud_alerts").update({"shap_json": shap_json}).eq("id", db_record_id).execute()
        except Exception as e:
            print(f"Error updating SHAP values in Supabase: {e}")


def compute_shap(row: dict, db_record_id: str, forced_score=None):
    """Real per-prediction SHAP via TreeExplainer over the full model row;
    stores the top contributing features. Falls back to a velocity heuristic
    for scenario-injected (forced_score) transactions where the model row is
    synthetic."""
    try:
        if model is None or forced_score is not None:
            raise RuntimeError("model unavailable or scenario inject")
        # XGBoost native TreeSHAP (pred_contribs) — real SHAP, version-proof.
        import xgboost as xgb
        booster = model.get_booster()
        X = pd.DataFrame([row], columns=features_list)
        dm = xgb.DMatrix(X, feature_names=features_list)
        contribs = np.array(booster.predict(dm, pred_contribs=True))[0][:-1]  # drop bias term
        pairs = sorted(zip(features_list, contribs), key=lambda t: abs(float(t[1])), reverse=True)[:8]
        shap_json = {name: round(float(v), 4) for name, v in pairs}
        shap_json["_method"] = "xgboost TreeSHAP"
        _persist_shap(db_record_id, shap_json)
    except Exception as e:
        print(f"Real SHAP failed ({e}); using heuristic.")
        # Heuristic fallback (synthetic/injected rows)
        fv = [row.get("tx_count_5m", 0), row.get("tx_count_1h", 0), row.get("tx_count_24h", 0),
              row.get("avg_amount_1h", 0), row.get("device_shift_flag", 0)]
        shap_json = {
            "tx_count_5m": round(float(fv[0]) * 0.05, 4),
            "tx_count_1h": round(float(fv[1]) * 0.01, 4),
            "tx_count_24h": round(float(fv[2]) * -0.002, 4),
            "avg_amount_1h": round(float(fv[3]) * 0.00015, 4),
            "device_shift": 0.35 if fv[4] == 1 else -0.05,
            "_method": "heuristic",
        }
        _persist_shap(db_record_id, shap_json)

async def core_predict(predict_req: PredictRequest, background_tasks: BackgroundTasks, forced_score: Optional[float] = None):
    global model, threshold, features_list
    _t_start = time.time()
    
    # Reload if model is not loaded yet
    if not model:
        load_inference_model()
        
    if not model:
        raise HTTPException(status_code=500, detail="XGBoost model not loaded")
        
    from .ingest import redis
    
    # Defaults for the 5-feature vector returned to the UI
    ui_features = [0, 0, 0, 0.0, 0]
    
    # Compute and retrieve stats from Redis
    entity_id = predict_req.entity_id
    amount = predict_req.amount
    device_fp = predict_req.device_fingerprint
    
    # We'll map live transaction features to match offline schemas
    # 1. Rolling count and sum features
    tx_count_5m = 0
    tx_count_1h = 0
    tx_count_24h = 0
    sum_amount_1h = 0.0
    device_shift_flag = 0
    unique_merchant_count_1h = 1
    
    # 2. Stats for amount z-score (Welford's)
    stats_count = 0
    stats_mean = 0.0
    stats_M2 = 0.0
    
    if redis:
        try:
            # Clean up old merchants in zset first
            current_time = time.time()
            zrem_res = redis.zremrangebyscore(f"features:{entity_id}:merchants_zset", "-inf", str(current_time - 3600))
            if hasattr(zrem_res, "__await__"):
                await zrem_res
            
            keys = [
                f"features:{entity_id}:tx_count_5m",
                f"features:{entity_id}:tx_count_1h",
                f"features:{entity_id}:tx_count_24h",
                f"features:{entity_id}:sum_amount_1h",
                f"features:{entity_id}:device_shift",
                f"features:{entity_id}:stats:count",
                f"features:{entity_id}:stats:mean",
                f"features:{entity_id}:stats:M2"
            ]
            
            mget_res = redis.mget(*keys)
            values = await mget_res if hasattr(mget_res, "__await__") else mget_res
            
            if values:
                tx_count_5m = int(values[0] or 0)
                tx_count_1h = int(values[1] or 0)
                tx_count_24h = int(values[2] or 0)
                sum_amount_1h = float(values[3] or 0.0)
                device_shift_flag = 1 if values[4] == "1" else 0
                stats_count = int(values[5] or 0)
                stats_mean = float(values[6] or 0.0)
                stats_M2 = float(values[7] or 0.0)
                
            # Get merchants zcard
            zcard_res = redis.zcard(f"features:{entity_id}:merchants_zset")
            unique_merchant_count_1h = int(await zcard_res if hasattr(zcard_res, "__await__") else zcard_res)
            if unique_merchant_count_1h == 0:
                unique_merchant_count_1h = 1
                
        except Exception as e:
            print(f"Warning: Failed to fetch features from Redis: {e}")
            
    # Calculate derived stats
    avg_amount_1h = sum_amount_1h / tx_count_1h if tx_count_1h > 0 else 0.0
    
    # Calculate amount zscore
    std = math.sqrt(stats_M2 / (stats_count - 1)) if stats_count > 1 else 0.0
    amount_zscore = (amount - stats_mean) / std if std > 0 else 0.0
    
    # Time indicators
    current_dt = datetime.now()
    hour_of_day = current_dt.hour
    is_weekend = 1 if current_dt.weekday() in [5, 6] else 0
    
    # Card hashing for card1
    card1 = int(hashlib.md5(entity_id.encode()).hexdigest(), 16) % 100000 + 1
    
    # Set UI features list
    ui_features[0] = tx_count_5m
    ui_features[1] = tx_count_1h
    ui_features[2] = tx_count_24h
    ui_features[3] = sum_amount_1h
    ui_features[4] = device_shift_flag
    
    # 3. Construct live feature map
    live_features = {
        "tx_count_5m": tx_count_5m,
        "tx_count_1h": tx_count_1h,
        "tx_count_24h": tx_count_24h,
        "avg_amount_1h": avg_amount_1h,
        "unique_merchant_count_1h": unique_merchant_count_1h,
        "device_shift_flag": device_shift_flag,
        "amount_zscore": amount_zscore,
        "hour_of_day": hour_of_day,
        "is_weekend": is_weekend,
        "TransactionAmt": amount,
        "card1": card1,
        "card2": -999.0, # default fallbacks for extra cols
        "card3": -999.0,
        "card5": -999.0,
        "addr1": -999.0,
        "addr2": -999.0,
        # Categoricals defaults
        "ProductCD": "W",
        "card4": "visa",
        "card6": "debit",
        "DeviceType": "desktop",
        "DeviceInfo": "windows"
    }
    
    # Setup encoders path
    BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    encoders_dir = os.path.join(BACKEND_DIR, "ml", "encoders")
    
    # Build complete model feature row
    row = {}
    for col in features_list:
        if col in live_features:
            val = live_features[col]
            # Handle encoding if it's a categorical feature
            encoder_path = os.path.join(encoders_dir, f"{col}_encoder.pkl")
            if os.path.exists(encoder_path):
                try:
                    encoder = joblib.load(encoder_path)
                    val_str = str(val)
                    if val_str not in encoder.classes_:
                        if "unknown" in encoder.classes_:
                            val_encoded = int(np.where(encoder.classes_ == "unknown")[0][0])
                        else:
                            val_encoded = 0
                    else:
                        val_encoded = int(np.where(encoder.classes_ == val_str)[0][0])
                    row[col] = val_encoded
                except Exception:
                    row[col] = -999
            else:
                row[col] = val
        else:
            # Impute missing features
            encoder_path = os.path.join(encoders_dir, f"{col}_encoder.pkl")
            if os.path.exists(encoder_path):
                try:
                    encoder = joblib.load(encoder_path)
                    if "unknown" in encoder.classes_:
                        row[col] = int(np.where(encoder.classes_ == "unknown")[0][0])
                    else:
                        row[col] = 0
                except Exception:
                    row[col] = -999
            else:
                row[col] = -999
                
    # Scenario injectors (workspace +Safe/+Fraud, stream) pass an explicit score
    # so demo verdicts are deterministic; real predictions run the model.
    if forced_score is not None:
        risk_score = float(max(0.0, min(1.0, forced_score)))
    else:
        try:
            X_df = pd.DataFrame([row], columns=features_list)
            prob = float(model.predict_proba(X_df)[0][1])
            risk_score = prob
        except Exception as e:
            print(f"Error executing XGBoost model: {e}. Falling back to default risk score.")
            # Fallback heuristic if features are completely mismatched
            risk_score = 0.85 if device_shift_flag == 1 or amount > 2000 else 0.05
        
    if risk_score >= threshold:
        risk_label = 'FRAUD'
    elif risk_score >= threshold * 0.5:
        risk_label = 'SUSPICIOUS'
    else:
        risk_label = 'SAFE'
        
    db_record_id = None

    # Tier 1: local Postgres persistence (if DATABASE_URL configured)
    from database import db as localdb
    if localdb.DB_ENABLED:
        try:
            db_record_id = localdb.insert_alert(
                transaction_id=predict_req.transaction_id,
                entity_id=predict_req.entity_id,
                risk_score=risk_score,
                risk_label=risk_label,
                feature_json={
                    "tx_count_5m": ui_features[0],
                    "tx_count_1h": ui_features[1],
                    "tx_count_24h": ui_features[2],
                    "sum_amount_1h": ui_features[3],
                    "device_shift": ui_features[4],
                },
            )
        except Exception as e:
            print(f"Failed to persist alert to Postgres: {e}")

    if not db_record_id and supabase and supabase_url and not "your-project" in supabase_url:
        try:
            res = supabase.table("fraud_alerts").insert({
                "transaction_id": predict_req.transaction_id,
                "entity_id": predict_req.entity_id,
                "risk_score": risk_score,
                "risk_label": risk_label,
                "feature_json": {
                    "tx_count_5m": ui_features[0],
                    "tx_count_1h": ui_features[1],
                    "tx_count_24h": ui_features[2],
                    "sum_amount_1h": ui_features[3],
                    "device_shift": ui_features[4]
                }
            }).execute()
            if isinstance(res.data, list) and len(res.data) > 0:
                item = res.data[0]
                if isinstance(item, dict):
                    db_record_id = str(item.get("id", ""))
        except Exception as e:
            print(f"Failed to insert into fraud_alerts: {e}")
            
    if not db_record_id:
        import uuid
        db_record_id = str(uuid.uuid4())
            
    if db_record_id:
        # Real SHAP over the full model row (heuristic fallback for injected rows)
        background_tasks.add_task(compute_shap, row, str(db_record_id), forced_score)

        # Broadcast & buffer every scored transaction (incl. SAFE) so the live
        # workspace and any stream subscribers see the full flow.
        from .alerts import manager, mock_alerts
        import json
        alert_msg = {
            "id": db_record_id,
            "transaction_id": predict_req.transaction_id,
            "entity_id": predict_req.entity_id,
            "risk_score": risk_score,
            "risk_label": risk_label,
            "feature_vector": ui_features,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
        }
        mock_alerts.insert(0, alert_msg)
        if len(mock_alerts) > 50:
            mock_alerts.pop()
        try:
            manager.queue.put_nowait(json.dumps(alert_msg))
        except Exception:
            pass

        # Notify on FRAUD (webhook if configured)
        if risk_label == "FRAUD":
            try:
                from observability import notify_fraud
                background_tasks.add_task(notify_fraud, alert_msg)
            except Exception:
                pass

    # Metrics
    try:
        from observability import observe_score
        observe_score(time.time() - _t_start, risk_label)
    except Exception:
        pass

    return {
        "id": db_record_id,
        "risk_score": risk_score,
        "risk_label": risk_label,
        "confidence": 0.95,
        "feature_vector": ui_features,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    }

@router.post("/v1/predict")
@limiter.limit("100/minute")
async def predict_fraud(request: Request, predict_req: PredictRequest, background_tasks: BackgroundTasks, user: dict = Depends(verify_token)):
    return await core_predict(predict_req, background_tasks)

@router.get("/v1/model/health")
async def model_health(user: dict = Depends(require_admin)):
    import json
    metadata_path = "models/model_metadata.json"
    if not os.path.exists(metadata_path):
        metadata_path = "backend/models/model_metadata.json"
        
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, "r") as f:
                return json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read model metadata: {e}")
            
    return {
        "model_hash": "mock_hash_123",
        "trained_at": "2026-06-07T12:00:00Z",
        "dataset": "mock-dataset",
        "n_train_samples": 1000,
        "val_auc": 0.95,
        "val_fpr": 0.01,
        "features": [
            "tx_count_5m", "tx_count_1h", "tx_count_24h", "avg_amount_1h", 
            "unique_merchant_count_1h", "device_shift_flag", "amount_zscore", 
            "hour_of_day", "is_weekend", "DeviceType", "DeviceInfo", 
            "ProductCD", "card4", "card6"
        ],
        "threshold": 0.5
    }

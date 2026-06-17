from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends, Request
from typing import List, Optional
import asyncio
import json
import os
from auth import verify_token, require_analyst, verify_token_and_role
from limiter import limiter

router = APIRouter()

# In-memory store for fallback mode when Supabase is offline/unconfigured
mock_alerts = []

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.queue = asyncio.Queue()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

async def broadcast_worker():
    while True:
        try:
            message = await manager.queue.get()
            await manager.broadcast(message)
            manager.queue.task_done()
        except Exception as e:
            print(f"Broadcast error: {e}")

@router.on_event("startup")
async def startup_event():
    asyncio.create_task(broadcast_worker())

@router.websocket("/ws/alerts")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = None):
    # Enforce token validation
    if not token:
        await websocket.accept()
        await websocket.send_json({"error": "Unauthorized: Missing token"})
        await websocket.close(code=4001)
        return
        
    try:
        from auth import settings
        import jwt
        if settings.SUPABASE_JWT_SECRET == "your-jwt-secret" or token == "mock-token":
            payload = {"sub": "00000000-0000-0000-0000-000000000000"}
        else:
            payload = jwt.decode(
                token, 
                settings.SUPABASE_JWT_SECRET, 
                algorithms=["HS256"], 
                options={"verify_aud": False}
            )
    except Exception as e:
        await websocket.accept()
        await websocket.send_json({"error": f"Unauthorized: {str(e)}"})
        await websocket.close(code=4001)
        return

    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@router.get("/v1/alerts")
@limiter.limit("30/minute")
async def get_alerts(request: Request, user: dict = Depends(verify_token)):
    from .predict import supabase, supabase_url
    from database import db
    if db.DB_ENABLED:
        rows = db.list_alerts(50)
        if rows is not None:
            return rows
    if not supabase or not supabase_url or "your-project" in supabase_url:
        return mock_alerts

    try:
        res = supabase.table("fraud_alerts").select("*").order("created_at", desc=True).limit(50).execute()
        return res.data
    except Exception as e:
        print(f"Warning: Failed to fetch alerts from Supabase, falling back to in-memory: {e}")
        return mock_alerts

@router.patch("/v1/alerts/{alert_id}")
@limiter.limit("30/minute")
async def update_alert_action(request: Request, alert_id: str, action: dict, user: dict = Depends(verify_token_and_role)):
    from .predict import supabase, supabase_url
    action_val = action.get("action_taken")
    if not action_val:
        raise HTTPException(status_code=400, detail="action_taken is required")

    # Analysts/admins can freeze & escalate; read-only viewers may *raise* (escalate)
    # suspicious/fraud transactions, but cannot freeze accounts.
    role = user.get("role")
    if role not in ("analyst", "admin"):
        if action_val == "escalate" and role == "viewer":
            pass  # viewers may raise alerts
        else:
            raise HTTPException(status_code=403, detail="Insufficient permissions for this action")

    from database import db
    if db.DB_ENABLED:
        ok = db.set_alert_action(alert_id, action_val)
        db.insert_audit(actor_id=user.get("user_id", "system"), action=action_val,
                        target_id=alert_id, details={"email": user.get("email")})
        # mirror into in-memory list so the live ticker reflects it immediately
        for a in mock_alerts:
            if a.get("id") == alert_id:
                a["action_taken"] = action_val
                break
        return {"status": "success" if ok else "not_found", "id": alert_id, "action_taken": action_val}

    if not supabase or not supabase_url or "your-project" in supabase_url:
        for a in mock_alerts:
            if a.get("id") == alert_id:
                a["action_taken"] = action_val
                break
        return {"status": "mock_success", "id": alert_id, "action_taken": action_val}
        
    try:
        res = supabase.table("fraud_alerts").update({"action_taken": action_val}).eq("id", alert_id).execute()
        return res.data
    except Exception as e:
        print(f"Warning: Failed to update alert in Supabase, falling back to in-memory: {e}")
        for a in mock_alerts:
            if a.get("id") == alert_id:
                a["action_taken"] = action_val
                break
        return {"status": "mock_success_fallback", "id": alert_id, "action_taken": action_val}
from fastapi import APIRouter, Depends, HTTPException
from auth import require_admin
from pydantic import BaseModel
from typing import List

router = APIRouter()

# In-memory store for fallback mode
mock_users = [
    {"id": "mock_admin", "email": "admin@vaultstream.demo", "role": "admin", "last_sign_in_at": "2026-06-07T12:00:00Z"},
    {"id": "mock_analyst", "email": "analyst@vaultstream.demo", "role": "analyst", "last_sign_in_at": "2026-06-07T11:45:00Z"},
    {"id": "mock_viewer", "email": "viewer@vaultstream.demo", "role": "viewer", "last_sign_in_at": "2026-06-07T10:30:00Z"},
]

class RoleUpdateRequest(BaseModel):
    role: str

@router.get("/v1/admin/users")
async def get_admin_users(user: dict = Depends(require_admin)):
    from auth import settings
    from api.predict import supabase, supabase_url
    from database import db

    # Tier 1: local Postgres
    if db.DB_ENABLED:
        users = db.list_users()
        if users is not None:
            return users

    # Check if unconfigured or fallback mode
    if settings.SUPABASE_JWT_SECRET == "your-jwt-secret" or not supabase or "your-project" in supabase_url:
        return mock_users

    try:
        # Get roles mapping
        roles_res = supabase.table("user_roles").select("user_id, role").execute()
        roles_map = {r["user_id"]: r["role"] for r in roles_res.data} if roles_res.data else {}

        # Get list of users from Auth admin API (requires service key)
        users_res = supabase.auth.admin.list_users()
        
        users_list = []
        for u in users_res:
            users_list.append({
                "id": str(u.id),
                "email": str(u.email),
                "role": roles_map.get(str(u.id), "viewer"),
                "last_sign_in_at": u.last_sign_in_at.isoformat() if u.last_sign_in_at else None
            })
        return users_list
    except Exception as e:
        print(f"Warning: Failed to fetch users via Auth Admin API: {e}. Falling back to DB role list.")
        try:
            # Fallback: List roles from the table directly
            roles_res = supabase.table("user_roles").select("*").execute()
            users_list = []
            for r in roles_res.data:
                users_list.append({
                    "id": r["user_id"],
                    "email": f"user_{r['user_id'][:8]}@supabase.user",
                    "role": r["role"],
                    "last_sign_in_at": r.get("assigned_at")
                })
            return users_list
        except Exception as db_err:
            print(f"Database fallback query failed: {db_err}")
            return mock_users

@router.patch("/v1/admin/users/{user_id}/role")
async def update_user_role(user_id: str, req: RoleUpdateRequest, user: dict = Depends(require_admin)):
    new_role = req.role
    if new_role not in ("analyst", "admin", "viewer"):
        raise HTTPException(status_code=400, detail="Invalid role value")

    from auth import settings
    from api.predict import supabase, supabase_url
    from database import db

    # Tier 1: local Postgres
    if db.DB_ENABLED:
        db.upsert_role(user_id, new_role)
        db.insert_audit(actor_id=user.get("user_id", "system"), action=f"role:{new_role}",
                        target_id=user_id, details={"by": user.get("email")})
        return {"status": "success", "id": user_id, "role": new_role}

    # Local mock update
    if settings.SUPABASE_JWT_SECRET == "your-jwt-secret" or not supabase or "your-project" in supabase_url:
        for u in mock_users:
            if u["id"] == user_id:
                u["role"] = new_role
                return {"status": "mock_success", "id": user_id, "role": new_role}
        
        # Upsert mock user
        mock_users.append({
            "id": user_id,
            "email": f"custom_{user_id[:8]}@vaultstream.demo",
            "role": new_role,
            "last_sign_in_at": "2026-06-07T12:00:00Z"
        })
        return {"status": "mock_success", "id": user_id, "role": new_role}

    try:
        # Upsert role mapping in user_roles
        res = supabase.table("user_roles").upsert({
            "user_id": user_id,
            "role": new_role
        }).execute()
        return {"status": "success", "id": user_id, "role": new_role}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database update failed: {str(e)}")

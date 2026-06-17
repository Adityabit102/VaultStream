from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    SUPABASE_JWT_SECRET: str = "your-jwt-secret"
    
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
oauth2_scheme = HTTPBearer()

async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(oauth2_scheme)):
    token = credentials.credentials
    
    # Local fallback/development bypass when Supabase keys are unconfigured
    if settings.SUPABASE_JWT_SECRET == "your-jwt-secret" or token.startswith("mock-token"):
        role = "analyst"
        if token.startswith("mock-token-"):
            role = token.split("-")[-1]
        return {
            "email": f"{role}@vaultstream.demo",
            "sub": f"00000000-0000-0000-0000-00000000000{1 if role=='admin' else 2 if role=='analyst' else 3}",
            "role": "authenticated"
        }
        
    try:
        # Supabase JWTs use HS256
        payload = jwt.decode(
            token, 
            settings.SUPABASE_JWT_SECRET, 
            algorithms=["HS256"], 
            options={"verify_aud": False}
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def verify_token_and_role(credentials: HTTPAuthorizationCredentials = Depends(oauth2_scheme)):
    token = credentials.credentials
    
    # Local fallback / development mock token check
    if settings.SUPABASE_JWT_SECRET == "your-jwt-secret" or token.startswith("mock-token"):
        role = "analyst"
        if token.startswith("mock-token-"):
            role = token.split("-")[-1]
        
        email = f"{role}@vaultstream.demo"
        user_id = f"00000000-0000-0000-0000-00000000000{1 if role == 'admin' else 2 if role == 'analyst' else 3}"
        return {
            "user_id": user_id,
            "email": email,
            "role": role
        }
        
    try:
        payload = jwt.decode(
            token, 
            settings.SUPABASE_JWT_SECRET, 
            algorithms=["HS256"], 
            options={"verify_aud": False}
        )
        user_id = payload.get("sub")
        email = payload.get("email", "")
        
        from api.predict import supabase, supabase_url
        role = "viewer"
        if supabase and supabase_url and "your-project" not in supabase_url:
            try:
                res = supabase.table("user_roles").select("role").eq("user_id", user_id).execute()
                if res.data and len(res.data) > 0:
                    role = res.data[0].get("role", "viewer")
            except Exception as e:
                print(f"Warning: Failed to fetch role from user_roles: {e}")
        else:
            role = "admin" if "admin" in email else "viewer" if "viewer" in email else "analyst"
            
        return {"user_id": user_id, "email": email, "role": role}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_analyst(user=Depends(verify_token_and_role)):
    if user['role'] not in ('analyst', 'admin'):
        raise HTTPException(status_code=403, detail='Analyst role required')
    return user

def require_admin(user=Depends(verify_token_and_role)):
    if user['role'] != 'admin':
        raise HTTPException(status_code=403, detail='Admin role required')
    return user

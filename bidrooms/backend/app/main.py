import hashlib
import os
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import create_engine, text

DATABASE_URL=os.getenv("DATABASE_URL")
app=FastAPI(title="BIDROOMS API",version="0.1.0")
engine=create_engine(DATABASE_URL,pool_pre_ping=True) if DATABASE_URL else None

class Intake(BaseModel):
    kind:str
    room_id:Optional[str]=None
    organization_id:Optional[str]=None
    email:EmailStr
    legal_name:str
    government_id:str
    company:str
    role:str
    message:Optional[str]=None

@app.get("/health")
def health():
    db="unconfigured"
    if engine:
        with engine.connect() as c:
            c.execute(text("select 1"))
        db="ok"
    return {"service":"bidrooms-api","status":"ok","database":db}

@app.get("/api/v1/system")
def system():
    return {"schema":"bidrooms-api/v1","public_accounts":False,"mode":"public-registry+procurement+atlas-ops"}

@app.post("/api/v1/intake",status_code=202)
def create_intake(payload:Intake):
    if not engine:
        raise HTTPException(503,"DATABASE_URL is not configured")
    raw=payload.government_id.strip()
    safe={
      **payload.model_dump(exclude={"government_id"}),
      "government_id_hash":hashlib.sha256(raw.encode("utf-8")).hexdigest(),
      "government_id_last4":raw[-4:] if raw else None
    }
    with engine.begin() as c:
        row=c.execute(text("""
          insert into operations.intake_cases
          (kind,room_id,organization_id,email,legal_name,government_id_hash,government_id_last4,company,role,message,status,created_at)
          values(:kind,:room_id,:organization_id,:email,:legal_name,:government_id_hash,:government_id_last4,:company,:role,:message,'RECEIVED',now())
          returning id
        """),safe).scalar_one()
    return {"id":row,"status":"RECEIVED","received_at":datetime.now(timezone.utc).isoformat()}

import hashlib
import os
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import create_engine, text, event
from .workspace import make_router
from fastapi.middleware.cors import CORSMiddleware

DATABASE_URL=os.getenv("DATABASE_URL")
app=FastAPI(title="BIDROOMS API",version="0.1.0")
engine=create_engine(DATABASE_URL,pool_pre_ping=True) if DATABASE_URL else None
if engine is not None and engine.dialect.name=='sqlite':
    @event.listens_for(engine,'connect')
    def sqlite_integrity(dbapi_connection, connection_record):
        dbapi_connection.execute('PRAGMA foreign_keys=ON')
app.include_router(make_router(engine, os.getenv('BIDROOMS_SHARED_ROOT'),
    allowed_origins=tuple(x.strip() for x in os.getenv('BIDROOMS_ALLOWED_ORIGINS','').split(',') if x.strip()),
    qa=os.getenv('BIDROOMS_QA_MODE')=='1' and bool(DATABASE_URL and DATABASE_URL.startswith('sqlite:///'))))
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in os.getenv('BIDROOMS_ALLOWED_ORIGINS','').split(',') if x.strip()],
    allow_credentials=True, allow_methods=['GET','POST','PATCH','DELETE'], allow_headers=['Content-Type','X-BR-CSRF','X-Document-Name','If-Match'])

@app.middleware('http')
async def private_headers(request, call_next):
    response=await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
    return response

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
    if os.getenv('BIDROOMS_ENABLE_LEGACY_INTAKE') != '1':
        raise HTTPException(503,"Registro anterior no habilitado; no introduzca identificación personal")
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

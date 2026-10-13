"""Espacio privado dentro de la API canónica; motor compartido fuera del repo público."""
import base64
import asyncio
import hashlib
import hmac
import json
import os
import secrets
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import Column, Integer, LargeBinary, MetaData, String, Table, Text, select, func, ForeignKey, ForeignKeyConstraint, UniqueConstraint

metadata = MetaData()
organizations = Table('bidrooms_organizations', metadata, Column('id', String(36), primary_key=True), Column('name', String(200), nullable=False),
                      Column('audit_hash', String(64), nullable=False, default='0'*64), Column('audit_seq', Integer, nullable=False, default=0))
users = Table('bidrooms_users', metadata, Column('id', String(36), primary_key=True), Column('organization_id', String(36), nullable=False),
              Column('email', String(254), nullable=False, unique=True), Column('password_hash', String(256), nullable=False), Column('role', String(16), nullable=False),
              ForeignKeyConstraint(['organization_id'],['bidrooms_organizations.id']))
sessions = Table('bidrooms_sessions', metadata, Column('token_hash', String(64), primary_key=True), Column('user_id', String(36), nullable=False),
                 Column('csrf', String(64), nullable=False), Column('expires_at', Integer, nullable=False), ForeignKeyConstraint(['user_id'],['bidrooms_users.id']))
cases = Table('bidrooms_need_cases', metadata, Column('id', String(36), primary_key=True), Column('organization_id', String(36), nullable=False),
              Column('objective', Text, nullable=False), Column('revision', Integer, nullable=False), Column('state', String(40), nullable=False),
              UniqueConstraint('id','organization_id'), ForeignKeyConstraint(['organization_id'],['bidrooms_organizations.id']))
documents = Table('bidrooms_need_documents', metadata, Column('id', String(36), primary_key=True), Column('organization_id', String(36), nullable=False),
                  Column('case_id', String(36), nullable=False), Column('filename', String(200), nullable=False), Column('sha256', String(64), nullable=False),
                  Column('content', LargeBinary, nullable=False), Column('analysis', Text, nullable=False),
                  ForeignKeyConstraint(['case_id','organization_id'],['bidrooms_need_cases.id','bidrooms_need_cases.organization_id']))
plans = Table('bidrooms_need_plans', metadata, Column('case_id', String(36), primary_key=True), Column('organization_id', String(36), nullable=False),
              Column('case_revision', Integer, nullable=False), Column('content', Text, nullable=False), Column('sha256', String(64), nullable=False),
              Column('review', Text, nullable=True), ForeignKeyConstraint(['case_id','organization_id'],['bidrooms_need_cases.id','bidrooms_need_cases.organization_id']))
audit = Table('bidrooms_need_audit', metadata, Column('id', String(36), primary_key=True), Column('organization_id', String(36), nullable=False),
              Column('case_id', String(36), nullable=True), Column('actor', String(36), nullable=False), Column('action', String(60), nullable=False),
              Column('created_at', String(40), nullable=False), Column('detail', Text, nullable=False), Column('previous_hash', String(64), nullable=False),
              Column('entry_hash', String(64), nullable=False), Column('sequence',Integer,nullable=False),
              ForeignKeyConstraint(['organization_id'],['bidrooms_organizations.id']), ForeignKeyConstraint(['actor'],['bidrooms_users.id']),
              ForeignKeyConstraint(['case_id','organization_id'],['bidrooms_need_cases.id','bidrooms_need_cases.organization_id']))
attempts = Table('bidrooms_login_attempts', metadata, Column('key', String(64), primary_key=True), Column('count', Integer, nullable=False), Column('window', Integer, nullable=False))
MAX_BYTES = 20 * 1024 * 1024


def canonical(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def password_hash(password, salt=None):
    if not 12 <= len(password) <= 256:
        raise ValueError('La contraseña debe tener entre 12 y 256 caracteres')
    salt = salt or secrets.token_hex(16)
    derived = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32).hex()
    return 'scrypt$'+salt+'$'+derived


def password_matches(password, stored):
    try:
        _, salt, _ = stored.split('$')
        return hmac.compare_digest(password_hash(password, salt), stored)
    except ValueError:
        return False


def migrate(engine):
    # Migración aditiva explícita. No altera tablas/cuentas existentes ni se ejecuta al arrancar.
    metadata.create_all(engine)


def provision(engine, email, password, organization_id, role='OWNER'):
    if role not in ['OWNER', 'EDITOR', 'VIEWER']:
        raise ValueError('Rol no admitido')
    with engine.begin() as c:
        if not c.execute(select(organizations.c.id).where(organizations.c.id == organization_id)).first():
            raise ValueError('Organización inexistente')
        c.execute(users.insert().values(id=str(uuid.uuid4()), organization_id=organization_id,
                                        email=email.strip().lower(), password_hash=password_hash(password), role=role))


def run_shared(root, payload):
    if not root or not (Path(root)/'capabilities/bidrooms_documental/bidrooms_core/cli.py').is_file():
        raise HTTPException(503, 'Motor documental compartido no configurado')
    env = {'PATH': os.environ.get('PATH', ''), 'PYTHONPATH': str(Path(root)/'capabilities/bidrooms_documental'),
           'PYTHONUTF8': '1', 'LANG': 'C.UTF-8', 'NODE_OPTIONS': '--max-old-space-size=256'}
    child = subprocess.Popen([sys.executable, '-m', 'bidrooms_core.cli'], cwd=root, env=env,
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        output, _ = child.communicate(canonical(payload).encode(), timeout=120)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.communicate()
        raise HTTPException(504, 'Análisis excedió el tiempo permitido; divide el documento y vuelve a intentarlo')
    try:
        result = json.loads(output)
    except (ValueError, UnicodeError):
        raise HTTPException(503, 'Motor documental no disponible')
    if child.returncode or 'error' in result:
        # No exponer stderr, rutas internas, credenciales ni texto del documento en errores.
        error = result.get('error', '')
        allowed = ['PDF_CONTENIDO_ACTIVO', 'PDF_FIRMA_INVALIDA', 'FORMATO_NO_ADMITIDO', 'PDF_CIFRADO_O_LIMITE_PAGINAS',
                   'ARCHIVO_EXPANSION_EXCESIVA', 'HUELLA_ORIGINAL_NO_COINCIDE', 'TEXTO_NO_VALIDO', 'ENTRADA_EXCESIVA']
        raise HTTPException(422, error if error in allowed else 'No se pudo verificar el documento; requiere revisión')
    return result


class Login(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class Need(BaseModel):
    model_config = {'str_strip_whitespace':True}
    objective: str = Field(min_length=8, max_length=8000)


class Review(BaseModel):
    model_config = {'str_strip_whitespace':True}
    revision: int = Field(ge=1)
    plan_sha256: str = Field(min_length=64, max_length=64)
    decision: str
    comment: str = Field(min_length=8, max_length=2000)


def make_router(engine, shared_root, *, allowed_origins=(), qa=False):
    router = APIRouter(prefix='/api/v1/workspace')
    cookie = 'br-qa-session' if qa else '__Host-br-session'
    dummy = password_hash('inexistente-usuario-aleatorio')

    def database():
        if engine is None:
            raise HTTPException(503, 'Persistencia privada no configurada')
        return engine

    def origin(request):
        if request.headers.get('origin') not in allowed_origins:
            raise HTTPException(403, 'Origen no autorizado')

    def actor(request, *, write=False, edit=True):
        database()
        with engine.connect() as c:
            row = c.execute(select(users, sessions.c.csrf).join(sessions, users.c.id == sessions.c.user_id).where(
                sessions.c.token_hash == digest(request.cookies.get(cookie, '')), sessions.c.expires_at > int(time.time()))).mappings().first()
        if not row:
            raise HTTPException(401, 'Acceso privado requiere una sesión válida')
        if write:
            origin(request)
            if not hmac.compare_digest(request.headers.get('x-br-csrf', ''), row['csrf']):
                raise HTTPException(403, 'Confirmación de sesión inválida')
            if edit and row['role'] not in ['OWNER', 'EDITOR']:
                raise HTTPException(403, 'Tu rol permite consultar, no modificar')
        return dict(row)

    def owned(c, case_id, user):
        row = c.execute(select(cases).where(cases.c.id == case_id, cases.c.organization_id == user['organization_id']).with_for_update()).mappings().first()
        if not row:
            raise HTTPException(404, 'Expediente no disponible')
        return dict(row)

    def event(c, user, action, case_id=None, detail=None):
        # Bloqueo por organización en PostgreSQL; SQLite serializa la escritura local.
        organization = c.execute(select(organizations).where(organizations.c.id == user['organization_id']).with_for_update()).mappings().one()
        previous = organization['audit_hash']
        record = {'id': str(uuid.uuid4()), 'organization_id': user['organization_id'], 'case_id': case_id,
                  'actor': user['id'], 'action': action, 'created_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
                  'detail': canonical(detail or {}), 'previous_hash': previous, 'sequence':organization['audit_seq']+1}
        entry_hash = digest(canonical(record))
        c.execute(audit.insert().values(**record, entry_hash=entry_hash))
        c.execute(organizations.update().where(organizations.c.id==user['organization_id']).values(audit_hash=entry_hash,audit_seq=record['sequence']))

    @router.get('/status')
    def status():
        ready = False
        if engine:
            try:
                with engine.connect() as c:
                    c.execute(select(cases.c.id).limit(1))
                ready = bool(run_shared(shared_root, {'operation':'capabilities'}).get('available'))
            except Exception:
                pass
        return {'schema': 'bidrooms-workspace/v1', 'ready': ready, 'llm_active': False, 'professional_validation': False,
                'private_documents': ready, 'identity_mode': 'ACCESO_PROVISIONADO', 'reason': None if ready else 'API, migración y motor compartido requieren configuración verificada'}

    @router.post('/session')
    def login(payload: Login, request: Request, response: Response):
        database()
        origin(request)
        key = digest((request.client.host if request.client else '')+':'+payload.email.lower())
        now = int(time.time())
        with engine.begin() as c:
            attempt = c.execute(select(attempts).where(attempts.c.key == key).with_for_update()).mappings().first()
            if attempt and now-attempt['window'] < 600 and attempt['count'] >= 8:
                raise HTTPException(429, 'Espera antes de volver a intentar el acceso')
            if not attempt:
                c.execute(attempts.insert().values(key=key, count=1, window=now))
            else:
                count = attempt['count']+1 if now-attempt['window'] < 600 else 1
                c.execute(attempts.update().where(attempts.c.key == key).values(count=count, window=attempt['window'] if count>1 else now))
            user = c.execute(select(users).where(users.c.email == payload.email.strip().lower())).mappings().first()
            valid = password_matches(payload.password, user['password_hash'] if user else dummy)
        if not user or not valid:
            raise HTTPException(401, 'Cuenta o contraseña incorrecta')
        token, csrf = secrets.token_urlsafe(32), secrets.token_hex(32)
        with engine.begin() as c:
            c.execute(attempts.update().where(attempts.c.key == key).values(count=0, window=now))
            c.execute(sessions.insert().values(token_hash=digest(token), user_id=user['id'], csrf=csrf, expires_at=now+8*3600))
            event(c, user, 'SESION_INICIADA')
        response.set_cookie(cookie, token, secure=not qa, httponly=True, samesite='strict', path='/', max_age=8*3600)
        response.headers['Cache-Control'] = 'no-store'
        return {'csrf': csrf, 'user': {k:user[k] for k in ['id', 'organization_id', 'role']}, 'legal_identity_verified': False}

    @router.get('/session')
    def session(request: Request, response: Response):
        user = actor(request)
        response.headers['Cache-Control'] = 'no-store'
        return {'csrf': user['csrf'], 'user': {k:user[k] for k in ['id', 'organization_id', 'role']}, 'legal_identity_verified': False}

    @router.delete('/session')
    def logout(request: Request, response: Response):
        user = actor(request, write=True, edit=False)
        with engine.begin() as c:
            c.execute(sessions.delete().where(sessions.c.token_hash == digest(request.cookies[cookie])))
            event(c, user, 'SESION_CERRADA')
        response.delete_cookie(cookie, path='/')
        return {'ok': True}

    @router.post('/cases', status_code=201)
    def create(payload: Need, request: Request):
        user = actor(request, write=True)
        record = {'id': str(uuid.uuid4()), 'organization_id': user['organization_id'], 'objective': payload.objective.strip(), 'revision': 1, 'state': 'BORRADOR'}
        with engine.begin() as c:
            c.execute(cases.insert().values(**record))
            event(c, user, 'NECESIDAD_REGISTRADA', record['id'], {'objective_sha256': digest(record['objective'])})
        return record

    @router.get('/cases')
    def list_cases(request: Request):
        user = actor(request)
        with engine.connect() as c:
            return [dict(x) for x in c.execute(select(cases).where(cases.c.organization_id == user['organization_id'])).mappings()]

    @router.patch('/cases/{case_id}')
    def edit_objective(case_id: str, payload: Need, request: Request):
        user = actor(request, write=True)
        with engine.begin() as c:
            record = owned(c, case_id, user)
            if request.headers.get('if-match') != str(record['revision']):
                raise HTTPException(409, 'El objetivo cambió; conserva tu texto y recarga')
            changed = c.execute(cases.update().where(cases.c.id==case_id, cases.c.organization_id==user['organization_id'], cases.c.revision==record['revision']).values(objective=payload.objective, revision=record['revision']+1, state='BORRADOR')).rowcount
            if changed != 1:
                raise HTTPException(409, 'Otra edición fue guardada; conserva tu texto y recarga')
            c.execute(plans.delete().where(plans.c.case_id==case_id))
            event(c, user, 'OBJETIVO_ACTUALIZADO', case_id, {'previous_objective':record['objective'], 'objective':payload.objective, 'revision':record['revision']+1})
        return {**record,'objective':payload.objective,'revision':record['revision']+1,'state':'BORRADOR'}

    @router.get('/cases/{case_id}')
    def get_case(case_id: str, request: Request):
        user = actor(request)
        with engine.connect() as c:
            record = owned(c, case_id, user)
            record['documents'] = [dict(x) for x in c.execute(select(documents.c.id, documents.c.filename, documents.c.sha256).where(documents.c.case_id == case_id, documents.c.organization_id == user['organization_id'])).mappings()]
            saved = c.execute(select(plans).where(plans.c.case_id == case_id, plans.c.organization_id == user['organization_id'])).mappings().first()
            record['plan'] = json.loads(saved['content']) if saved else None
            record['review'] = json.loads(saved['review']) if saved and saved['review'] else None
            record['plan_sha256'] = saved['sha256'] if saved else None
        return record

    @router.post('/cases/{case_id}/documents', status_code=201)
    async def upload(case_id: str, request: Request):
        user = actor(request, write=True)
        filename = unquote(request.headers.get('x-document-name', ''))
        if not filename or len(filename)>200 or Path(filename).name != filename or '\\' in filename or any(ord(ch)<32 for ch in filename):
            raise HTTPException(422, 'Nombre de archivo inválido')
        with engine.connect() as c:
            record = owned(c, case_id, user)
            count, used = c.execute(select(func.count(), func.coalesce(func.sum(func.length(documents.c.content)), 0)).where(documents.c.organization_id == user['organization_id'])).one()
        if count >= 50 or used >= 100*1024*1024:
            raise HTTPException(413, 'Cuota documental de la organización alcanzada')
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw)>MAX_BYTES or len(raw)+used>100*1024*1024:
                raise HTTPException(413, 'Archivo supera la cuota permitida')
        if not raw:
            raise HTTPException(422, 'El archivo está vacío')
        revision = request.headers.get('if-match')
        if revision != str(record['revision']):
            raise HTTPException(409, 'El expediente cambió; recarga antes de incorporar documentos')
        identifier = str(uuid.uuid4())
        doc = {'id': identifier, 'case_id': case_id, 'organization_id': user['organization_id'], 'version': digest(raw),
               'source_url': f'bidrooms://organization/{user["organization_id"]}/case/{case_id}/document/{identifier}', 'kind': 'APORTE_USUARIO'}
        try:
            analysis = await asyncio.to_thread(run_shared, shared_root, {'operation':'private_document', 'content_base64':base64.b64encode(raw).decode(), 'filename':filename, 'document':doc})
        except HTTPException as error:
            with engine.begin() as c:
                event(c, user, 'ANALISIS_RECHAZADO', case_id, {'status':error.status_code, 'sha256':digest(raw)})
            raise
        with engine.begin() as c:
            changed = c.execute(cases.update().where(cases.c.id==case_id, cases.c.organization_id==user['organization_id'], cases.c.revision==record['revision']).values(revision=record['revision']+1, state='BORRADOR')).rowcount
            if changed != 1:
                raise HTTPException(409, 'Otra edición fue guardada; conserva el archivo y recarga')
            c.execute(select(organizations.c.id).where(organizations.c.id==user['organization_id']).with_for_update()).first()
            count, used = c.execute(select(func.count(), func.coalesce(func.sum(func.length(documents.c.content)), 0)).where(documents.c.organization_id==user['organization_id'])).one()
            if count>=50 or used+len(raw)>100*1024*1024:
                raise HTTPException(413, 'Cuota documental alcanzada durante la operación')
            c.execute(documents.insert().values(id=identifier, organization_id=user['organization_id'], case_id=case_id, filename=filename,
                                               sha256=digest(raw), content=bytes(raw), analysis=canonical(analysis)))
            c.execute(plans.delete().where(plans.c.case_id==case_id))
            event(c, user, 'DOCUMENTO_INCORPORADO', case_id, {'document_id':identifier, 'sha256':digest(raw), 'revision':record['revision']+1})
        return {'id':identifier, 'sha256':digest(raw), 'revision':record['revision']+1, 'analysis':analysis}

    @router.get('/cases/{case_id}/documents/{document_id}')
    def source(case_id: str, document_id: str, request: Request):
        user = actor(request)
        with engine.connect() as c:
            owned(c, case_id, user)
            doc = c.execute(select(documents).where(documents.c.id==document_id, documents.c.case_id==case_id, documents.c.organization_id==user['organization_id'])).mappings().first()
        if not doc:
            raise HTTPException(404, 'Documento no disponible')
        return Response(doc['content'], media_type='application/octet-stream', headers={'Content-Disposition':'attachment; filename="documento"', 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store', 'X-Document-SHA256':doc['sha256']})

    @router.post('/cases/{case_id}/plan')
    def generate_plan(case_id: str, request: Request):
        user = actor(request, write=True)
        with engine.connect() as c:
            record = owned(c, case_id, user)
            analyses = [json.loads(x) for x in c.execute(select(documents.c.analysis).where(documents.c.case_id==case_id, documents.c.organization_id==user['organization_id'])).scalars()]
        proposal = run_shared(shared_root, {'operation':'needs_plan', 'objective':record['objective'], 'analyses':analyses, 'case_id':case_id, 'organization_id':user['organization_id']})
        with engine.begin() as c:
            current = owned(c, case_id, user)
            if current['revision'] != record['revision']:
                raise HTTPException(409, 'Los documentos cambiaron durante el análisis; vuelve a generar el plan')
            c.execute(plans.delete().where(plans.c.case_id==case_id))
            c.execute(plans.insert().values(case_id=case_id, organization_id=user['organization_id'], case_revision=record['revision'], content=canonical(proposal), sha256=digest(canonical(proposal))))
            c.execute(cases.update().where(cases.c.id==case_id).values(state='PENDIENTE_REVISION_HUMANA'))
            event(c, user, 'PLAN_PROPUESTO', case_id, {'plan_sha256':digest(canonical(proposal)), 'revision':record['revision'], 'plan':proposal})
        return {'revision':record['revision'], 'plan':proposal, 'plan_sha256':digest(canonical(proposal))}

    @router.post('/cases/{case_id}/review')
    def review(case_id: str, payload: Review, request: Request):
        user = actor(request, write=True)
        if payload.decision not in ['ACEPTAR_PLAN_OPERATIVO', 'DEVOLVER_PARA_CORREGIR']:
            raise HTTPException(422, 'Solo se permite revisión operativa; no certificación profesional o jurídica')
        with engine.begin() as c:
            record = owned(c, case_id, user)
            saved = c.execute(select(plans).where(plans.c.case_id==case_id, plans.c.organization_id==user['organization_id'])).mappings().first()
            if not saved or payload.revision != record['revision'] or saved['case_revision'] != record['revision']:
                raise HTTPException(409, 'No existe un plan vigente para revisar')
            if payload.plan_sha256 != saved['sha256']:
                raise HTTPException(409, 'La propuesta cambió; revisa el plan vigente antes de decidir')
            result = {'actor':user['id'], 'decision':payload.decision, 'comment':payload.comment, 'plan_sha256':saved['sha256'],
                      'professional_validation':False, 'official_submission':False}
            c.execute(plans.update().where(plans.c.case_id==case_id).values(review=canonical(result)))
            c.execute(cases.update().where(cases.c.id==case_id).values(state='PLAN_OPERATIVO_REVISADO' if payload.decision=='ACEPTAR_PLAN_OPERATIVO' else 'CORRECCION_SOLICITADA'))
            event(c, user, 'PLAN_REVISADO', case_id, result)
        return result

    @router.get('/cases/{case_id}/audit')
    def history(case_id: str, request: Request):
        user = actor(request)
        with engine.connect() as c:
            owned(c, case_id, user)
            return [dict(x) for x in c.execute(select(audit).where(audit.c.case_id==case_id, audit.c.organization_id==user['organization_id']).order_by(audit.c.sequence)).mappings()]

    return router

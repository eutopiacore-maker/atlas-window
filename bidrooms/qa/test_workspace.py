"""Persistencia y permisos reales; inferencia nunca sustituida por respuestas simuladas."""
import importlib.util, os, pathlib, tempfile, unittest, uuid, hashlib
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('workspace',ROOT/'backend/app/workspace.py')
w=importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
ORIGIN='http://testserver'
class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.engine=create_engine('sqlite:///'+self.temp.name+'/test.sqlite',connect_args={'check_same_thread':False})
        w.migrate(self.engine)
        self.orgs=[str(uuid.uuid4()),str(uuid.uuid4())]
        with self.engine.begin() as c:
            c.execute(w.organizations.insert(),[{'id':x,'name':'Organización QA '+str(i)} for i,x in enumerate(self.orgs)])
        for email,org,role in [('a@qa.invalid',self.orgs[0],'OWNER'),('b@qa.invalid',self.orgs[1],'OWNER'),('v@qa.invalid',self.orgs[0],'VIEWER')]:
            w.provision(self.engine,email,'solo-qa-contraseña-123',org,role)
        self.app=FastAPI()
        self.app.include_router(w.make_router(self.engine,os.getenv('BIDROOMS_SHARED_ROOT'),allowed_origins=(ORIGIN,),qa=True))
        self.client=TestClient(self.app); self.headers={'Origin':ORIGIN}
    def tearDown(self):
        self.client.close(); self.engine.dispose(); self.temp.cleanup()
    def login(self,email='a@qa.invalid'):
        r=self.client.post('/api/v1/workspace/session',json={'email':email,'password':'solo-qa-contraseña-123'},headers={'Origin':ORIGIN})
        self.assertEqual(r.status_code,200,r.text)
        self.headers={'Origin':ORIGIN,'X-BR-CSRF':r.json()['csrf']}
        return r
    def case(self):
        r=self.client.post('/api/v1/workspace/cases',json={'objective':'Tengo documentos y plazos. Ayúdame a organizar el trabajo.'},headers=self.headers)
        self.assertEqual(r.status_code,201,r.text); return r.json()
    def test_cross_organization_and_no_session(self):
        self.assertEqual(self.client.get('/api/v1/workspace/cases').status_code,401)
        self.login(); a=self.case(); self.login('b@qa.invalid')
        for suffix in ['', '/audit', '/documents/'+str(uuid.uuid4())]:
            self.assertEqual(self.client.get('/api/v1/workspace/cases/'+a['id']+suffix).status_code,404)
        r=self.client.post('/api/v1/workspace/cases/'+a['id']+'/documents',content=b'Se requiere licencia.',headers={**self.headers,'X-Document-Name':'qa.txt','If-Match':'1'})
        self.assertEqual(r.status_code,404)
        self.assertEqual(self.client.get('/api/v1/workspace/cases').json(),[])
    def test_csrf_origin_viewer_and_logout(self):
        self.login()
        payload={'objective':'Ordenar documentos empresariales'}
        self.assertEqual(self.client.post('/api/v1/workspace/cases',json=payload,headers={'Origin':ORIGIN}).status_code,403)
        self.assertEqual(self.client.post('/api/v1/workspace/cases',json=payload,headers={**self.headers,'Origin':'https://intruso.invalid'}).status_code,403)
        self.login('v@qa.invalid')
        self.assertEqual(self.client.post('/api/v1/workspace/cases',json=payload,headers=self.headers).status_code,403)
        self.assertEqual(self.client.delete('/api/v1/workspace/session',headers=self.headers).status_code,200)
        self.assertEqual(self.client.get('/api/v1/workspace/session').status_code,401)
    def test_authentication_hash_and_rate_limit(self):
        r=self.login(); self.assertIn('HttpOnly',r.headers['set-cookie']); self.assertFalse(r.json()['legal_identity_verified'])
        with self.engine.connect() as c:
            self.assertTrue(c.execute(select(w.users.c.password_hash)).first()[0].startswith('scrypt$'))
        for _ in range(8):
            self.assertEqual(self.client.post('/api/v1/workspace/session',json={'email':'otro@qa.invalid','password':'incorrecta'},headers={'Origin':ORIGIN}).status_code,401)
        self.assertEqual(self.client.post('/api/v1/workspace/session',json={'email':'otro@qa.invalid','password':'incorrecta'},headers={'Origin':ORIGIN}).status_code,429)
    def test_restart_persistence_and_audit_chain(self):
        self.login(); case=self.case(); self.engine.dispose()
        client=TestClient(self.app); client.cookies.update(self.client.cookies)
        self.assertEqual(client.get('/api/v1/workspace/cases/'+case['id']).json()['objective'],case['objective'])
        with self.engine.connect() as c:
            rows=[dict(x) for x in c.execute(select(w.audit).order_by(w.audit.c.created_at)).mappings()]
        previous='0'*64
        for row in rows:
            self.assertEqual(row['previous_hash'],previous); previous=row.pop('entry_hash')
            self.assertEqual(previous,w.digest(w.canonical(row)))
        client.close()
    def test_review_cannot_assert_certification_or_unobserved_plan(self):
        self.login(); case=self.case()
        for decision,status in [('CERTIFICAR_CUMPLIMIENTO',422),('ACEPTAR_PLAN_OPERATIVO',409)]:
            r=self.client.post('/api/v1/workspace/cases/'+case['id']+'/review',json={'revision':1,'plan_sha256':'0'*64,'decision':decision,'comment':'Prueba sin certificación'},headers=self.headers)
            self.assertEqual(r.status_code,status)
    @unittest.skipUnless(os.getenv('BIDROOMS_SHARED_ROOT'),'Motor privado no disponible; no usar simulación')
    def test_real_inference_citations_conflict_and_review(self):
        self.login(); case=self.case()
        raw='Se requiere garantía bancaria. Fecha de presentación: 2026-10-19.\nNo se requiere licencia adicional.'.encode()
        path='/api/v1/workspace/cases/'+case['id']
        r=self.client.post(path+'/documents',content=raw,headers={**self.headers,'If-Match':'1','X-Document-Name':'qa.txt'})
        self.assertEqual(r.status_code,201,r.text); self.assertEqual(r.json()['sha256'],hashlib.sha256(raw).hexdigest())
        doc=r.json()['id']; self.assertEqual(self.client.get(path+'/documents/'+doc).content,raw)
        self.assertEqual(self.client.post(path+'/documents',content=raw,headers={**self.headers,'If-Match':'1','X-Document-Name':'qa.txt'}).status_code,409)
        r=self.client.post(path+'/plan',headers=self.headers); self.assertEqual(r.status_code,200,r.text); p=r.json()
        self.assertFalse(p['plan']['llm_active']); self.assertGreater(len(p['plan']['actions']),0)
        for action in p['plan']['actions']:
            self.assertIn(action['source']['quote'],raw.decode())
            self.assertEqual(action['source']['document_sha256'],hashlib.sha256(raw).hexdigest())
        r=self.client.post(path+'/review',json={'revision':2,'plan_sha256':p['plan_sha256'],'decision':'ACEPTAR_PLAN_OPERATIVO','comment':'Revisión operativa de prueba; no profesional'},headers=self.headers)
        self.assertEqual(r.status_code,200,r.text); self.assertFalse(r.json()['professional_validation'])
        self.login('b@qa.invalid'); self.assertEqual(self.client.get(path+'/documents/'+doc).status_code,404)
    @unittest.skipUnless(os.getenv('BIDROOMS_SHARED_ROOT'),'Motor privado no disponible; no usar simulación')
    def test_failed_document_atomicity(self):
        self.login(); case=self.case(); path='/api/v1/workspace/cases/'+case['id']
        r=self.client.post(path+'/documents',content=b'<html>Not a PDF</html>',headers={**self.headers,'If-Match':'1','X-Document-Name':'qa.pdf'})
        self.assertEqual(r.status_code,422)
        saved=self.client.get(path).json(); self.assertEqual(saved['revision'],1); self.assertEqual(saved['documents'],[])
        self.assertEqual(self.client.get(path+'/audit').json()[-1]['action'],'ANALISIS_RECHAZADO')
if __name__=='__main__': unittest.main()

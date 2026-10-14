"""QA HTTP canónica con originales públicos y usuarios temporales; sin inferencia simulada."""
import argparse, concurrent.futures, hashlib, importlib.util, json, os, pathlib, secrets, shutil, sqlite3, subprocess, sys, tempfile, time, uuid
import httpx
from sqlalchemy import create_engine
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:8892'
spec=importlib.util.spec_from_file_location('workspace',ROOT/'backend/app/workspace.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--corpus',type=pathlib.Path,required=True)
    parser.add_argument('--out',type=pathlib.Path,required=True)
    args=parser.parse_args()
    shared=os.environ.get('BIDROOMS_SHARED_ROOT')
    if not shared:raise SystemExit('Motor compartido requerido; no simular inferencia')
    with tempfile.TemporaryDirectory(prefix='bidrooms-http-qa-') as directory:
        directory=pathlib.Path(directory);database=directory/'workspace.sqlite'
        engine=create_engine('sqlite:///'+str(database));w.migrate(engine)
        orgs=[str(uuid.uuid4()),str(uuid.uuid4())]
        with engine.begin() as c:c.execute(w.organizations.insert(),[{'id':x,'name':'QA_HTTP_'+str(i)} for i,x in enumerate(orgs)])
        password=secrets.token_urlsafe(24)
        for i,org in enumerate(orgs):w.provision(engine,'qa'+str(i)+'@invalid.example',password,org)
        w.provision(engine,'viewer@invalid.example',password,orgs[0],'VIEWER')
        engine.dispose()
        env={**os.environ,'DATABASE_URL':'sqlite:///'+str(database),'BIDROOMS_QA_MODE':'1','BIDROOMS_ALLOWED_ORIGINS':BASE,'BIDROOMS_SHARED_ROOT':shared}
        server=None;clients=[]
        def start():
            process=subprocess.Popen([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8892'],cwd=ROOT/'backend',env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            for _ in range(60):
                if process.poll() is not None:raise RuntimeError(process.stderr.read().decode()[:1500])
                try:
                    if httpx.get(BASE+'/api/v1/workspace/status',timeout=3,trust_env=False).json()['ready']:return process
                except Exception:pass
                time.sleep(.1)
            process.terminate();raise RuntimeError('Servidor o motor no disponible; prueba bloqueada')
        def stop(process):
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait()
        try:
            server=start()
            for i in range(2):
                client=httpx.Client(base_url=BASE,headers={'Origin':BASE},timeout=120,trust_env=False)
                r=client.post('/api/v1/workspace/session',json={'email':'qa'+str(i)+'@invalid.example','password':password});assert r.status_code==200,r.text
                client.headers['X-BR-CSRF']=r.json()['csrf'];clients.append(client)
            def execute(index,filename):
                client=clients[index];raw=(args.corpus/filename).read_bytes()
                c=client.post('/api/v1/workspace/cases',json={'objective':'Tengo estos documentos y plazos. Ordénalos y ayúdame a planificar el trabajo.'});assert c.status_code==201,c.text
                record=c.json();path='/api/v1/workspace/cases/'+record['id']
                uploaded=client.post(path+'/documents',content=raw,headers={'X-Document-Name':filename,'If-Match':'1'});assert uploaded.status_code==201,uploaded.text
                receipt=uploaded.json();expected=hashlib.sha256(raw).hexdigest();assert receipt['sha256']==expected
                assert client.get(path+'/documents/'+receipt['id']).content==raw
                proposal=client.post(path+'/plan');assert proposal.status_code==200,proposal.text
                proposal=proposal.json();plan=proposal['plan'];assert plan['actions'] and not plan['llm_active']
                analysis=receipt['analysis']
                for action in plan['actions']:
                    source=action['source'];assert source['document_sha256']==expected
                    unit=next(p for p in analysis['pages'] if p['page']==source['page'] and p.get('section')==source['section'])
                    assert source['quote'] in unit['text']
                review=client.post(path+'/review',json={'revision':2,'plan_sha256':proposal['plan_sha256'],'decision':'ACEPTAR_PLAN_OPERATIVO','comment':'QA automatizado de revisión; no evaluación profesional.'});assert review.status_code==200,review.text
                assert not review.json()['professional_validation']
                return {'case_id':record['id'],'organization_id':orgs[index],'filename':filename,'sha256':expected,'document_id':receipt['id'],
                        'candidates':analysis['metrics']['candidates'],'plan_actions':len(plan['actions']),'remaining_actions':plan['remaining_actions'],
                        'literal_verified':analysis['metrics']['literal_verified'],'automated_review_contract':True,'professional_review':False}
            began=time.perf_counter()
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures=[pool.submit(execute,i,f) for i,f in enumerate(['mupa-pliego.pdf','unops-instructions.pdf'])]
                records=[f.result() for f in futures]
            for index,record in enumerate(records):
                other=clients[1-index];path='/api/v1/workspace/cases/'+record['case_id']
                assert other.get(path).status_code==404
                assert other.get(path+'/documents/'+record['document_id']).status_code==404
                assert other.get(path+'/audit').status_code==404
            path='/api/v1/workspace/cases/'+records[0]['case_id'];before=clients[0].get(path).json()
            failed=clients[0].post(path+'/documents',content=b'Not a PDF',headers={'X-Document-Name':'qa-invalid.pdf','If-Match':'2'})
            assert failed.status_code==422
            after=clients[0].get(path).json();assert before['revision']==after['revision'] and before['documents']==after['documents']
            assert clients[0].patch(path,json={'objective':'Objetivo de otra revisión'},headers={'If-Match':'1'}).status_code==409
            assert clients[0].get(path).json()['objective']==before['objective']
            stop(server);server=start()
            for client,record in zip(clients,records):
                saved=client.get('/api/v1/workspace/cases/'+record['case_id']);assert saved.status_code==200,saved.text
                assert saved.json()['review']['decision']=='ACEPTAR_PLAN_OPERATIVO'
            stop(server);server=None
            backup=directory/'backup.sqlite'
            with sqlite3.connect(database) as source,sqlite3.connect(backup) as target:source.backup(target)
            with sqlite3.connect(backup) as recovered:
                assert recovered.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
                assert not recovered.execute('PRAGMA foreign_key_check').fetchall()
                assert recovered.execute('SELECT count(*) FROM bidrooms_need_documents').fetchone()[0]==2
            database.unlink();shutil.copy2(backup,database);server=start()
            assert clients[0].get(path).json()['review']['decision']=='ACEPTAR_PLAN_OPERATIVO'
            report={'schema':'bidrooms-real-http-qa/v1','passed':True,'transport':'Real loopback HTTP + canonical FastAPI + real shared subprocess',
                    'simultaneous':True,'cases':records,'processing_and_checks_ms':round((time.perf_counter()-began)*1000,2),
                    'cross_org_case_document_audit':'PASS','failed_upload_atomicity':'PASS','stale_edit_preserves_goal':'PASS',
                    'server_process_restart_session_data':'PASS','backup_restore_integrity':'PASS','browser_executed':False,
                    'production_backend_tested':False,'human_professional_evaluation':False,'real_users_affected':False}
            args.out.parent.mkdir(parents=True,exist_ok=True);args.out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps(report,ensure_ascii=False))
        finally:
            if server:stop(server)
            for client in clients:client.close()
if __name__=='__main__':main()

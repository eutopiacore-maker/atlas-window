"""Navegador real sobre la aplicación canónica; datos y usuarios QA efímeros."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

import httpx
from sqlalchemy import create_engine

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'http://127.0.0.1:8894'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if not os.environ.get('BIDROOMS_SHARED_ROOT'):
        raise SystemExit('Motor real compartido requerido; prueba bloqueada')
    spec = importlib.util.spec_from_file_location('workspace_qa', ROOT / 'backend/app/workspace.py')
    workspace = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(workspace)
    with tempfile.TemporaryDirectory(prefix='bidrooms-private-browser-') as directory:
        temporary = Path(directory)
        static = temporary / 'public/bidrooms'
        static.mkdir(parents=True)
        for name in ['assets', 'data', 'organizations', 'rooms', 'room', 'acp-215164']:
            shutil.copytree(ROOT / name, static / name)
        shutil.copy2(ROOT / 'index.html', static / 'index.html')
        database = temporary / 'qa.sqlite'
        engine = create_engine('sqlite:///' + str(database))
        workspace.migrate(engine)
        orgs = [str(uuid.uuid4()), str(uuid.uuid4())]
        with engine.begin() as connection:
            connection.execute(workspace.organizations.insert(),
                               [{'id': value, 'name': 'QA_BROWSER_' + str(i)} for i, value in enumerate(orgs)])
        password = secrets.token_urlsafe(24)
        users = []
        for i, org in enumerate(orgs):
            email = 'qa-browser-' + str(i) + '@invalid.example'
            workspace.provision(engine, email, password, org)
            users.append({'email': email, 'password': password, 'organization_id': org})
        engine.dispose()
        config = temporary / 'config.json'
        config.write_text(json.dumps({'origin': ORIGIN, 'users': users,
                                     'corpus': str(args.corpus.resolve()), 'out': str(args.out.resolve()),
                                     'public_root': str(static)}))
        config.chmod(0o600)
        (temporary / 'qa_app.py').write_text(
            'from app.main import app\nfrom fastapi.staticfiles import StaticFiles\n'
            + 'app.mount("/bidrooms", StaticFiles(directory=' + repr(str(static)) + ', html=True))\n')
        env = {**os.environ, 'DATABASE_URL': 'sqlite:///' + str(database), 'BIDROOMS_QA_MODE': '1',
               'BIDROOMS_ALLOWED_ORIGINS': ORIGIN, 'BIDROOMS_QA_CONFIG': str(config),
               'PYTHONPATH': str(temporary) + os.pathsep + str(ROOT / 'backend')}
        with (temporary / 'server.log').open('w+') as log:
            server = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'qa_app:app', '--host',
                                       '127.0.0.1', '--port', '8894'], cwd=ROOT / 'backend', env=env,
                                      stdout=log, stderr=subprocess.STDOUT)
            try:
                for _ in range(80):
                    if server.poll() is not None:
                        log.seek(0)
                        raise RuntimeError(log.read()[-1800:])
                    try:
                        status = httpx.get(ORIGIN + '/api/v1/workspace/status', timeout=3, trust_env=False)
                        if status.status_code == 200 and status.json()['ready']:
                            break
                    except (httpx.HTTPError, ValueError):
                        pass
                    time.sleep(.1)
                else:
                    raise RuntimeError('API o motor no disponibles; prueba bloqueada')
                subprocess.run(['node', str(ROOT / 'qa/private_browser.mjs')], cwd=ROOT.parent,
                               env=env, check=True, timeout=180)
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == '__main__':
    main()

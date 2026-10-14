"""Migración aditiva al backend existente. No crea ni migra identidades."""
import os
from sqlalchemy import create_engine
from app.workspace import migrate

if __name__ == '__main__':
    url=os.environ.get('DATABASE_URL')
    if not url:
        raise SystemExit('DATABASE_URL no configurada')
    migrate(create_engine(url, pool_pre_ping=True))
    print('BIDROOMS_WORKSPACE_MIGRATION_OK')

# BIDROOMS

BIDROOMS is now split into a public data-driven application and a deploy-ready private/API layer.

## Public application

GitHub Pages serves:

- `/bidrooms/` — public search/directory
- `/bidrooms/rooms/` — procurement directory
- `/bidrooms/organizations/acp/` — ACP public profile
- `/bidrooms/acp-215164/` — first data-driven procurement room

The UI reads canonical JSON from `bidrooms/data/`. A new room does **not** require redesigning the app.

## Update path

1. Add or update `data/rooms/<room-id>.json`.
2. Add the room reference to `data/manifest.json`.
3. If the owner is new, add `data/organizations/<organization-id>.json`.
4. Reuse the same public room shell. For a stable pretty URL, copy the small room shell and change only `data-room-id`.
5. Push/merge. GitHub Actions runs `scripts/validate_public_data.py`; GitHub Pages deploys if validation succeeds.

The schema is deliberately frontend/backend compatible: later the same JSON shape can come from `/api/v1` instead of static files without redesigning the UI.

## Backend path

`backend/` contains a FastAPI/PostgreSQL starting point and SQL migration with separate domains:

- `public_registry`
- `operations`
- `evidence`
- `finance`

Run locally:

```bash
cd bidrooms/backend
docker build -t bidrooms-api .
docker run --rm -p 8080:8080 -e DATABASE_URL='postgresql+psycopg://...' bidrooms-api
```

Apply `migrations/001_init.sql` to PostgreSQL before using intake.

## Privacy boundary

Public BIDROOMS has no personal accounts. Representative identity and government ID belong only to the private operations domain. Do not put raw identity data in public JSON, URLs, analytics, or browser storage.

## Current limitation

GitHub Pages hosts only the public application. The FastAPI/PostgreSQL service is committed and deploy-ready but is not yet hosted. Until an API URL is configured, representative intake uses the existing ATLAS email fallback.

# BIDROOMS SYSTEM STATE

status: DATA_DRIVEN_PUBLIC_APP_ACTIVE
updated: 2026-10-02
public_surface: GitHub Pages
design_canon: luxury + nature + executive + Panama dark gradients + smoked glass
public_accounts: false

## Active objects
- organization: acp
- procurement room: acp-215164

## Canonical public data
- data/manifest.json
- data/organizations/*.json
- data/rooms/*.json

## Shared runtime
- assets/theme.css
- assets/app.js
- assets/config.js
- room/index.html (generic renderer)
- acp-215164/index.html (stable pretty URL shell)

## Update contract
A new procurement normally requires only:
1. data/rooms/<id>.json
2. manifest.json entry using route room/?id=<id>
3. organization JSON only if the owner is new

No visual rebuild is required.

## Private/API path
- backend/app/main.py
- backend/migrations/001_init.sql
- backend/Dockerfile
- representative government ID hashed before database storage

## Validation
- scripts/validate_public_data.py
- .github/workflows/bidrooms-validate.yml
- JSON validation
- Python compile check
- JavaScript syntax check

## Current boundary
Public app: deployed/static/data-driven.
Private API + PostgreSQL: code present, not hosted yet.
Intake fallback until API deployment: ATLAS email.

## Next action
Deploy PostgreSQL + FastAPI → set assets/config.js apiBase → switch representative intake automatically to POST /api/v1/intake → build ACP source-sync against the same room schema.

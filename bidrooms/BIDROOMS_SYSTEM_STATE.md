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

## Public runtime
- assets/theme.css
- assets/app.js
- index.html
- rooms/index.html
- organizations/acp/index.html
- acp-215164/index.html

## Private/API path
- backend/app/main.py
- backend/migrations/001_init.sql
- backend/Dockerfile

## Validation
- scripts/validate_public_data.py
- .github/workflows/bidrooms-validate.yml

## Next action
Deploy PostgreSQL + FastAPI, set a real API base, move intake from mailto to POST /api/v1/intake, then build ACP source-sync against the same room schema.

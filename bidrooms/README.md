# BIDROOMS

BIDROOMS is now a data-driven public application with a deploy-ready private/API layer.

## Public application

GitHub Pages serves:

- `/bidrooms/` — search and public directory
- `/bidrooms/rooms/` — procurement directory
- `/bidrooms/organizations/acp/` — ACP public profile
- `/bidrooms/acp-215164/` — first stable pretty URL
- `/bidrooms/room/?id=<room-id>` — generic room renderer for future procurement cases

The visual system is shared through `assets/theme.css`. Room behavior is shared through `assets/app.js`.

## Canonical data / update path

The source of truth for the public app is now data, not page markup.

1. Add or update `data/rooms/<room-id>.json`.
2. Add its entry to `data/manifest.json`.
3. If the owner is new, add `data/organizations/<organization-id>.json`.
4. Point the manifest route to `room/?id=<room-id>`. No new room HTML is required.
5. Push/merge. `BIDROOMS Validate` checks JSON, Python and JavaScript. GitHub Pages then deploys the new public state.

The ACP 215164 pretty URL is only a small shell that consumes the same JSON/runtime.

## Runtime configuration seam

`assets/config.js` contains:

```js
window.BIDROOMS_CONFIG={apiBase:""};
```

While `apiBase` is blank, private representative intake falls back to ATLAS email. When the FastAPI service is deployed, put its HTTPS origin in `apiBase`; the same form will POST to `/api/v1/intake` without redesigning the interface.

## Backend path

`backend/` contains FastAPI + PostgreSQL:

- `public_registry`
- `operations`
- `evidence`
- `finance`

Representative government ID is hashed server-side before storage; raw ID is not written to PostgreSQL.

Run locally:

```bash
cd bidrooms/backend
docker build -t bidrooms-api .
docker run --rm -p 8080:8080 -e DATABASE_URL='postgresql+psycopg://...' bidrooms-api
```

Apply `migrations/001_init.sql` first.

## Current production boundary

The public data-driven application is deployable on GitHub Pages now. The FastAPI/PostgreSQL service is committed but still requires a host and database before private intake can become server-persistent.

## Next infrastructure step

Deploy PostgreSQL + FastAPI, set `assets/config.js` to that API origin, then add ACP source-sync that writes verified changes into the same procurement-room schema.

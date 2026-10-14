# BidRooms

Producto de ATLAS en su aplicación existente: https://eutopiacore-maker.github.io/atlas-window/bidrooms/ . La versión y la evidencia vigentes constan en [BIDROOMS_SYSTEM_STATE.md](BIDROOMS_SYSTEM_STATE.md).

La entrada principal parte de una necesidad expresada libremente y de sus documentos. El registro público explica sus fuentes y límites. Cuando una API privada verificada esté disponible, el mismo producto incorpora documentos, conserva contexto, propone trabajo trazable y solicita revisión operativa. No confirma elegibilidad ni sustituye autoridades profesionales.

## Fuentes y rutas

- `data/manifest.json`: versión, compilación, organizaciones, salas y recursos de esta superficie pública.
- `data/rooms/` y `data/organizations/`: referencias documentales públicas y estados parciales.
- `/bidrooms/`: objetivo libre y exploración sin cuenta.
- `/bidrooms/rooms/`, `/bidrooms/organizations/` y `/bidrooms/room/?id=<id>`: navegación existente.
- `/bidrooms/acp-215164/`: ruta histórica conservada.
- `assets/needs.js`: objetivos, sesiones privadas habilitadas, documentos, planes, revisión y borradores separados por organización, usuario y expediente.
- `assets/navigation.js`: comprobación discreta de compilación, precarga y transición segura; no reemplaza JavaScript en ejecución. Conserva recursos anteriores y pospone transiciones que perderían trabajo.

## API y configuración

`backend/` conserva la única API canónica FastAPI. `/api/v1/workspace` incluye sesiones, casos por organización, documentos, planes, revisión y auditoría. Contraseñas con scrypt, sesiones HttpOnly, protección CSRF/origen, autorización en servidor, revisión de versiones, originales con hash y cuotas documentales. El registro de una cuenta no verifica identidad empresarial o representación legal.

En producción, `assets/config.js` mantiene `apiBase:""`: los controles privados están deshabilitados. Ya no existe una incorporación privada efectiva por correo ni se solicita identificación gubernamental desde la interfaz. La incorporación histórica permanece deshabilitada por defecto.

La infraestructura privada debe verificar `DATABASE_URL`, migración explícita, provisionado autorizado de identidades, `BIDROOMS_ALLOWED_ORIGINS` y el motor compartido autorizado mediante `BIDROOMS_SHARED_ROOT`. El motor privado no se copia a este repositorio público. La configuración de QA por HTTP local es exclusiva de pruebas; producción requiere HTTPS y cookies seguras. La topología de despliegue debe permitir las sesiones SameSite Strict bajo un origen compatible; una API arbitraria en otro sitio no basta.

`backend/migrate_workspace.py` administra la migración aditiva del espacio privado. Las tablas históricas tienen su migración en `backend/migrations/001_init.sql`. PostgreSQL está previsto, pero su operación en producción no se ha probado; SQLite real se utilizó en las pruebas locales de persistencia y recuperación.

## Controles y promoción

`scripts/build_public.py` produce recursos por contenido y manifiesto/HTML con compilación única. `scripts/validate_public_data.py`, `qa/test_public.py`, `qa/test_workspace.py` y `qa/browser.mjs` verifican integridad, contratos y navegación. `qa/real_workspace_http.py` y `qa/private_browser.py` ejecutan el flujo privado con originales oficiales y usuarios temporales cuando el motor real está disponible. No sustituyen inferencia con respuestas simuladas.

La promoción exige pruebas, rama/PR revisable, CI, despliegue Pages y comprobación posterior de la URL auténtica. Una prueba omitida o bloqueada no cuenta como aprobada. Las pruebas privadas locales no implican un backend productivo alojado. Conservar recursos previos permite reversión pública; la recuperación de datos privados debe verificarse en su infraestructura antes de habilitarla.

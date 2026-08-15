# Atlas Add-ons

## Product idea
Atlas exposes growth as **Add-ons**, not as runtimes, packages or services. The user sees a small catalog with a name, one-line purpose, version, state and a single primary action such as `Instalar`, `Actualizar` or `Abrir`.

Behind that simple surface, every add-on is a signed/versioned capability package for the Atlas Host Rizoma.

## Install lifecycle
`DISCOVER -> RESOLVE -> STAGE -> VERIFY -> SELF-TEST -> ACTIVATE -> HEALTH-GATE -> READY`

Failure at any point returns to the last-known-good state automatically.

## Restart policy
An add-on declares the smallest restart scope it needs:
1. `none` — hot-load/hot-swap.
2. `capability` — restart only the affected Atlas capability.
3. `atlas-shell` — restart the Atlas desktop shell.
4. `host-service` — restart the Atlas Host supervisor/runtime service.
5. `os-reboot` — permitted only for a genuine OS/driver prerequisite and never used as the normal install path.

The installer chooses the minimum valid scope. A complete Windows reboot is a last resort, not a convenience.

## Add-on manifest contract
Each add-on declares:
- stable id, display name, version and publisher;
- short human description;
- provided capability contracts;
- required/optional capabilities;
- compatible OS/hardware/runtime constraints;
- artifact hashes/signature metadata;
- resource hints;
- declared permissions;
- health probe and benchmark profile;
- restart policy;
- rollback compatibility;
- optional UI entry point;
- release notes.

The Host Node resolves dependencies automatically. The UI never asks the user to install Python, CUDA, codecs or similar implementation details manually.

## Catalog states
- `available` — can be installed on this node.
- `installed` — active and healthy.
- `update` — newer compatible version available.
- `incompatible` — current node cannot satisfy requirements.
- `development` — known add-on not yet publishable.
- `recovering` — repairing/rolling back automatically.

## Publishing workflow
When a new Atlas capability is finished:
1. build a versioned capability package;
2. run CI contract/security/benchmark checks;
3. publish immutable artifacts by content hash;
4. add/update the catalog entry;
5. trusted Host Nodes discover it automatically.

Nothing is pushed directly into a working node. Installation always goes through staging, verification and rollback gates.

## UI rule
The interface is deliberately non-technical. Advanced diagnostics exist, but are secondary. Default navigation is:
- **Eutopia** — desktop view of the live Eutopia window.
- **Add-ons** — discover/install/update capabilities.
- **Activity** — concise install/update/recovery history.
- **System** — node health and resources, summarized for humans.

No dashboard wall of metrics on the home screen.

## Relationship to Rizoma
An Add-on may contribute one capability node or an entire compatible subgraph. Consumers do not call the add-on by package name; they request an outcome. The capability broker decides whether and when that add-on participates in the best route.

This keeps the Garry's-Mod-like simplicity at the surface while preserving the Rizoma architecture underneath.
# Atlas Host — One-Time Adaptive Bootstrap

## Goal
The user's one-time action should install the smallest durable substrate that lets Atlas provision, update, repair and expand itself afterward without recurring manual installation.

The bootstrap must adapt to the actual PC rather than assuming GPU vendor, RAM, Windows build or driver stack in advance.

## Phase 0 — Preflight
- detect OS/build/architecture
- detect administrator/elevation availability
- detect CPU/GPU/VRAM/RAM/storage/network
- detect supported compute backends and drivers
- check disk and power constraints
- create an installation transaction journal

A failed preflight changes nothing permanent.

## Phase 1 — Durable substrate
Install/register:
- Atlas supervisor service with automatic boot start
- node identity/trust material
- managed Atlas root directory
- A/B runtime slots + rescue slot
- desired-state reconciler
- artifact/model cache
- capability registry
- scheduler/work queue
- event/telemetry journal
- outbound transport manager
- sandbox executor
- secrets-vault interface
- Atlas desktop shell
- Add-ons catalog client + installer bridge

The supervisor must start independently of any model, translator or optional runtime. The desktop shell is replaceable UI; it must never be required for recovery or background operation.

## Phase 2 — Hardware profile
Publish a machine-readable hardware/software fingerprint and benchmark basic CPU/GPU/storage/network primitives.

This profile drives later capability selection. Atlas must not install CUDA, DirectML, ROCm, ONNX, PyTorch variants or other heavy stacks merely because they exist; it selects compatible routes from measured hardware.

## Phase 3 — Foundation toolchains
Provision only the minimal managed toolchains justified by active workloads and capability packages. Candidate families include Python, Node, media codecs, native build tools and inference runtimes.

These live in Atlas-managed locations and remain replaceable.

## Phase 4 — Product shell + Add-ons
The desktop shell opens to **Eutopia** and exposes four intentionally simple surfaces:
- Eutopia
- Add-ons
- Activity
- System

The Add-ons surface reads the versioned catalog. A user-facing capability is installed with one action. Atlas resolves all technical dependencies automatically, stages and verifies the package, runs health checks, activates atomically and rolls back on failure.

Restart scope is minimized automatically:
`none -> capability -> atlas-shell -> host-service -> os-reboot`

A full OS reboot is used only for genuine driver/OS prerequisites, never as the default add-on installation behavior.

## Phase 5 — First workload activation
Request Layer 3 through the capability broker:
`need = temporally coherent image-to-image translation`

The broker resolves the best compatible model/runtime path for the detected PC, provisions it, benchmarks it, and activates only if health and quality gates pass.

If Layer 3 cannot yet satisfy its floor, Layers 1 and 2 remain unaffected while the node reports a structured capability gap.

## Phase 6 — Autonomous mode
After successful substrate health checks:
- supervisor owns future convergence
- repository/live desired state drives changes
- node reconnects after boot, sleep and network loss
- capability packages can be installed/replaced automatically
- approved user-facing add-ons can self-resolve dependencies
- new finished add-ons appear in the catalog without reinstalling Atlas Host
- bad updates roll back
- missing dependencies become self-provisioning tasks
- no routine user operation is expected

## Recovery during bootstrap
Every permanent mutation is journaled. Bootstrap is transactional:
- failure before service activation -> remove staged substrate
- failure after service activation -> supervisor enters rescue mode
- capability failure -> preserve substrate and mark capability unavailable
- shell failure -> supervisor remains operational and restores/replaces the shell

Never leave the PC dependent on a half-installed translator or a broken UI.

## Upgrade path
The bootstrap itself is not rerun for ordinary growth. Future expansion occurs through supervisor/capability/add-on updates.

A new bootstrap should be required only if an OS-level prerequisite genuinely cannot be established by the installed supervisor under its permitted privilege model.

## Success criteria
Bootstrap is complete only when:
1. supervisor survives reboot/service restart;
2. node can detect offline/online transitions and reconnect automatically;
3. desired state can be changed remotely and converged without user interaction;
4. A/B update and rollback are verified;
5. resource inventory is published;
6. capability package install/remove is verified;
7. Add-ons catalog can discover and install a compatible test package end-to-end;
8. desktop shell can be replaced/restarted without breaking supervisor recovery;
9. Layer 2 remains usable while the node is unavailable;
10. Layer 3 can request a route through the broker rather than being hard-wired to one runtime.

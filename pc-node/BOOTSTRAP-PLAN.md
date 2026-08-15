# Atlas Host — One-Time Adaptive Bootstrap

## Goal
The user's one-time action should install the smallest durable substrate that lets Atlas provision, update, repair and expand itself afterward without recurring manual installation.

The bootstrap must adapt to the actual PC rather than assuming GPU vendor, RAM, Windows build or driver stack in advance.

A second invariant now applies: **Eutopia's causal world must not depend on the UI or internet connection to keep time.**

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
- Atlas privileged helper service for contract-scoped maintenance without recurring interactive UAC
- persistent Eutopia World Runtime
- node identity/trust material
- managed Atlas root directory
- A/B runtime slots + rescue slot
- desired-state reconciler
- artifact/model cache
- capability registry
- scheduler/work queue
- causal world event journal + atomic checkpoints
- event/telemetry journal
- outbound transport manager
- sandbox executor
- secrets-vault interface
- Atlas desktop shell
- Add-ons catalog client + installer bridge

The supervisor and World Runtime must start independently of any model, translator, browser or optional runtime. The desktop shell is replaceable UI; it must never be required for recovery or background world operation.

## Phase 2 — World continuity validation
Before heavy capabilities are installed, verify the causal substrate itself:
- World Runtime advances with desktop shell closed;
- World Runtime advances with network disconnected;
- checkpoints survive process/service restart;
- deterministic event-stream/random state is persisted;
- simulated elapsed-time catch-up works after an intentional shutdown interval;
- observer reconnect loads current authoritative sequence rather than stale browser state;
- GitHub/cloud failure does not pause local world time.

The world is not considered safely installed until these tests pass.

## Phase 3 — Hardware profile
Publish a machine-readable hardware/software fingerprint and benchmark basic CPU/GPU/storage/network primitives.

This profile drives later capability selection. Atlas must not install CUDA, DirectML, ROCm, ONNX, PyTorch variants or other heavy stacks merely because they exist; it selects compatible routes from measured hardware.

## Phase 4 — Foundation toolchains
Provision only the minimal managed toolchains justified by active workloads and capability packages. Candidate families include Python, Node, media codecs, native build tools and inference runtimes.

These live in Atlas-managed locations and remain replaceable.

## Phase 5 — Product shell + Add-ons
The desktop shell opens to **Eutopia** and exposes four intentionally simple surfaces:
- Eutopia
- Add-ons
- Activity
- System

The Add-ons surface reads the versioned catalog. Optional capabilities can be installed manually with one action.

The button is **not** the only install path. A trusted add-on required by active work may be marked required through desired state/control and installed remotely by Atlas Host without physical presence. Dependencies of an already-approved capability are resolved automatically.

All installations:
- validate versioned package contract;
- verify hash/signature/trust policy;
- check hardware/runtime compatibility;
- stage outside the active slot;
- provision dependencies through the privileged helper/sandbox;
- run health/security/benchmark checks;
- activate atomically;
- audit the change;
- roll back automatically on failure.

Restart scope is minimized automatically:
`hot-reload -> add-on -> Atlas runtime -> Host service -> Windows reboot`

A full OS reboot is used only for a genuine system prerequisite. Before any disruptive restart, Capa 1 is checkpointed and the causal journal/work queue are flushed. After restart, the World Runtime performs elapsed-time catch-up before declaring the world current.

## Phase 6 — First heavy workload activation
Request Layer 3 through the capability broker:
`need = temporally coherent image-to-image translation`

The broker resolves the best compatible model/runtime path for the detected PC, provisions it, benchmarks it, and activates only if health and quality gates pass.

If Layer 3 cannot yet satisfy its floor, Layers 1 and 2 remain unaffected while the node reports a structured capability gap.

## Phase 7 — Autonomous mode
After successful substrate health checks:
- supervisor owns future convergence;
- World Runtime owns continuous causal time locally;
- repository/live desired state drives changes when connected;
- offline commands/results queue durably;
- node reconnects after boot, sleep and network loss;
- capability packages can be installed/replaced automatically;
- trusted required add-ons can be installed while the user is away from the PC;
- approved user-facing add-ons can self-resolve dependencies;
- new finished add-ons appear in the catalog without reinstalling Atlas Host;
- bad updates roll back;
- missing dependencies become self-provisioning tasks;
- no routine user operation is expected.

## Recovery during bootstrap
Every permanent mutation is journaled. Bootstrap is transactional:
- failure before service activation -> remove staged substrate;
- failure after service activation -> supervisor enters rescue mode;
- capability failure -> preserve substrate and mark capability unavailable;
- shell failure -> supervisor remains operational and restores/replaces the shell;
- World Runtime failure -> restore last verified checkpoint and replay forward;
- network failure -> continue causal world locally and enter reconnect queue mode.

Never leave the PC dependent on a half-installed translator, broken UI or internet connection for world continuity.

## Upgrade path
The bootstrap itself is not rerun for ordinary growth. Future expansion occurs through supervisor/capability/add-on updates.

A new bootstrap should be required only if an OS-level prerequisite genuinely cannot be established by the installed supervisor/helper under its permitted privilege model.

## Success criteria
Bootstrap is complete only when:
1. supervisor survives reboot/service restart;
2. World Runtime continues while UI is closed and while network is disconnected;
3. elapsed-time deterministic catch-up after shutdown is verified;
4. node can detect offline/online transitions and reconnect automatically;
5. desired state can be changed remotely and converged without user interaction;
6. a trusted required add-on can be installed end-to-end without physical presence at the PC;
7. A/B update and rollback are verified;
8. resource inventory is published;
9. capability package install/remove is verified;
10. Add-ons catalog can discover and install a compatible optional test package;
11. desktop shell can be replaced/restarted without breaking supervisor or world continuity;
12. Layer 2 remains usable while Layer 3 is unavailable;
13. Layer 3 can request a route through the broker rather than being hard-wired to one runtime.

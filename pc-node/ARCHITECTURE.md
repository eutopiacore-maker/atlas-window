# Atlas Host Node — autonomous capability architecture

## Purpose
The PC is a general physical capability host for Atlas, not merely the GPU behind Layer 3. Layer 3 is the first workload, but the node is designed to supply future Atlas needs such as GPU/CPU compute, RAM, storage, compilation, model conversion, local models, media processing, simulation, data processing and other managed tools.

Layers 1 and 2 remain authoritative and must never depend on the PC being online.

## Non-negotiable behavior
1. The node installs once as an operating-system service and starts automatically at boot, before any Atlas app is opened.
2. After bootstrap, routine operation, maintenance, upgrades, dependency provisioning, recovery and Atlas runtime changes require no human intervention.
3. The node uses outbound authenticated connections. No covert backdoor, unrestricted inbound shell, exposed RDP/VNC or general-purpose remote-control port is required.
4. If the PC is off, asleep, loses internet, a workload crashes, transport dies or health/latency falls outside limits, Atlas degrades gracefully. For Layer 3 specifically, the browser immediately presents Layer 2 while Layer 3 enters RECOVERING.
5. RECOVERING is persistent: reconnect attempts continue automatically with exponential backoff and jitter. No user action is required when connectivity returns.
6. The node inventories hardware/software capabilities on every boot and whenever hardware/runtime state materially changes.
7. Atlas work is requested by capability, not by hard-coded device. The capability broker chooses the best available local route and may provision missing managed dependencies automatically.
8. Atlas software on the PC is managed from declarative desired state plus an authenticated outbound control/work channel. ChatGPT can update repository state; the node converges itself to that state without requiring the user to operate the PC.
9. Updates are atomic. New supervisor/runtime/model/tool versions are staged, hash-verified and health-tested before activation. Failed updates automatically roll back to the last-known-good version.
10. The permanent supervisor is separated from replaceable workloads so a broken translator or runtime cannot destroy manageability.

## Components
- **atlas-supervisor service**: boot supervisor, desired-state controller and recovery authority.
- **capability broker**: inventories CPU/GPU/VRAM/RAM/disk/network/OS/runtimes/codecs/accelerators and assigns workloads.
- **managed job runner**: executes signed Atlas job packages inside the Atlas sandbox.
- **dependency/tool manager**: provisions and version-locks Atlas-managed runtimes, libraries, toolchains and models.
- **translator runtime**: GPU image-to-image engine used by Layer 3.
- **model manager**: downloads, verifies, activates and rolls back model versions.
- **transport manager**: establishes and continuously repairs authenticated outbound connectivity.
- **health watchdog**: checks process state, frame freshness, latency, resource health and transport health.
- **local cache**: keeps last-known-good runtimes/models/tools and queued work during temporary internet loss.
- **desired-state controller**: polls `pc-node/desired-state.json` and converges the PC to that state.
- **rescue slot**: minimal independently bootable Atlas runtime able to restore A/B slots.

## Remote autonomy model
Remote autonomy is based on authenticated desired state and signed/hashed Atlas artifacts, not on a hidden backdoor.

The host may autonomously, inside its managed scope:
- edit/replace Atlas-managed files;
- install/upgrade/remove Atlas-managed libraries and toolchains;
- install/switch local models;
- run Atlas-managed compute jobs;
- compile code and model adapters;
- restart Atlas services;
- recreate transport;
- run diagnostics and benchmarks;
- migrate Atlas configuration;
- roll forward/backward versions;
- discover and expose new local capabilities to Atlas.

The remote command vocabulary is intentionally capability-oriented and versioned. Arbitrary internet-originated shell text is not accepted. This gives Atlas durable remote maintainability without making the entire PC generally controllable by anyone who compromises an endpoint.

## Privileged helper
Bootstrap may install a narrowly scoped privileged helper so future Atlas updates can perform approved machine-level operations that genuinely require elevation (for example service management or installation of an Atlas runtime dependency). Requests to that helper must be authenticated, schema-valid, attributable to an approved Atlas generation and restricted to an explicit operation set. It is not a general administrator shell.

The helper must never disable Windows security controls, firewall/antivirus protections or authentication merely to make automation easier.

## Capability workflow
1. Atlas declares a workload by required capability and constraints.
2. Host inventories available resources.
3. Broker checks whether the capability already exists.
4. If missing but provisionable inside Atlas scope, dependency manager installs the required managed component automatically.
5. Workload is staged and health-tested.
6. Broker chooses the best available execution path.
7. Status/results are reported to Atlas.
8. Failures trigger local retry, alternate capability selection or rollback before escalating as an unsatisfied requirement.

A missing library, codec, compiler, model adapter or runtime should therefore become an automatic provisioning event rather than a user task.

## Layer 3 browser state machine
`LAYER2 -> LAYER3_CONNECTING -> LAYER3_ACTIVE`

Any failure from CONNECTING or ACTIVE goes to `LAYER3_RECOVERING`, while the visible image is Layer 2.

Recovery requires consecutive healthy checks before switching the visible output back to Layer 3, preventing flicker during unstable connectivity.

## Health policy
- health probe interval: 1 s while Layer 3 is requested
- failure threshold: 3 consecutive failed probes OR stale rendered frame > 2.5 s
- immediate visible fallback: Layer 2
- reconnect cadence: 1 s, 2 s, 4 s, 8 s, then capped with jitter
- recovery gate: 3 consecutive healthy probes + fresh frames + acceptable latency
- workload crash: supervisor restarts locally before transport is rebuilt

## Boot / reconnect sequence
1. OS boots -> atlas-supervisor starts.
2. Load rescue metadata and last-known-good A/B slot.
3. Inventory hardware/software capabilities.
4. Detect network. If offline, remain WAITING_NETWORK while preserving local capability state and queued work.
5. Network appears -> authenticate outbound control path -> fetch desired state.
6. Converge dependencies/tools/models/runtime automatically.
7. Start/repair requested workloads and transport.
8. Publish capability/status report.
9. Layer 3 browser health succeeds -> CONNECTING -> ACTIVE after stability gate.
10. Any later disconnection repeats recovery autonomously.

## Security boundary
The target is full autonomous operation of Atlas, not unrestricted remote ownership of unrelated personal data or applications. Personal files and unrelated apps stay deny-by-default unless a future Atlas feature explicitly requires a narrowly defined permission and that permission is deliberately added to the managed capability contract.

User authorization for autonomous Atlas operation is recorded as a design requirement, but it does not justify covert persistence, credential theft, security-control bypasses or an unrestricted backdoor. Those mechanisms would reduce reliability and create an unnecessary takeover risk.

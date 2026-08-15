# Atlas PC Node — autonomous Layer 3 architecture

## Purpose
The PC is an optional GPU node for Layer 3 only. Layers 1 and 2 remain authoritative and must never depend on the PC.

## Non-negotiable behavior
1. The node installs once as an operating-system service and starts automatically at boot, before any Atlas app is opened.
2. The node uses outbound connections only. No general-purpose remote shell is exposed.
3. If the PC is off, asleep, loses internet, the translator crashes, the tunnel dies, or health/latency falls outside limits, the browser immediately presents Layer 2 while Layer 3 enters RECOVERING.
4. RECOVERING is persistent: reconnect attempts continue automatically with exponential backoff and jitter. No user action is required.
5. When the PC and internet return, the node rebuilds connectivity, validates the translator, and Layer 3 resumes automatically after a short stability window.
6. Layer 1 state and Layer 2 interaction never pause because of Layer 3 failure.
7. Atlas software on the PC is managed from a declarative desired-state file in this repository. The node pulls changes; ChatGPT can therefore update/reconfigure Atlas components by changing repository state without requiring the user to operate the PC.
8. Updates are atomic. New runtime/model versions are staged, hash-verified and health-tested before activation. Failed updates automatically roll back to the last-known-good version.

## Components
- **atlas-node service**: boot supervisor and control-plane client.
- **translator runtime**: GPU image-to-image engine used only by Layer 3.
- **model manager**: downloads, verifies, activates and rolls back model/runtime versions.
- **transport manager**: establishes and continuously repairs the secure outbound path between the web client and the PC.
- **health watchdog**: checks process state, GPU availability, frame freshness, latency and transport health.
- **local cache**: keeps the last-known-good runtime/model so temporary internet loss does not corrupt the node.
- **desired-state controller**: polls `pc-node/desired-state.json` and converges the PC to that state.

## Browser state machine
`LAYER2 -> LAYER3_CONNECTING -> LAYER3_ACTIVE`

Any failure from CONNECTING or ACTIVE goes to `LAYER3_RECOVERING`, while the visible image is Layer 2.

Recovery requires consecutive healthy checks before switching the visible output back to Layer 3, preventing flicker during unstable connectivity.

## Health policy
- health probe interval: 1 s while Layer 3 is requested
- failure threshold: 3 consecutive failed probes OR stale rendered frame > 2.5 s
- immediate visible fallback: Layer 2
- reconnect cadence: 1 s, 2 s, 4 s, 8 s, then capped with jitter
- recovery gate: 3 consecutive healthy probes + fresh frames + acceptable latency
- model/runtime crash: supervisor restarts locally before transport is rebuilt

## Control and security
The control plane is pull-based. The PC never accepts an unrestricted remote command shell. Atlas can update and control everything inside its own managed runtime directory through versioned desired state: runtime version, translator model, quality profile, service restart, transport restart, cache cleanup and configuration migration.

This preserves autonomous maintenance without turning the user's computer into a remotely exposed general-purpose machine.

## Frame path
Layer 2 remains the interactive source. The web client sends a compact visual/interaction stream to the node. The node translates the current Layer 2 observation using Layer 1 context, maintains temporal memory, and returns the Layer 3 stream. Target display cadence is 24 fps initially; the node may generate at a lower native rate and use temporal interpolation when the detected GPU cannot sustain 24 native generative frames per second.

## Boot / reconnect sequence
1. OS boots -> atlas-node service starts.
2. Detect GPU and local last-known-good runtime.
3. Detect network. If offline, remain WAITING_NETWORK without user-visible errors.
4. Network appears -> fetch desired state -> start/repair translator -> start/repair transport.
5. Publish/refresh node reachability if the transport endpoint changed.
6. Browser health probe succeeds -> Layer 3 enters CONNECTING.
7. Stable fresh frames -> Layer 3 becomes ACTIVE automatically.
8. Any later disconnection repeats recovery autonomously.

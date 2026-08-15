# Atlas Host Platform Baseline

## Objective
The first installation must create a reusable physical substrate for Atlas, not a single-purpose Layer 3 appliance.

The installed base should make future capabilities cheaper to add, easier to repair, measurable, replaceable and remotely maintainable without human operation after bootstrap.

## Stable substrate
The bootstrap installs only long-lived primitives. Heavy capabilities remain replaceable and are provisioned lazily.

Permanent primitives:
- boot supervisor
- node identity + trust verifier
- desired-state reconciler
- capability registry
- resource inventory
- managed job scheduler
- artifact/model store
- secrets vault interface
- telemetry + event journal
- health/recovery kernel
- A/B/rescue updater
- outbound transport manager
- sandbox executor

Everything else is a capability package.

## Capability package contract
A capability package declares:
- name, version and content hash
- provided capabilities
- required hardware/resources
- runtime/dependency requirements
- input/output contract versions
- filesystem/network/device permissions
- health probe
- benchmark suite
- rollback compatibility
- cache/artifact requirements

The supervisor never needs capability-specific logic beyond this contract.

## Core services installed once

### 1. Identity and trust
Each Host Node receives a durable node identity. Control messages, manifests and packages must be authenticated before execution. Trust is explicit and revocable.

### 2. Artifact and model store
Content-addressed local storage prevents repeated downloads and lets multiple capabilities share models, wheels, containers, binaries, compiled kernels and media assets. Artifacts are hash-verified and garbage-collected by policy.

### 3. Secrets vault
Credentials required by future Atlas services are stored outside repositories and outside ordinary runtime logs. Capabilities receive only the credentials explicitly scoped to them.

### 4. Managed scheduler
Interactive work, causal simulation, maintenance, downloads, benchmarking and background experiments have different priorities. The scheduler prevents a benchmark or model download from starving Layer 3 or another interactive task.

Priority classes:
`REALTIME > INTERACTIVE > CAUSAL > NORMAL > BACKGROUND > EXPERIMENTAL`

### 5. Event journal
Important changes are appended to a durable local journal:
- boot/resume/network changes
- capability install/activate/remove
- crashes/restarts
- route changes
- benchmark outcomes
- update/rollback events
- resource pressure

After reconnect, queued summaries can be published so remote decisions are based on what actually happened.

### 6. Capability registry
The registry is the local graph of available resources and transformations. Capabilities may appear/disappear without changing callers.

### 7. Sandbox executor
Managed jobs run with explicit scopes and resource budgets. Atlas can add new tools later without giving every new package unrestricted access to the host.

### 8. Outbound transport
The node establishes its own authenticated outbound control/data channels. No inbound port is required for normal operation. Loss of live transport falls back to durable repository desired-state polling.

## First-day capability families
The bootstrap should make these families easy to activate immediately after hardware discovery, but should not install every heavy package blindly:
- GPU/CPU neural inference
- image generation and image-to-image
- video encode/decode/interpolation
- Python/Node managed execution
- compilation/build tooling
- numerical/data processing
- model conversion/quantization
- local language-model execution when hardware permits
- simulation workloads
- general Atlas job packages

Layer 3 is the first real workload, not the architectural center.

## Efficiency policy
- detect hardware before selecting runtimes;
- install only what the machine can use;
- lazy-load large models;
- keep frequently reused resources hot when memory permits;
- share immutable artifacts across capabilities;
- avoid duplicate environments when compatible;
- prefer GPU-resident pipelines for GPU workloads;
- protect interactive latency from maintenance/background work;
- use measured performance rather than static hardware assumptions.

## Growth model
Additional hosts join by presenting identity, health and capability advertisements. The graph can absorb another PC, GPU host, server or remote compute resource without redesigning consumers.

The first PC is a node, not the root of the whole system.

## Installation invariant
A future feature should normally require one of these only:
1. publish a new capability package;
2. change desired state;
3. attach another trusted capability node.

It should not require redesigning or manually reinstalling the Host Node.
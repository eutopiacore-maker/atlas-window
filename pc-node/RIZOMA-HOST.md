# Atlas Host Rizoma Ω

## Intent
Atlas Host is a **capability rizome**, not a fixed pipeline and not a PC-specific renderer. Any useful resource may become a node; workloads traverse the best currently viable path through the graph.

The initial PC is the first strong physical node, not the permanent center of Atlas.

## Stable substrate
Only a very small substrate is privileged and long-lived:
- boot supervisor
- identity/trust verifier
- capability registry
- health/recovery kernel
- artifact verifier + A/B/rescue updater

Everything else is replaceable: translators, models, codecs, schedulers, evaluators, adapters, compilers, local LLMs, simulators and future tools.

## Capability graph
Every usable resource registers a machine-readable capability node with:
- capability type and version
- input/output contracts
- device requirements
- estimated latency, throughput, memory and energy cost
- observed quality score by workload class
- current health/load
- locality and network cost
- dependencies and compatible substitutes

Edges represent compatibility and transformation, not hard-coded call order.

Example:
`Layer2 frame -> [img2img-A | img2img-B | local renderer] -> [native 24fps | interpolation] -> encoder -> Layer3`

The router may change the chosen path while the logical request stays identical.

## Rhizomatic routing
A workload declares an outcome and constraints, not implementation:
- required capability
- quality floor
- latency target
- memory ceiling
- continuity requirement
- offline tolerance
- optional cost/energy preference

The broker scores all healthy candidate paths and chooses the best one. If a branch fails, it is pruned temporarily and another viable branch is selected without changing the caller.

No single translator, model, GPU, transport or host should become an architectural dependency when a substitute can exist.

## Growth model
New capability nodes are added through versioned adapters. A new node can be:
- another GPU in the same PC
- CPU/accelerator backend
- a second PC
- a future local server
- a securely connected remote compute node
- a new model/tool/runtime in an existing host

Joining a node does not require redesigning callers. It advertises capabilities; the graph absorbs it.

## Experience-weighted routing
Atlas records outcome telemetry per route:
- success/failure
- real latency and throughput
- VRAM/RAM usage
- thermal/resource pressure
- output quality metrics
- temporal stability
- recovery frequency
- version/model/device combination

Routing begins rule-based and becomes empirically weighted. Paths that repeatedly perform better gain preference; degraded paths lose preference. This is optimization of execution strategy, not modification of causal world truth.

## Efficiency rules
1. Do not load a heavyweight capability until requested.
2. Keep hot models/resources resident while their expected reuse justifies memory cost.
3. Reuse content-addressed artifacts and preprocessing caches.
4. Avoid GPU->CPU->GPU copies when an all-GPU path exists.
5. Batch compatible background jobs, but never add latency to interactive work beyond its declared budget.
6. Adapt resolution, precision, native generation rate and interpolation to the measured machine instead of targeting an impossible fixed load.
7. Prefer local execution when quality/latency are sufficient; use another node only when it materially improves the objective.
8. Continuously measure rather than assume hardware capability.

## Failure model
Failure removes a branch, not the system.

For Layer 3 specifically:
- loss of every valid Layer 3 route => visible Layer 2 immediately
- recovery attempts continue in the graph
- first stable Layer 3 path enters canary validation
- after freshness/health gates pass, Layer 3 resumes

The same principle applies to future Atlas workloads: degrade capability, preserve the core.

## Control plane
Durable desired state remains repository-backed so recovery does not depend on a live remote session. A faster authenticated outbound channel may deliver work and telemetry, but it is an optimization rather than the sole lifeline.

Desired state specifies **outcomes, contracts and allowed capability packages**. Hosts converge independently.

## Separation from the world
Capa 1 remains causal truth. Capa 2 remains dynamic/interactive representation. Host capabilities are compute resources, not authorities over reality state unless a specific causal subsystem explicitly delegates a validated operation.

Layer 3 is therefore a consumer of the rizome, not its owner.

## Design invariant
Whenever Atlas encounters `I cannot do X because resource/tool Y is missing`, the host layer should first ask:

`Can Y be discovered, provisioned, substituted, synthesized from existing capabilities, or supplied by another node?`

Only a genuinely unavailable physical/external prerequisite should remain a blocker.

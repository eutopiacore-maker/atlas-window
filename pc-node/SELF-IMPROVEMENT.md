# Atlas Host — Autonomous Self-Improvement Loop

## Goal
Atlas should improve execution quality, efficiency and resilience without requiring human maintenance and without allowing an untested change to destroy the working system.

Self-improvement operates on **replaceable Atlas components and routing policy**, never by mutating Layer 1 truth to make benchmarks look better.

## Loop
`OBSERVE -> DIAGNOSE -> PROPOSE -> SANDBOX -> BENCHMARK -> CANARY -> PROMOTE | REJECT -> REMEMBER`

### OBSERVE
Collect structured telemetry from real workloads and synthetic probes:
- latency / throughput
- GPU, CPU, VRAM, RAM and disk pressure
- crash/retry rates
- frame freshness and temporal stability
- output quality metrics
- dependency and provisioning time
- network reliability
- energy/thermal pressure when available

### DIAGNOSE
Turn symptoms into capability-level problems, e.g.:
- translator too slow
- excessive GPU/CPU copies
- model exceeds available VRAM
- encoder is the bottleneck
- route fails when network drops
- dependency install is brittle
- quality gain does not justify compute cost

### PROPOSE
Candidate improvements may include:
- route-policy changes
- different model/model variant
- quantization or precision change
- graph rewrite between existing adapters
- new adapter/tool/runtime
- cache strategy
- batching/scheduling policy
- dynamic resolution/FPS/interpolation policy
- dependency/runtime upgrade
- code replacement inside the managed Atlas runtime

Candidates are versioned artifacts. The active slot is never edited in place.

### SANDBOX
Install the candidate into an isolated test slot with declared filesystem/network/device scopes. It cannot replace the known-good route before tests pass.

### BENCHMARK
Use representative workloads and compare against the current route. Score on a multi-objective frontier rather than one number:
- quality
- latency
- throughput
- memory
- stability
- recovery behavior
- resource/energy cost

A candidate may win for one hardware profile and lose for another. Atlas keeps profile-specific route knowledge rather than forcing one universal configuration.

### CANARY
A passing candidate receives a small fraction of eligible live work or shadow execution. It must survive a stability window before promotion.

For interactive Layer 3, visible service remains protected by the Layer 2 fallback and the last-known-good Layer 3 route.

### PROMOTE / REJECT
Promote only when objective gates are satisfied. Promotion is atomic. Any regression during the post-promotion watch window rolls back automatically.

Rejected candidates remain recorded with reason and environment fingerprint so Atlas does not repeatedly rediscover the same bad idea unless material conditions change.

### REMEMBER
Store route experience keyed by:
- hardware fingerprint
- OS/runtime versions
- model/tool versions
- workload class
- configuration
- relevant environmental constraints

This creates an empirical memory of what actually works.

## Exploration versus exploitation
Atlas allocates most work to the current best-known route and a small safe budget to alternatives/probes when useful. Exploration must never jeopardize the causal simulation or remove the known-good fallback.

## Growth trigger
When no existing route satisfies a declared workload, Atlas emits a structured `CAPABILITY_GAP` rather than simply failing.

A capability gap records:
- desired outcome/contract
- why current paths fail
- measured resource envelope
- potential substitutes
- whether a new managed dependency, adapter, model or external node could close the gap

The controller first attempts autonomous resolution inside the allowed Atlas environment.

## Anti-stagnation rules
- Prefer measurements over hard-coded assumptions.
- Do not keep a component merely because it was installed first.
- Do not optimize one metric while silently violating quality or resilience floors.
- Do not accumulate unused dependencies or models indefinitely; garbage-collect cold artifacts while retaining reproducible manifests.
- Periodically rebenchmark after meaningful hardware/runtime/model changes.
- Keep interfaces stable while implementations compete and evolve behind them.

## Safety and recoverability
The self-improvement controller may replace only managed Atlas components allowed by desired state. The supervisor, rescue slot, last-known-good artifacts and integrity verification remain outside the fast-changing experimental plane.

A self-improving system that cannot reliably undo a bad improvement is not considered self-improving; it is merely self-modifying.

# Atlas Host Node — zero-human remote maintenance

## Core rule
After the one-time bootstrap installs the supervisor service, normal operation, recovery, upgrades, model changes, dependency installation, Atlas runtime edits and capability expansion require no human intervention.

## Two-plane design

### 1. Permanent supervisor plane
A small operating-system service starts at boot and is deliberately kept separate from Layer 3 and other fast-changing Atlas workloads. Its job is to keep Atlas manageable.

Responsibilities:
- wait for network without failing noisily;
- poll repository desired state;
- maintain an authenticated outbound control channel when available;
- inventory local CPU/GPU/RAM/disk/network/runtimes/toolchains;
- download and hash-verify Atlas runtime/model/tool packages;
- stage updates in the inactive A/B slot;
- run health tests before activation;
- atomically switch active slot;
- roll back to last-known-good on failure;
- restart crashed Atlas services;
- repair the outbound transport;
- update the supervisor itself through a two-stage handoff;
- retain a rescue slot that can restore a damaged runtime.

The supervisor must never depend on the translator runtime being healthy.

### 2. Replaceable Atlas runtime plane
Everything expected to evolve quickly lives here: translator, model adapters, temporal memory, codecs, local models, compilers/toolchains, capability adapters, diagnostics and Layer 3 configuration.

ChatGPT can change repository desired state and managed Atlas artifacts. The supervisor converges the PC to that state automatically. No remote desktop or unrestricted shell is required.

## Privileged helper
Bootstrap may install a narrowly scoped privileged helper for Atlas machine-level operations that legitimately require elevation, such as managing Atlas services or installing an Atlas runtime dependency.

The helper accepts only authenticated, schema-valid, versioned Atlas operations. It is not a general administrator shell and cannot be used to disable host security controls.

## Remote edit loop
1. ChatGPT changes Atlas code/config/model/tool manifest in the repository.
2. PC supervisor notices the new generation automatically.
3. It downloads only managed Atlas artifacts.
4. Hashes and compatibility constraints are checked.
5. Update is installed into the inactive slot or managed capability sandbox.
6. Local self-tests and hardware/runtime health tests run.
7. If healthy, the change becomes active atomically.
8. If unhealthy, the old slot remains active or is restored automatically.
9. Status and capability inventory are published so later changes can be based on the actual installed generation.

## Autonomous capability expansion
If a future Atlas workload needs something that is not currently present, the node first determines whether it can satisfy the request using existing CPU/GPU/RAM/storage/tooling. If not, it may automatically provision the missing Atlas-managed library, runtime, codec, compiler, model adapter, local model or toolchain inside its managed scope.

This turns "we are missing a tool" into an automatic provisioning event rather than a user task.

## Failure isolation
- Layer 1 never depends on the PC node.
- Layer 2 never depends on the PC node.
- Layer 3 may disappear at any moment without corrupting Layers 1 or 2.
- A bad Layer 3 or capability release cannot overwrite the supervisor or last-known-good slot directly.
- Loss of internet puts the node in WAITING_NETWORK; it does not require a click when connectivity returns.
- Reboot, sleep/wake and process crashes all re-enter the same automatic recovery state machine.

## Self-update safety
Supervisor updates use a handoff helper: the currently running supervisor downloads and verifies its replacement, starts the replacement in validation mode, and only relinquishes control after the replacement reports healthy. If validation fails, the old supervisor continues running.

## Scope of autonomous control
Allowed without human intervention after bootstrap:
- edit/replace files inside the Atlas managed directory;
- replace translator runtime;
- replace/switch models;
- install Atlas-managed libraries, runtimes and toolchains;
- run Atlas-managed compute jobs;
- compile Atlas code/model adapters;
- modify quality/FPS/latency profiles;
- restart Atlas services;
- repair/recreate Atlas transport;
- clear/rebuild Atlas caches;
- migrate Atlas configuration;
- collect Atlas health diagnostics;
- roll back or roll forward Atlas versions;
- publish capability inventory and node health.

Explicitly excluded:
- unrestricted control of unrelated personal files/applications;
- unrestricted operating-system shell exposed to the internet;
- covert persistence mechanisms;
- disabling firewall, antivirus or other host security controls merely to simplify maintenance.

The goal is full autonomous maintenance and capability growth for Atlas, not unrestricted remote ownership of the user's PC.

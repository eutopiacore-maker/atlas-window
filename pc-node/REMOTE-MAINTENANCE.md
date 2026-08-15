# Atlas PC Node — zero-human remote maintenance

## Core rule
After the one-time bootstrap installs the supervisor service, normal operation, recovery, upgrades, model changes and Atlas runtime edits require no human intervention.

## Two-plane design

### 1. Immutable supervisor plane
A small operating-system service starts at boot and is deliberately kept separate from Layer 3 itself. Its job is not rendering. Its job is to keep Atlas manageable.

Responsibilities:
- wait for network without failing noisily;
- poll repository desired state;
- download and hash-verify Atlas runtime/model packages;
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
Everything expected to evolve quickly lives here: translator, model adapters, temporal memory, codecs, transport client, diagnostics and Layer 3 configuration.

ChatGPT can change repository desired state and managed runtime artifacts. The supervisor converges the PC to that state automatically. No unrestricted remote desktop or shell is required.

## Remote edit loop
1. ChatGPT changes Atlas code/config/model manifest in the repository.
2. PC supervisor notices the new generation automatically.
3. It downloads only managed Atlas artifacts.
4. Hashes and compatibility constraints are checked.
5. Update is installed into the inactive slot.
6. Local self-tests and GPU/translator health tests run.
7. If healthy, the slot becomes active atomically.
8. If unhealthy, old slot remains active or is restored automatically.
9. Status is published so later changes can be based on the actual installed generation.

## Failure isolation
- Layer 1 never depends on the PC node.
- Layer 2 never depends on the PC node.
- Layer 3 may disappear at any moment without corrupting Layers 1 or 2.
- A bad Layer 3 release cannot overwrite the supervisor or the last-known-good slot directly.
- Loss of internet puts the node in WAITING_NETWORK; it does not require a click when connectivity returns.
- Reboot, sleep/wake and process crashes all re-enter the same automatic recovery state machine.

## Self-update safety
Supervisor updates use a handoff helper: the currently running supervisor downloads and verifies its replacement, starts the replacement in validation mode, and only relinquishes control after the replacement reports healthy. If validation fails, the old supervisor continues running.

## Scope of autonomous control
Allowed without human intervention after bootstrap:
- edit/replace files inside the Atlas managed directory;
- replace translator runtime;
- replace/switch models;
- modify quality/FPS/latency profiles;
- restart Atlas services;
- repair/recreate Atlas transport;
- clear/rebuild Atlas caches;
- migrate Atlas configuration;
- collect Atlas health diagnostics;
- roll back or roll forward Atlas versions.

Explicitly excluded:
- arbitrary control of unrelated personal files/applications;
- unrestricted operating-system shell exposed to the internet;
- disabling host security controls merely to make maintenance easier.

The goal is full autonomous maintenance of Atlas, not unrestricted remote ownership of the user's PC.

# Eutopia Offline-Continuous World Runtime

## Non-negotiable invariant
Eutopia's causal world must not stop because an observer loses internet, the Atlas UI is closed, GitHub is unavailable, or Layer 3 disappears.

The world is a long-lived process, not a browser session.

## Authority model
- Capa 1 is the causal source of truth.
- The Atlas Host runs a persistent **World Runtime** as an operating-system service child/process supervised by Atlas Host.
- Browser/iPhone/desktop views are observers/controllers. They are never responsible for advancing world time.
- GitHub/cloud state is a durable replica/control surface, not the clock that keeps Eutopia alive.

## Real-time clock
World time is anchored to monotonic host time plus a persisted UTC wall-clock anchor.

Each checkpoint records:
- world simulation time;
- UTC wall-clock anchor;
- monotonic sequence/tick id;
- deterministic random-stream position/seeds;
- causal event-log offset;
- state checksum.

The runtime advances causal state even with zero network connectivity.

## Network-loss behavior
If the PC remains powered but loses internet:
1. World Runtime continues normally.
2. Construction, agents, ecology, water, weather and all enabled causal systems continue advancing.
3. Remote commands/results are queued.
4. Local checkpoints and event journal continue.
5. When network returns, Atlas reconciles desired state, publishes summaries/checkpoints and drains queued remote work.

No internet outage may pause world time.

## Host-off / reboot / power-loss behavior
A powered-off computer cannot physically execute simulation. Therefore continuity is reconstructed deterministically on restart instead of freezing elapsed time.

On recovery:
1. Load the last valid checkpoint.
2. Measure real elapsed time from the persisted UTC anchor, bounded by clock-integrity checks.
3. Restore deterministic PRNG/event-stream state.
4. Advance from checkpoint time to current real time using adaptive catch-up.
5. Recreate scheduled and causal events in correct temporal order.
6. Write a new checkpoint before exposing the recovered state as current.

From the world/observer perspective, elapsed real time has passed rather than being discarded.

## Adaptive catch-up
Catch-up must not be a naive `progress += elapsed` shortcut for complex systems.

Use the cheapest model that preserves causal fidelity:
- exact/event-driven processing for discrete actions (construction milestones, task completion, births/deaths, failures, scheduled decisions);
- bounded fixed/substeps around discontinuities;
- larger validated timesteps for slowly varying continuous processes;
- deterministic replay for agent decisions and stochastic processes using persisted seeds/streams;
- periodic conservation/invariant checks during long catch-up windows.

If a subsystem cannot safely fast-forward, it declares a maximum catch-up step and the scheduler honors it.

## Example: building construction
A building project is represented as causal work, not a visual animation timer.

A project may contain:
- prerequisites/material availability;
- workers/agents and productivity;
- weather constraints;
- equipment state;
- task graph and dependencies;
- resource consumption;
- inspections/failures/rework;
- accumulated work quantities.

If the observer disconnects for six hours while the Host is running, those six hours execute normally.

If the Host was powered off for six hours, catch-up replays/advances the six-hour interval according to the same causal rules before the world is declared current.

## Checkpoints + event journal
Use both:
- periodic atomic snapshots for fast recovery;
- append-only causal event journal for audit/replay;
- checksum validation;
- rotating known-good checkpoints;
- crash-safe writes (write temp -> fsync -> atomic replace where supported).

A corrupted latest checkpoint falls back to the previous verified checkpoint and replays forward.

## Observer reconnect
When iPhone/web/desktop reconnects:
- request latest authoritative world sequence;
- discard stale visual/intermediate state;
- stream the current Capa 1 snapshot + subsequent deltas;
- Capa 2 reconstructs current dynamics;
- Capa 3 may resume if a healthy render route exists.

Observers never ask the world to 'resume'; they simply reconnect to a world that is already current.

## Multi-node growth
Future trusted Host Nodes may replicate the causal journal/checkpoints.

Causal mutation must still avoid split-brain. A single active world-writer lease/epoch owns authoritative mutation at a time; replicas can take over only through an explicit lease/epoch transition. Read/render/compute capabilities remain rizomatic and multi-path.

This preserves one causal history while allowing many compute roots.

## Failure principle
Loss of a capability removes that capability, not time itself:
- Layer 3 lost -> show Layer 2.
- network lost -> continue world locally.
- remote control lost -> queue/retry.
- UI closed -> continue world.
- Host reboot/power loss -> deterministic elapsed-time catch-up.

The world is considered stopped only if its causal state is intentionally paused by an explicit world-level command, never because infrastructure disappeared.
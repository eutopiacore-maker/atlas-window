# Atlas Host Node — Capability Broker

## Goal
The PC is not a single-purpose GPU appliance. It is a general physical resource node for Atlas. After bootstrap, Atlas must be able to discover, provision and use new capabilities without human operation.

## Core rule
If a future Atlas task needs a resource or tool that the PC can reasonably provide, the node should discover the missing capability, provision it inside the managed Atlas environment, validate it, expose it to Atlas, and keep it available after reboot or reconnection.

## Architecture

### 1. Permanent supervisor
A small boot service starts with the operating system and is intentionally much simpler than the replaceable Atlas runtime. It owns recovery, desired-state polling, capability inventory, update staging, rollback and rescue.

### 2. Capability inventory
At boot, resume, hardware change and periodically thereafter, the node reports:
- CPU architecture, cores and instruction sets
- GPU(s), compute backend and VRAM
- RAM and available memory
- storage capacity, free space and cache health
- network reachability and measured bandwidth/latency
- OS version and power state
- installed Atlas runtimes/toolchains
- media codecs and hardware encoders/decoders
- available accelerators
- basic thermal/resource pressure signals when available

The inventory is machine-readable so Atlas can choose the cheapest viable execution path automatically.

### 3. Capability adapters
Every capability is exposed through an adapter with a stable contract. Examples:
- neural inference
- image generation / image-to-image
- video interpolation / encoding
- local LLM execution
- simulation / numerical compute
- compilation and build jobs
- data transformation
- model conversion / quantization
- model training or fine-tuning when hardware allows
- general Atlas-managed job packages

New adapters can be shipped later without replacing the supervisor.

### 4. Self-provisioning managed environment
The node may automatically create virtual environments, containers/sandboxes, model caches, compiler toolchains and user-space libraries inside Atlas-managed storage. Missing dependencies are a recoverable state, not a request for the user to install something manually.

Provisioning flow:
`NEED -> DISCOVER -> RESOLVE -> STAGE -> VERIFY -> HEALTH TEST -> ACTIVATE`

If activation fails:
`ACTIVATE -> FAIL -> ROLLBACK -> LAST KNOWN GOOD`

### 5. Resource broker
Jobs declare requirements instead of naming a specific device. The broker selects the best available resource. Example:
`needs: image-to-image, memory >= X, latency target Y`

The broker may choose GPU, CPU fallback, a lower precision model, a smaller model, cached preprocessing, interpolation or another compatible backend rather than failing solely because the preferred path is unavailable.

### 6. Durable remote management
The repository desired-state is the durable control plane. ChatGPT can change desired state and managed Atlas code remotely; the node pulls and converges automatically. A faster live outbound channel may be layered on later, but loss of that channel must never remove recoverability because repository polling remains the fallback.

### 7. Managed work queue
Atlas may receive versioned task/job manifests from the control plane. Jobs execute only inside the Atlas capability sandbox with declared resource, filesystem and network scopes. This allows future functionality to be added remotely without exposing a general-purpose remote shell.

### 8. Offline and reconnect behavior
If internet disappears, active local Atlas capabilities may continue where safe. Remote-result work is queued locally. The node enters WAITING_NETWORK and keeps reconnecting. When connectivity returns it refreshes desired state, sends queued status/results, repairs the control path and resumes work automatically.

### 9. Layer 3 is only the first consumer
The current first workload is Layer 3 neural rendering. It requests GPU inference from the capability broker. Nothing in the host-node architecture is hard-coded to rendering; later Atlas components may request other compute capabilities through the same broker.

## Safety boundary
Autonomy applies to the Atlas-managed environment. The node is not designed as an unrestricted remote administration tool for the user's personal computer. Personal files and unrelated applications remain outside scope by default.

This boundary does not prevent Atlas from evolving: new runtimes, libraries, models, toolchains and managed job types can still be installed and replaced autonomously inside the Atlas environment.

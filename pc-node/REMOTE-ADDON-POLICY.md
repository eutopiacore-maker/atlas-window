# Atlas Add-ons — Zero-Touch Remote Installation Policy

## Goal
Working with Atlas from an iPhone, browser, or another location must not require the user to return to the PC to press Install, Run, Continue, or approve routine administrator prompts.

The Add-ons UI is a human-friendly library, not the only installation path.

## Installation modes
Atlas supports three installation intents:

### 1. Dependency auto-resolution
If an already-approved capability requires a dependency, runtime, codec, model, library, compiler or compatible adapter, Atlas resolves and installs it automatically inside the managed environment.

No user interaction is expected.

### 2. Trusted operator-required add-on
If the user and ChatGPT are actively developing a capability and installation is necessary to continue the requested work, the trusted control plane may mark the signed add-on manifest as `required`.

The Host Node:
1. receives/pulls the desired-state generation;
2. verifies publisher/trust policy, signature/hash and package contract;
3. checks compatibility and required privileges;
4. stages it in the inactive sandbox/slot;
5. installs/provisions dependencies;
6. runs health/security/benchmark tests;
7. activates atomically when gates pass;
8. restarts only the smallest required scope;
9. rolls back automatically on failure;
10. records the action in Activity.

No physical button press is required.

### 3. Optional/discoverable add-on
Capabilities that are interesting but not required for current work appear in Add-ons with an `Instalar` button. These remain a deliberate user choice.

## Privilege model
The one-time bootstrap installs an Atlas supervisor/privileged helper as a Windows service with the permissions required to maintain the Atlas-managed substrate.

Routine future operations must use that already-installed service rather than triggering interactive UAC prompts.

Allowed privileged operations are contract-scoped, for example:
- create/update Atlas services;
- install/remove Atlas-managed runtimes and toolchains;
- manage Atlas directories and caches;
- configure Atlas firewall/network rules when explicitly declared by a trusted package;
- install signed system prerequisites or drivers only when permitted by host policy and technically supported;
- schedule/restart Atlas services/app;
- schedule a machine reboot when genuinely required.

No unrestricted internet-facing shell is required.

## When Windows itself requires a hard boundary
Atlas must never bypass operating-system security by exploit or hidden backdoor. If Windows or hardware requires a prerequisite that the installed service cannot legally/technically establish, Atlas records a structured `HOST_PREREQUISITE_GAP` instead of presenting surprise click-through steps.

The architecture should reduce these gaps by installing the durable privileged helper once and by preflighting common compute requirements during bootstrap.

## Restart policy
Use the minimum disruption necessary:

`HOT_RELOAD -> ADDON_RESTART -> ATLAS_RUNTIME_RESTART -> HOST_SERVICE_RESTART -> WINDOWS_REBOOT`

A full Windows reboot is the last resort.

Before any disruptive restart:
- checkpoint Capa 1;
- flush causal event journal;
- persist job queue and add-on transaction;
- preserve Layer 2/web availability where possible;
- write restart reason and expected continuation token.

After restart:
- supervisor starts automatically;
- World Runtime performs elapsed-time catch-up;
- add-on transaction resumes/verifies;
- transport reconnects;
- healthy capabilities rejoin the rizoma.

## Remote-work flow example
User is away from home and asks ChatGPT to continue development.

1. ChatGPT determines a new signed Atlas add-on/runtime is needed.
2. Repository/control desired state is updated to require that capability.
3. Home PC polls/receives the change when online.
4. PC installs/tests/activates it autonomously.
5. ChatGPT can inspect published status/telemetry and continue iterating.
6. User may later see the installed add-on in the desktop library, but no physical interaction was required.

If the home PC is temporarily offline, the desired state waits durably. When connectivity returns, the PC converges automatically.

## Auditability
Zero-touch must not mean invisible.

Every remote installation records:
- who/what requested it;
- manifest/version/hash;
- permissions requested;
- compatibility result;
- install/test result;
- restart scope;
- rollback/promotion result;
- timestamps and node generation.

The user should be able to understand what changed from the Activity view without having to operate the installation.

## Design invariant
After bootstrap, a routine Atlas development session must never end with:
- 'go to the PC';
- 'open this file';
- 'click Run';
- 'press Install';
- 'approve this dependency';
- 'restart this manually'.

Those are orchestration responsibilities of Atlas Host.
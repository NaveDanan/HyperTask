# HyperTask background AI services

Issue [#7](https://github.com/NaveDanan/HyperTask/issues/7) adds service readiness and lifecycle controls to the native Chat page. HyperTask's Electron main process checks and manages the **existing personal deployment on MMEMS-mems01**. The desktop does not run the heavy backend or open the OpenBot browser application.

This is a provisioned Linux development connection, not a portable installer. It requires the authorized VM, working Tailscale/SSH access with an accepted host key, and the original services described in [the VM record](HYPER_OPENBOT_VM.md). The original Intelligence runtime, account entitlement, personally accepted agreement and ChatGPT OAuth remain required. Linux/rootful Docker is outside the vendor's documented macOS preview. This work makes no production packaging, zero-install or permanent offline claim.

## Using the native controls

1. Open HyperTask. The Chat sidebar entry discovers readiness; the Chat page shows the result. With the startup preference enabled, HyperTask starts an existing stopped deployment. A healthy deployment is attached without restarting containers.
2. Open **AI services** to inspect Docker, deployment, PostgreSQL, computer, harness, server, worker, runtime, license and provider checks. Chat stays disabled until readiness succeeds. Other HyperTask pages and the Rust core remain available.
3. **Check AI readiness** retries discovery. **Start AI services** starts the saved deployment. Stop and Restart require confirmation because they interrupt active AI work.
4. An explicit Stop stays in effect for the current app session, including when another Chat view opens. Start or Restart releases that choice. The saved startup preference applies again on the next app launch.
5. Closing HyperTask closes its private connections and core normally. It leaves the VM services running. Use the explicit Stop control to stop this managed deployment.

The startup checkbox is the only editable connection setting. Main saves it atomically under the protected Electron user-data directory, in `hyper-openbot-service/config.json`, with mode `0600` and directory mode `0700`. No host, SSH command, filesystem path, provider token or license is supplied by the renderer. There is no automatic download, image build, new cluster, agreement acceptance or account sign-in in this controller.

## Ownership and connection boundaries

All lifecycle requests must come from the native main frame and acquire the same trusted native-owner lease as chat. The existing v2 binding and per-owner cookies remain unchanged. Signing out invalidates readiness and cancels pending desktop SSH/HTTP/WebSocket work. A different local profile, malformed binding or unsupported remote profile cannot start or attach this personal backend through the bridge.

Remote native accounts and backend ownership transfer remain unsupported. The Rust core does not yet persist the authenticating server origin at sign-in. A numeric user ID, UUID supplied by a remote server, current environment URL or renderer confirmation cannot establish that provenance. This change does not add an owner-reset control or silently rebind an existing deployment. Returning to the original supported local profile permits a normal network reconnect. Supporting remote profiles or changing the personal backend owner requires a separately reviewed authenticated-provenance and transfer design.

Main uses the already authorized fixed SSH target with BatchMode, strict host-key checking, bounded output and deadlines. It sends one bundled Python program and a closed action enum. The helper verifies the exact Compose ownership labels, dedicated k3d cluster label and loopback-only published bindings before mutating the deployment. It starts existing containers with Compose `start`, preserving their IDs, images and mounts. It never runs the broad upstream cleanup scripts or touches shared MMEMS K3s/AppFlowy services.

Readiness loss closes established chat transports. History joins and approval polling pause during intentional shutdown. Recovery reconnects the existing thread and restores saved history before enabling Send, retaining the draft without a replacement prompt. Transport errors are separate from the original gateway's action policy; this controller grants no additional tool permissions.

## Diagnostics and recovery

| State | Native behavior and recovery |
| --- | --- |
| SSH unavailable | Keep HyperTask open. Restore the VM, Tailscale or authorized SSH access, then check readiness. |
| Docker unavailable | Report the missing engine. Restore the VM's existing Docker engine/access, then retry. No daemon installation or privilege escalation occurs. |
| Deployment missing | Report provisioning required. Use the documented original-service setup; Start will not create or replace resources. |
| Ownership or public bindings mismatch | Refuse lifecycle operations. An operator must restore the recorded private deployment. |
| Services stopped | Offer Start. Automatic startup respects the preference and the current session's explicit Stop. |
| Service or Intelligence unhealthy | Keep chat disabled and surface retry/restart. Existing data is retained. |
| License needs attention | Require the account holder's official CopilotKit sign-in, entitlement and agreement workflow. The app never accepts terms. |
| Provider store missing | Require the existing VM ChatGPT OAuth workflow. No API key or token is requested by the renderer. |
| Profile cannot be verified | Refuse connection and explain the original-local-profile requirement. No binding reset occurs. |
| Operation failure or timeout | Show a fixed diagnostic message and offer readiness retry. The remote operation may still be finishing after a lost SSH connection; check before retrying. |

The renderer receives only the typed check enum, readiness, timestamps and startup preference. Docker/CLI stderr, credentials and environment values are not returned. Detailed troubleshooting stays in the existing trusted VM tools. License readiness checks the original server's reported `licenseStatus`; provider readiness checks only that the private OAuth store exists and is nonempty. Neither check proves unexpired provider access. Actual model failures continue to appear in chat with draft/retry recovery, as verified in [issue #6](HYPER_OPENBOT_ACTIONS.md).

## Processes and data

Technically separate processes remain: Electron main/renderer/preload, the existing Rust core, short-lived SSH/Python management calls, OpenBot server and worker, agent harness and computer, PostgreSQL, and the original Intelligence services inside their dedicated k3d node. They provide one native HyperTask experience. The management code does not merge those processes or replace their protocols.

The helper selects only Compose project `hypertask-openbot-baseline` and Intelligence stack `local-e866e019ee833a9f6ad99038`. PostgreSQL, computer profiles/workspace, `.openbot` binds and Intelligence stores remain at their established paths. The reference desktop forward and the separate T3 link are unrelated and unchanged. The fixed development target is deliberately not a general remote-deployment configuration API.

## Validation

The actual Electron window on `27d33af` completed Stop, Start and Restart with the original services. All six owned containers stopped; the same containers, image IDs and mounts returned. The Rust core answered `GetUserProfile` while AI services were stopped. The draft, owner binding and exact authoritative saved conversation survived; unrelated AppFlowy containers retained their IDs and start times. A fresh native send succeeded after restart with no page errors.

On `470085e`, native Stop remained stopped with auto-start enabled despite both a waiting and a later `ensure`. Reopening the actual app automatically started those existing services. Disabling startup persisted across another actual app/core restart, and the owner binding stayed unchanged. The driver was interrupted during its first in-process relaunch; separate before/after drivers completed the checks. The interrupted attempt alone is not a pass.

The final native rerun also confirmed intentional Stop shows no raw IPC error. The later pending-identity tunnel-cancellation guard is covered by a deterministic regression.

Repository tests exercise operation ordering, authentication cancellation, preference writes, ownership refusal, strict output parsing, main-frame IPC and readiness gating. The bundled Python program has ten controlled missing/healthy prerequisite scenarios. These scenarios simulate Docker/HTTP/filesystem responses; no live license, credential store or shared daemon was damaged for testing. Native lifecycle observations are separate from these fixtures. [The runtime record](HYPER_OPENBOT_LIFECYCLE.runtime.json) records evidence hashes and validation commits.

To repeat the native check on the provisioned connection, save a disposable conversation and draft, confirm Stop, verify the disabled composer and working native pages, then Start and Restart. Confirm the same conversation and draft, inspect owned container/mount identities on the trusted VM, and send a follow-up. With auto-start enabled, repeat Stop and open another Chat view; it must remain stopped until explicit Start/Restart or a new app launch. Disable startup, relaunch HyperTask and verify the saved preference. Issue #8 owns the broader regression matrix and the owner acceptance checkpoint.

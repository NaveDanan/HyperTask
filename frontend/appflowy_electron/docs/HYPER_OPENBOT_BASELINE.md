# Hyper OpenBot local baseline

Tracking: [issue #4](https://github.com/NaveDanan/HyperTask/issues/4), following the merged [baseline audit](HYPER_OPENBOT_AUDIT.md). Updated 2026-11-14.

Status: original Intelligence `0.15.1` reached `ready` on this Linux PC, and its app connection completed. The user now authorizes heavy backend services on `agent@mmems-mems01` while HyperTask desktop stays on this PC. The VM link is requested; its capacity and runtime are not verified. The local test stack is stopped with data preserved, and the unfinished local server-image build was cancelled. Both account sign-ins and agreement acceptance are verified here. No original OpenBot conversation or integrated HyperTask chat test has run. [The local runtime record](HYPER_OPENBOT_LOCAL.runtime.json) is dated preparation evidence; it does not establish VM readiness. [The earlier Windows record](HYPER_OPENBOT_PREPARATION.runtime.json) remains historical. [Progress](HYPER_OPENBOT_PROGRESS.md) records the sequence and review gates.

## Scope and source

Run original OpenBot with original CopilotKit Intelligence in an isolated local test environment. Keep its server, runtime, agent, worker and persistence contracts intact. HyperTask's renderer, Rust core, credentials and workspace data are outside this baseline's write scope. A successful baseline is a prerequisite for embedding the chat in #5, not evidence that integration is already implemented.

OpenBot source pin: `f8af37ab73e96784f174a11104505a965e722cab`. This remains a research pin until the live procedure succeeds. The source is MIT, copyright 2026 CopilotKit; preserve its notices. Intelligence images/services have separate entitlement requirements. See the pinned [license](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/LICENSE), [setup guide](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/README.md#source-setup) and [environment contract](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/.env.example).

| Input | Required record | Current evidence |
| --- | --- | --- |
| OpenBot | Full source SHA and pristine tracked files | Runtime source unpatched at `f8af37ab73e96784f174a11104505a965e722cab`, `/home/naved/HyperTask-OpenBot-baseline`; official connection changed `.gitignore` and wrote untracked configuration |
| Bun | Exact installed version compatible with the lockfile | `1.4.3`; local frozen install passed with 1,366 packages |
| CopilotKit CLI | Exact package version and installation source | `4.34.0`; private engine preflight passed; local account signed in and terms accepted; installer completed after the authorized Chrome quit |
| Intelligence | Original release/chart version, image digests, API/gateway addresses and valid entitlement | Local release `0.15.1` reached ready and connected, then was stopped for the VM move; VM runtime and final image pin record pending |
| OpenBot images and PostgreSQL | Image IDs/digests or exact build inputs | One matching-source LangGraph image built locally; other application images and PostgreSQL not provisioned here; mutable inputs remain a reproducibility limit |
| Model and agent | Actual provider destination, model and Bot ID | Local ChatGPT OAuth and original model-catalog read passed without an API key; configured Bot and genuine model-answer proof pending |
| Persistence | Test-specific volumes/data directories for both OpenBot and Intelligence | Not established |

Node.js `22.23.5`, Bun `1.4.3`, CopilotKit CLI `4.34.0` and Docker Engine `29.9.3` are installed in this PC's private baseline directory. The local record contains actual hashes and image IDs. The Bun Linux archive was verified against the official release asset digest; its hash differs from the historical Windows record, which was not reused as local verification. These inputs do not establish a working application runtime or an identical rebuild from mutable OS/Python/base-image inputs.

The [root package manifest](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/package.json) and [lockfile](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/bun.lock) pin source dependencies. They do not pin container images or prove that a model or Intelligence installation works.

## Host and isolation

The original local-evaluation guide documents at least 4 CPUs, 12 GiB RAM and 40 GiB free disk. Its supported preview is macOS/Docker Desktop; the CLI accepts Linux/rootful Docker while Linux runtime evaluation remains outside that supported preview. Windows native CLI operation is unsupported. A licensed original Kubernetes/k3d installation is a separate documented option. See [local evaluation](https://docs.copilotkit.ai/intelligence/self-hosting-local) and [self-hosting](https://docs.showcase.copilotkit.ai/intelligence/self-hosting), checked 2026-11-13.

The desktop PC has 8 CPUs and 7.4 GiB total RAM. The heavy backend is now assigned to the user-authorized VM, whose capacity must be verified before provisioning. CLI 4.34.0's bundled README and resource-check implementation require 4 CPUs, 4 GiB available memory and 40 GiB free storage; the public guide still states 12 GiB RAM. The official engine preflight passes. The full installer reached release selection and an evaluation-license response, then stopped at the available-memory check: 7.4 GiB total, 3.2 GiB available, 4 GiB available required. That attempt created no stack. After the user authorized quitting Chrome, the browser exited and 4.45 GiB was available before retry. The original check passed and release `0.15.1` reached ready. No check was bypassed. The stack was later stopped through the original CLI with its data preserved for the VM move.

Authorized generated-cache/build-output cleanup released 18.56 GiB. The user then separately approved and personally removed only `/home/Ubuntu26-recovery/var/lib/containerd`, the old recovery container store. Free space was 52.73 GiB afterward and 47.45 GiB after local preparation, above the 40 GiB disk check. The rest of the recovery copy and personal files remain outside cleanup scope. Private inventory and cleanup evidence stay outside Git.

The 40 GiB value is an installation free-space threshold, not the measured size of downloaded images. The [local evaluation requirements](https://docs.copilotkit.ai/intelligence/self-hosting-local) apply it to each local stack. The [production self-hosting guide](https://docs.copilotkit.ai/intelligence/self-hosting) describes backend services plus Postgres, Redis and identity services; its deployment layout differs from the local evaluation setup. A local HyperTask mode would need room for its backend on each PC. A server deployment would put that storage on the server. Record compressed downloads, stored image/layer usage, persistent data and setup/update peaks separately during live baseline work. No fixed production desktop storage budget has been established.

The current source clone is registered on this PC at `/home/naved/HyperTask-OpenBot-baseline`. Its exact pin and frozen install are verified. The original connection command later modified `.gitignore` and wrote `.copilotkit` configuration; runtime source remains unpatched. Private Docker packages matched both recorded SHA-256 pins and official repository metadata before extraction. No system Docker service was installed or global context switched. The private engine passed a disposable `hello-world` container check; that container was removed. Original Intelligence subsequently reached ready in its isolated k3d cluster; it is now stopped with data preserved. No OpenBot application stack has been launched.

Select this engine explicitly with `DOCKER_HOST=unix:///home/naved/.local/share/hypertask-openbot-baseline/docker/run/docker.sock` and `DOCKER_CONFIG=/home/naved/.local/share/hypertask-openbot-baseline/docker/config`, with the private Docker binary on `PATH` and no inherited `DOCKER_CONTEXT`. Its configuration binds default published ports to loopback. Verify actual listeners for each service rather than relying on that default. Do not start a second daemon or restart the current one merely because an observation times out.

Earlier Windows/WSL builds, sign-in attempts and source paths belong only to the historical record. They establish no service, image or account state on this PC. No further execution there is authorized. Original CLI-managed disposable local dependencies are within this baseline's scope; existing shared clusters remain outside it.

Use a unique test deployment identity, ports, configuration and persistence. Verify actual listeners remain loopback-only, including the host side of WSL/Docker forwarding. Never reuse HyperTask's support directory or native chat databases. Preserve volumes and configuration during the restart test. Do not delete existing containers, disks or user files to make room.

The original [Compose file](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/docker-compose.yml) separates the database network from agent computers and supports a containerized `openbot` profile with server/worker services. Keep those boundaries. Record the selected profile/services and the resolved project identity; do not merely assume a directory name isolates every upstream resource.

## Configuration and secret handling

Use upstream configuration without editing its source. Keep private configuration and credentials untracked. Record variable names and sanitized addresses, never credential values or full expanded Compose configuration. The test deployment must point to original **local** Intelligence; the managed URLs in `.env.example` do not satisfy this issue.

| Concern | Upstream settings | Required verification |
| --- | --- | --- |
| Intelligence | `INTELLIGENCE_API_URL`, `INTELLIGENCE_GATEWAY_WS_URL`, `CPK_INTELLIGENCE_API_KEY`; deployment-specific `COPILOTKIT_LICENSE_TOKEN` | Local API/gateway identity, entitlement and health; no silent managed fallback |
| Model | `BOT_PROVIDER`, `BOT_MODEL` and the selected provider credential/configuration | Real endpoint and actual model answer; no replay or fake key acceptance |
| OpenBot data/vault | `DATABASE_URL`, `KEY_ENCRYPTION_KEY` | Isolated PostgreSQL and non-public test vault key retained across restart |
| Agent/computer/worker | `COMPUTER_TOKEN`, `SUPERVISOR_TOKEN`, `MANAGED_AGENT_TOKEN`, `AGENT_TOOL_TOKEN`, `WORKER_SHARED_SECRET` as required by the selected services | Generated private values scoped to this deployment; server-side authorization retained |
| Identity/origin | `OPENBOT_SINGLE_USER`, `TRUSTED_ORIGINS`, and Better Auth settings where applicable | Same actor/session throughout; loopback-only single-user mode; no arbitrary-origin bypass |
| Ports | `APP_PORT`, `PORT`/`SERVER_PORT`, `POSTGRES_PORT` and selected agent/computer/supervisor ports | Actual listener addresses, collisions and service identity, not just an HTTP 200 |

OpenBot's provider uses `credentials="include"`; keep the original session behavior. Do not treat a random bearer token as a substitute for a Better Auth session. Single-user mode uses its own access checks. Intelligence runtime keys and model keys remain server-side. The [provider](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/app/src/lib/copilot/provider.tsx) and [server mounting/guards](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/server/src/app.ts) define these contracts.

## Startup, shutdown and recovery

The selected deployment's exact tested commands, tool paths, ports, health responses and data locations are not established yet. Capture them during provisioning before treating this as a reproducible runbook.

The source setup documents `bash scripts/start.sh` and `bash scripts/stop.sh`. Inspect their ownership behavior before using them on a shared host:

- The start script runs host API/worker/app processes as well as Compose services. A host API listener must be checked for non-loopback exposure.
- The stop script matches some workers by command pattern and finds supervisor computers using a shared label. A Compose project name alone does not scope every cleanup action in that script.
- In an isolated containerized deployment, record the exact original services and project-scoped lifecycle commands instead. Preserve volumes for normal stop/start; do not use volume deletion as recovery.

These constraints come from the pinned [start script](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/scripts/start.sh) and [stop script](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/scripts/stop.sh). They do not authorize modifying unrelated OpenBot installations. Original Intelligence has its own lifecycle and persistent data, which must also be identified and retained.

If startup fails, retain sanitized failure logs and the exact failed stage. Resume the same installation where supported; do not reset its data, replace Intelligence or label an unavailable service as an empty conversation. Never include session cookies, license values, model keys, one-time sign-in links or secret-bearing network captures in evidence.

## Account-only prerequisites

The selected model route is ChatGPT OAuth, with no OpenAI API key. The original [OpenBot model configuration](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/docs/configuration.md) supports its ChatGPT sign-in store through the LangGraph harness. The matching-source harness built on this PC as `hypertask-openbot-baseline-langgraph-agui:f8af37ab`, image ID `sha256:46e763b6f84b216b2f657bafbe33f2b08b5b0788e9cada73baaf7c89563be832`. Docker reports 460,592,304 bytes, about 439 MiB, for this one image. This is not a complete backend or total physical disk measurement. The local record includes the resolved Python package-list hash. Neither the build nor account sign-in proves a genuine model answer.

Both account sign-ins are now verified on this PC. CopilotKit's official terms check now reports `accepted: true` after the account holder completed the helper. ChatGPT OAuth completed using the pinned desktop login program in the matching-source agent image, with the callback published only at `127.0.0.1:1455` and `[::1]:1455`. Its full credential store is private, mode `0600`, and owned by the local user. The original agent's model-catalog reader successfully retrieved eight offered models. This proves authentication and catalog access, not a genuine model answer or live application acceptance. No API key was used. Never paste account tokens into chat or reuse an unrelated pending approval.

For a new account setup, the account holder must read and accept the local evaluation agreement in their own terminal. This step is complete on the current PC. The installed `copilotkit@4.34.0` setup prompt at `onboarding/prompts/deployment/local-evaluation.md` explicitly says "Never accept the agreement yourself." The CLI enforces this boundary; the agent must not bypass it or submit acceptance for the user.

[HyperOpenBotAccountSetup.sh](../scripts/HyperOpenBotAccountSetup.sh) prepares only the human terms step on this PC. It selects private Node and invokes the exact pinned `npx --prefer-offline --yes copilotkit@4.34.0 local accept-terms` command. The person makes the agreement choice in their own interactive terminal. The terms command uses this PC's account session and needs no Docker daemon or OpenBot checkout. Local syntax/help checks passed; the agent did not run the agreement flow.

The helper remains installed on this Linux PC for a new account setup. Its agreement step has already been completed here. For a new setup, run it in your own interactive terminal:

```sh
bash /home/naved/.local/share/hypertask-openbot-baseline/tools/HyperOpenBotAccountSetup.sh
```

After the person's action, verify `onboard local-terms --json` reports acceptance for the actual signed-in user/organization before provisioning. A typed acknowledgment alone is not that verification. Sign-in and terms completion still do not prove model access, license issuance, service health or any live acceptance row below.

## Live conversation and restart procedure

Use the original OpenBot browser app/reference client against the selected original deployment and a real provider. Keep the same person, deployment, Bot and conversation across the test. Use disposable content with a unique baseline token. A plain-text request avoids needing browser/tool actions or policy changes for this first proof.

1. Select one available Bot and send the unique prompt through the original composer. The upstream helpers use the `Message` textbox and `Send message` button. A new conversation opens at `/channel/<channelId>`; record its actual ID and the prompt.
2. Observe the answer while it arrives. Record ordered live `RUN_STARTED`, at least two nonempty `TEXT_MESSAGE_CONTENT` deltas for the same answer, and `RUN_FINISHED`, with observation times and run/message IDs where present. Join the deltas in order and compare the result with the original transcript. A final answer, stored event list or replay is insufficient to prove incremental arrival. If buffering produces only one observed delta, record the limitation and repeat a suitable live prompt before claiming streaming verified.
3. With the same original session, read `GET /api/channels/<channelId>` and retain `channel.id`, `channel.threadId` and `channel.agentIds`. Stored events from `GET /api/copilotkit/threads/<threadId>/events` can corroborate the run after they settle; they do not replace the live observation.
4. Read `GET /api/copilotkit/threads/<encodedThreadId>/messages?agentId=<encodedBotId>`. Record the HTTP status and authoritative user/assistant message IDs, roles and text. Verify the prompt and full answer agree with the UI and assembled stream. Missing, malformed or unreadable history fails this check; it is not a successful empty result.
5. Stop and start the same original OpenBot and Intelligence deployment using the recorded, scoped procedure, preserving both sets of stores/configuration. Record UTC times, commands, exit statuses and persistent-store identities. A browser reload alone does not establish process-restart durability.
6. Reauthenticate as the same person if needed, reopen the same channel, and repeat channel and authoritative history reads. Require the same thread and Bot mapping and the same saved prompt/answer with matching message IDs where returned. Confirm the original UI displays them. Do not send a replacement message to manufacture readback.

The original creation contract is `POST /api/channels` with `{"agentIds":["<botId>"]}`, returning HTTP 201 and `{channel: ...}`. The app binds its CopilotKit agent to that channel's thread and invokes the original run path. Prefer exercising that app rather than building a partial replacement chat client. Source references: [channel mutations](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/app/src/lib/channels/mutations.ts), [chat helpers](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/e2e/journeys/chat.ts), [core-loop journey](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/e2e/journeys/core-loop.journey.ts), [history reader](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/app/src/lib/copilot/thread-messages.ts) and [channel chat](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/app/src/components/channels/channel-chat.tsx).

## What upstream tests prove

| Test path | Useful coverage | Limit for this baseline |
| --- | --- | --- |
| `bun run test:smoke` | Running deployment capabilities, licensing/agent visibility, computer/policy/audit actions | Does not prove live model chat, incremental response or restart durability. Some cases change policy and browse an external site; plain-chat acceptance does not need those actions. Running smoke files without their opt-in skips them. |
| `bun run test:e2e` | Original browser journeys and UI contracts in an isolated harness | Uses strict aimock replay and dummy model keys by default. A replay pass is not real-provider acceptance. |
| `bun run test:e2e:record` | Live provider-backed recording of the original journeys | Uses its own fresh stack/proxy and writes fixtures. It does not automatically prove this deployment's persistence across restart. |
| Health/configuration checks | Service identity and prerequisites | A configured endpoint, HTTP 200 or licensed runtime alone is not a completed conversation. |

See the pinned [smoke suite](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/tests/smoke/journey.test.ts), [e2e guide](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/e2e/README.md), [stack harness](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/e2e/harness/stack.ts) and [aimock modes](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/e2e/harness/aimock.ts). Report skips, replay mode and failures explicitly.

## Focused original-client runner

[HyperOpenBotBaseline.mjs](../scripts/HyperOpenBotBaseline.mjs) drives the original app using the Playwright installation in an existing OpenBot checkout. It adds no HyperTask package dependency and starts no runtime services. The operator must supply an actual running local stack, configured Bot and the same original session where sign-in is required.

Run the `before` phase from the directory containing the runner, using an absolute source root and new output path:

```sh
node HyperOpenBotBaseline.mjs before --url http://127.0.0.1:3010 --client-root /absolute/path/to/OpenBot --bot-id ACTUAL_BOT_ID --output /private/test-evidence/before.json
```

Perform and record the actual scoped restart of **both** OpenBot and Intelligence with their stores preserved. Then run:

```sh
node HyperOpenBotBaseline.mjs after --url http://127.0.0.1:3010 --client-root /absolute/path/to/OpenBot --before /private/test-evidence/before.json --output /private/test-evidence/after.json
```

Use the tested app port rather than the example port above. A signed-in deployment can use `--storage-state /private/path/session.json`; this is an existing private Playwright session file, never a committed artifact. The output parent directory must already exist. Output files are exclusively created with private permissions; a failed attempt may leave an empty file, so use a new path when retrying. A nonzero exit or empty artifact is not acceptance.

The runner ties live events to the original client's submitted run/user message, a fresh channel and the resulting saved assistant message. It requires multiple distinct delivery observations and rejects unavailable/malformed history, wrong identity, incomplete runs and post-finish events. It locates original transcript rows by message ID and compares their rendered text with whitespace folded, so paragraph elements do not break the UI check. Stream-to-history comparisons still require exact text. It compares authoritative message IDs and text again in the `after` phase without resending. A model response whose formatting changes its visible text may still fail this plain-text baseline.

Transport parsing covers direct AG-UI frames and Phoenix v2 `ag_ui_event` frames, matching CopilotKit core `1.85.0` from the source lockfile. Inspection used its [exact npm artifact](https://registry.npmjs.org/@copilotkit/core/-/core-1.85.0.tgz), verified against the lockfile's SHA-512 integrity. Join replies, batched event histories, unknown envelopes and binary payloads do not establish streaming proof. Gateway topics and authentication fields are not written to the evidence. Other transport modes remain unverified until exercised against the actual runtime.

Artifacts explicitly state that provider authenticity and service restart are **not verified by the runner**. The `after` artifact labels its stream events as copied from the before capture. A successful pair of commands verifies narrow original-client observations; independent deployment/provider and real lifecycle evidence remains required for #4.

The focused [runner tests](../scripts/HyperOpenBotBaseline.test.mjs) check envelope handling, distinct delivery/run boundaries, history failures and artifact field filtering. Run them with `node --test scripts/HyperOpenBotBaseline.test.mjs` from `frontend/appflowy_electron`. Five tests passed locally, with no skips; `--help` also passed. These unit tests are not a live runtime test.

The [browser regression](../scripts/HyperOpenBotBaseline.browser.test.mjs) reproduces the old whole-reply locator failure using separate paragraph elements. It checks the corrected message-ID lookup, full text, hidden/missing rows and delayed rendering. Run it against an existing original-client Playwright installation:

```sh
HYPER_OPENBOT_TEST_CLIENT_ROOT=/absolute/path/to/OpenBot node --test scripts/HyperOpenBotBaseline.browser.test.mjs
```

Use `PLAYWRIGHT_BROWSERS_PATH` for a private browser cache, or `HYPER_OPENBOT_TEST_BROWSER` for a specific Chromium executable. The current local run passed all five unit tests and this browser test without skips, using Node 22.23.5, the original client's Playwright core 1.62.1 and private Chrome Headless Shell 151.0.7922.34, revision 1234. Only the headless browser was installed. Earlier system-Chrome and Windows/WSL results remain historical. The local record contains the current runner and browser hashes. These checks use a DOM fixture and establish no live OpenBot, Intelligence or provider acceptance.

## Acceptance evidence

All rows below are unverified. Replace them only with actual observed results and sanitized evidence references.

| Requirement | Evidence needed | State |
| --- | --- | --- |
| Original local services | Source/runtime/image pins, local Intelligence identity and health | Pending |
| One real agent/model | Provider destination, Bot/model IDs and a genuine completed run | Pending |
| Incremental delivery | Timestamped live deltas and assembled answer matching the UI | Pending |
| Authoritative saved history | Before-restart channel/thread mapping and saved user/assistant messages | Pending |
| Restart durability | Actual service stop/start with retained stores and matching post-restart history/UI | Pending |
| Reproducible operation | Exact setup/start/stop/recovery commands, ports, configuration names and limitations | Pending |
| Isolation | Loopback listeners, scoped resources and unchanged upstream source/HyperTask data | Pending |

Do not close #4, merge a PR as completed baseline work, or begin #5 until the actual acceptance evidence, review and merge gates are satisfied. If platform, entitlement or model access blocks execution, record the completed setup and precise blocker while leaving the issue incomplete.

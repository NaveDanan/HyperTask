# Hyper OpenBot local baseline

Tracking: [issue #4](https://github.com/NaveDanan/HyperTask/issues/4), following the merged [baseline audit](HYPER_OPENBOT_AUDIT.md). Updated 2026-11-13.

Status: tool/dependency/browser preparation and four original OpenBot image builds succeeded, including the matching-source LangGraph agent. CopilotKit sign-in is verified; human evaluation-terms acceptance and ChatGPT OAuth remain outstanding. The application/Intelligence stack is not live. [The preparation record](HYPER_OPENBOT_PREPARATION.runtime.json) captures measured pins, image IDs and limits. It is not live acceptance. [Progress](HYPER_OPENBOT_PROGRESS.md) records delivery state.

## Scope and source

Run original OpenBot with original CopilotKit Intelligence in an isolated local test environment. Keep its server, runtime, agent, worker and persistence contracts intact. HyperTask's renderer, Rust core, credentials and workspace data are outside this baseline's write scope. A successful baseline is a prerequisite for embedding the chat in #5, not evidence that integration is already implemented.

OpenBot source pin: `f8af37ab73e96784f174a11104505a965e722cab`. This remains a research pin until the live procedure succeeds. The source is MIT, copyright 2026 CopilotKit; preserve its notices. Intelligence images/services have separate entitlement requirements. See the pinned [license](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/LICENSE), [setup guide](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/README.md#source-setup) and [environment contract](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/.env.example).

| Input | Required record | Current evidence |
| --- | --- | --- |
| OpenBot | Full source SHA and pristine tracked files | Source pin inspected; runtime validation pending |
| Bun | Exact installed version compatible with the lockfile | `1.4.3`; frozen install completed successfully with 891 packages |
| CopilotKit CLI | Exact package version and installation source | `4.34.0`; native engine preflight passed; account signed out and terms unaccepted |
| Intelligence | Original release/chart version, image digests, API/gateway addresses and valid entitlement | Not established |
| OpenBot images and PostgreSQL | Image IDs/digests or exact build inputs | Server/computer/supervisor image IDs recorded; application PostgreSQL not provisioned; mutable build inputs remain a reproducibility limit |
| Model and agent | Actual provider destination, model and Bot ID | ChatGPT OAuth selected without an API key; approval and live agent/model proof pending |
| Persistence | Test-specific volumes/data directories for both OpenBot and Intelligence | Not established |

Node.js `22.23.5` was also installed in the baseline-specific Ubuntu tools directory. Tool archive hashes and exact observed image IDs are in the preparation record. These installed/built inputs do not establish a working runtime or an identical rebuild from mutable OS/Python/base-image inputs.

The [root package manifest](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/package.json) and [lockfile](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/bun.lock) pin source dependencies. They do not pin container images or prove that a model or Intelligence installation works.

## Host and isolation

The original local-evaluation guide documents at least 4 CPUs, 12 GiB RAM and 40 GiB free disk. Its supported preview is macOS/Docker Desktop; the CLI accepts Linux/rootful Docker while Linux runtime evaluation remains outside that supported preview. Windows native CLI operation is unsupported. A licensed original Kubernetes/k3d installation is a separate documented option. See [local evaluation](https://docs.copilotkit.ai/intelligence/self-hosting-local) and [self-hosting](https://docs.showcase.copilotkit.ai/intelligence/self-hosting), checked 2026-11-13.

The current Linux development machine has insufficient RAM/disk and no Docker. A separate OpenBot project was cloned and registered at `D:\pythonprojects\HyperTask-OpenBot-baseline` on the linked Windows host. Its WSL guest reports 20 CPUs and about 15.5 GiB engine memory, with more than 140 GiB physical free space on each checked drive. The scoped native engine is healthy and its CLI preflight passed. Intelligence runtime/platform behavior and application resource use remain unverified.

The pinned [Windows/WSL development instructions](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/docs/development.md#windows-wsl-2) specify Docker Engine/Compose inside Ubuntu and a source clone in its home filesystem. The first attempt failed against Docker Desktop; the native-engine follow-up passed without patching upstream checks. The measured dependency install and builds used `/mnt/d/pythonprojects/HyperTask-OpenBot-baseline`. A new source clone is now registered at `/home/naved/HyperTask-OpenBot-baseline` through T3's Windows/WSL filesystem path so subsequent work can follow the documented location. Its source pin and frozen install must be verified before use. No application or Intelligence stack/cluster/volume exists yet. One owned loopback OAuth sign-in container is separate from application services. Original CLI-managed disposable local dependencies are within this baseline's scope; existing shared clusters remain outside it.

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

The selected model route is ChatGPT OAuth, with no OpenAI API key. The original [OpenBot model configuration](https://github.com/CopilotKit/OpenBot/blob/f8af37ab73e96784f174a11104505a965e722cab/docs/configuration.md) supports its ChatGPT sign-in store through the LangGraph harness. The matching-source harness is now built from the native pinned checkout, with its resolved Python base digest and dependency-list hash recorded. The previously pulled release harness has a different source commit and remains an unverified reference. Neither build nor sign-in alone proves a live provider call.

Two sign-ins remain separate. CopilotKit's device authorization can be approved from any device using the private card for the owned CLI request. Its latest actual session check confirms sign-in. ChatGPT's original flow returns to a loopback callback on the Windows baseline host, so approve that private card in a browser on that host. The owned flow is running but has not produced its auth store. Earlier cards timed out; fresh owned flows replaced them only after their processes exited. Never paste account tokens into chat or reuse an unrelated pending approval.

After CopilotKit sign-in, the account holder must read and accept its local evaluation agreement in their own terminal. The installed `copilotkit@4.34.0` setup prompt at `onboarding/prompts/deployment/local-evaluation.md` explicitly says "Never accept the agreement yourself." The CLI enforces this boundary; the agent must not bypass it or submit acceptance for the user.

[HyperOpenBotAccountSetup.sh](../scripts/HyperOpenBotAccountSetup.sh) prepares only that human terms step. It selects the existing private baseline tools/daemon, invokes the exact pinned `npx --prefer-offline --yes copilotkit@4.34.0 local accept-terms` command, and leaves the agreement choice to the person. It captures no credentials, automatically submits no consent, and creates no application stack. Run it in an interactive Ubuntu terminal on the prepared Windows host after its installation there. `bash -n` and its help check passed; it was not run end-to-end by the agent.

The prepared helper, account session and private Docker daemon belong to Windows computer `NAVED`, in its `Ubuntu` WSL 2 distro as user `naved`. Open your own PowerShell terminal on that Windows computer and run:

```powershell
wsl.exe --distribution Ubuntu --user naved --exec bash /home/naved/.local/share/hypertask-openbot-baseline/tools/HyperOpenBotAccountSetup.sh
```

The exact PowerShell launch route passed `--help`; the installed helper also passed `bash -n`, and its hash matches the preparation manifest. The agreement was not run by the agent. If your terminal is already inside that computer's Ubuntu distro as `naved`, use:

```sh
bash /home/naved/.local/share/hypertask-openbot-baseline/tools/HyperOpenBotAccountSetup.sh
```

A HyperTask checkout on another machine has its own filesystem. A `no such file or directory` error there means the command needs to run on the prepared Windows host; copying the helper alone would not provide that host's tools or account session.

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

Use `PLAYWRIGHT_BROWSERS_PATH` for a private browser cache, or `HYPER_OPENBOT_TEST_BROWSER` for a specific Chromium executable. This one browser test passed locally with Playwright core 1.62.1 and system Chrome 156.0.8078.47, with no skips. It also passed on the prepared baseline host with Node 22.23.5 and pinned Chromium 151.0.7922.34, revision 1234. The corrected runner is staged there from commit `a2860f3`, with its path and verified hash in the preparation manifest. These checks use a DOM fixture and establish no live OpenBot, Intelligence or provider acceptance.

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

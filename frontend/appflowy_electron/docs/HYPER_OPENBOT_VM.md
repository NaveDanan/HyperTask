# Hyper OpenBot reference backend on the VM

Tested on 2026-11-14 for [issue #4](https://github.com/NaveDanan/HyperTask/issues/4). The user authorized heavy backend work on `agent@MMEMS-mems01`; HyperTask desktop stays on the local PC. The [runtime manifest](HYPER_OPENBOT_VM.runtime.json) records the source, image identities, stores and actual before/after results. This is a development reference deployment. Native HyperTask integration has separate acceptance requirements.

## Prerequisites and source

The VM runs Ubuntu 22.04.4, Docker Engine 29.6.2 and Compose 5.3.1, with 8 CPUs and about 15 GiB RAM. The original installer passed its resource checks. Existing AppFlowy containers use a different project and were not changed. This dedicated CLI-created k3d stack is separate from the shared MMEMS K3s cluster.

The private tools root is `/home/agent/.local/share/hypertask-openbot-backend`. Node 22.23.5, Bun 1.4.3 and the official CopilotKit CLI 4.34.0 are selected explicitly. Docker uses its existing rootful socket; no daemon or global context was replaced.

OpenBot runs from `/home/agent/HyperTask-OpenBot-backend`, extracted from a Git archive of `f8af37ab73e96784f174a11104505a965e722cab`. The archive retains the MIT license and CopilotKit copyright. All 4,036 regular files other than `.gitignore` match the archive. The original connection command modifies that configuration file. Runtime source is unpatched. Checks inside the running images also matched 1,447 server files and nine agent files to the pinned source.

The original Dockerfiles build the server/browser/worker image, agent computer and LangGraph agent. The first two were built on the VM; the agent image was built from the same source on the PC and transferred. Reproduction build commands from that pinned source are:

```sh
docker build -f server/Dockerfile \
  --build-arg OPENBOT_BUILD_COMMIT=f8af37ab73e96784f174a11104505a965e722cab \
  -t hypertask-openbot-baseline-server:f8af37ab .
docker build -f agent-computer/Dockerfile \
  -t hypertask-openbot-baseline-computer:f8af37ab .
docker build -f agent-langgraph-agui/Dockerfile \
  -t hypertask/openbot-agent-langgraph-agui:f8af37ab .
```

The canonical `openbot-agent-langgraph-agui` basename is required by the original server's image guard. The deployed tag is an alias of the matching-source image, not a replacement agent. The original Compose PostgreSQL image resolves to `pgvector/pgvector@sha256:b513c48566e4777cd3370451400000c78eda6a08131d68f4c31d4a76f27bd8fd`. The manifest records actual local image IDs and Intelligence workload digests. Mutable OS, base-image and Python inputs mean these commands do not promise identical rebuilt image IDs.

## Accounts and configuration

The original CLI requires a signed-in CopilotKit account, qualifying entitlement and personal agreement acceptance. The account holder already accepted the agreement. Their original same-account record was restored unchanged to the private VM configuration; the official VM check reports `accepted: true` and preflight pass. The agent did not accept or bypass the agreement. A new account must complete the official human-only acceptance workflow itself.

The selected provider is ChatGPT OAuth. No API key is used. A private `0600` store lives under the private provider directory, mounted read/write at `/root/.langchain` so the original atomic refresh operation works. Do not mount just the JSON file or run multiple refreshers against copied stores. The original agent selects its OAuth implementation from `CHATGPT_AUTH_FILE`; source inspection and the live configuration establish that path, with no model API keys or replay/proxy overrides. The original model catalog returned eight offered models, and a genuine answer completed through this deployment.

The original CLI installed Intelligence release `0.15.1` as stack `local-e866e019ee833a9f6ad99038` using `local setup --defer-model --json`, then connected the original app with `local connect --approve-connection --json`. This model deferral concerns Intelligence setup; the OpenBot agent uses the independently configured OAuth provider. Intelligence remains the original local service, with its runtime reporting a valid license.

Keep `.env`, CLI state, OAuth stores and generated deployment secrets private and untracked. Use the upstream `.env.example` as the schema when preparing a fresh deployment. The tested deployment selects these settings:

| Concern | Tested configuration |
| --- | --- |
| Edition | `OPENBOT_EDITION=personal`, `OPENBOT_SINGLE_USER=true`, `TENANT_PACKAGE_DIR=../examples/personal` |
| Images | `SERVER_IMAGE=hypertask-openbot-baseline-server:f8af37ab`, `COMPUTER_IMAGE=hypertask-openbot-baseline-computer:f8af37ab`, `PICKED_HARNESS_IMAGE=hypertask/openbot-agent-langgraph-agui:f8af37ab`, `IMAGE_PULL_POLICY=never` |
| Agent | `PICKED_HARNESS_KIND=remote-ag-ui`, `PICKED_HARNESS_SOURCE=installed`, `PICKED_HARNESS_CONTAINER_URL=http://agent-harness:4206`, `CHATGPT_AUTH_FILE=/root/.langchain/chatgpt-auth.json` |
| Runtime | `INTELLIGENCE_CONTAINER_API_URL=http://k3d-local-e866e019ee833a9f6ad99038-server-0:8082`, `INTELLIGENCE_CONTAINER_GATEWAY_WS_URL=ws://k3d-local-e866e019ee833a9f6ad99038-server-0:4401` |
| Browser gateway | `INTELLIGENCE_GATEWAY_PROXY=on`, `INTELLIGENCE_BROWSER_GATEWAY_WS_URL` empty; original `/api/intelligence/client` proxy stays on the app origin |
| Browser origins | `TRUSTED_ORIGINS` contains only loopback app/API origins on ports 3010 and 3001 |
| Computer | Original private-host support for container-local services; scoped `COMPUTER_NETWORK=hypertask-openbot-baseline_default` and original loopback relays to `server:3001` |
| Secrets | Private `CPK_INTELLIGENCE_API_KEY`, `KEY_ENCRYPTION_KEY`, `MANAGED_AGENT_TOKEN`, `AGENT_TOOL_TOKEN`, `COMPUTER_TOKEN`, `WORKER_SHARED_SECRET`; retain the same values for recovery |

`KEY_ENCRYPTION_KEY` must encode 32 bytes as base64, as required upstream. The worker receives its original narrow database/server/shared-secret configuration. Runtime keys, model credentials and OAuth stores never belong in the renderer.

`HyperVmCompose.json` is a deployment override beside the private tools. It makes only these changes to the original Compose file:

- Clear the server's `INTELLIGENCE_BROWSER_GATEWAY_WS_URL`, which Compose otherwise fills despite selecting the original same-origin proxy.
- Attach the server to `data`, `default` and the external network `k3d-local-e866e019ee833a9f6ad99038`. PostgreSQL and the worker retain `data`; the computer and agent retain `default`.
- Bind the private provider directory at `/root/.langchain` in `agent-harness`.

No global authentication, origin or policy bypass is used. First-run setup used the original UI with a disposable test name, skipped the business contact flow and preserved the default Extra vigilant policy.

## Tested operation and recovery

Run the backend commands below in the VM's shell. The variables select only this deployment:

```sh
HYPER_BACKEND_ROOT=/home/agent/.local/share/hypertask-openbot-backend
HYPER_BACKEND_APP=/home/agent/HyperTask-OpenBot-backend
export PATH="$HYPER_BACKEND_ROOT/tools/node-v22.23.5-linux-x64/bin:$PATH"
export COPILOTKIT_CONFIG_DIR="$HYPER_BACKEND_ROOT/cli-state"
export DOCKER_HOST=unix:///var/run/docker.sock
export DOCKER_CONFIG="$HYPER_BACKEND_ROOT/docker-client"
unset DOCKER_CONTEXT
cd "$HYPER_BACKEND_APP"
```

The tested start sequence is:

```sh
docker start k3d-local-e866e019ee833a9f6ad99038-server-0
"$HYPER_BACKEND_ROOT/cli/node_modules/.bin/copilotkit" local start \
  --stack local-e866e019ee833a9f6ad99038 --json
docker compose -p hypertask-openbot-baseline \
  -f "$HYPER_BACKEND_APP/docker-compose.yml" \
  -f "$HYPER_BACKEND_ROOT/HyperVmCompose.json" \
  --profile harness --profile openbot \
  up -d --no-build --pull never postgres agent-computer server worker agent-harness
```

The explicit start of the existing k3d node is a tested recovery step. After a full stop, Docker removed the bridge address because its last member stopped. CLI 4.34.0's Linux sign-in preflight checks that bridge before starting the stack and returned `unsupported_engine`. Starting the same saved node restored the actual bridge, then the unchanged CLI passed and resumed the same stack. No check, agreement or source code was bypassed. Do not create a replacement cluster or delete data to recover from that error.

The tested stop sequence preserves both stores:

```sh
docker compose -p hypertask-openbot-baseline \
  -f "$HYPER_BACKEND_APP/docker-compose.yml" \
  -f "$HYPER_BACKEND_ROOT/HyperVmCompose.json" \
  --profile harness --profile openbot \
  stop --timeout 30 worker server agent-harness agent-computer postgres
"$HYPER_BACKEND_ROOT/cli/node_modules/.bin/copilotkit" local stop \
  --stack local-e866e019ee833a9f6ad99038 --json
```

Do not use the source's broad `scripts/stop.sh`, volume deletion, pruning, cluster deletion or a new Compose identity for normal recovery. Preserve `hypertask-openbot-baseline_postgres-data`, the computer workspace/profile volumes, the server's `.openbot` bind directory, CLI configuration, generated secrets and the same k3d node volumes/PVCs. The test observed every owned service stopped, then verified the same container IDs and mount identities after startup. Mount lists were compared by destination because Docker changes their order.

From the desktop PC, the reference client reaches the backend through this loopback SSH forward:

```sh
ssh -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:3010:127.0.0.1:3010 agent@100.104.170.51
```

The T3 environment link uses a separate forward. Both background forwards need recovery after a desktop reboot. Keep them distinct; closing the reference-app tunnel must not close T3 Code.

| Listener on the VM | Purpose | Exposure observed |
| --- | --- | --- |
| 3010 and 3001 | Original app and server | IPv4/IPv6 loopback |
| 35432 | OpenBot PostgreSQL | IPv4/IPv6 loopback |
| 4100 | Agent computer | IPv4/IPv6 loopback |
| 4206 | LangGraph agent | IPv4/IPv6 loopback |
| 39785 / 43661 / 44799 | Intelligence API / dashboard / gateway | IPv4 loopback |
| 40129 | Dedicated k3d Kubernetes API | IPv4 loopback |

`GET http://127.0.0.1:3010/health` returns 200. `GET /api/copilotkit/info` returns 200, mode `intelligence`, SDK `1.85.0`, license `valid` and agent `picked-harness`. Inspect scoped Compose status and the original CLI's `local status --stack ... --json` privately when diagnosing failures. Full logs/configuration can contain credentials; retain them outside Git.

## Observed acceptance and limits

The original browser composer sent disposable text to `picked-harness`. The capture observed 104 distinct live text deliveries, a completed 571-character answer, exact authoritative saved text and matching user/assistant IDs. The original UI displayed that same text. A diagnostic copy of the focused runner added observation writes around unchanged pass/fail assertions; its hash and artifact hash are recorded.

OpenBot stopped at 09:58:50 UTC, Intelligence stopped by 09:59:35, and both were observed stopped. After the bridge recovery, original Intelligence start completed at 10:02:47 and OpenBot start at 10:02:57. The repository runner then reopened the original channel without sending another prompt. It read the same thread, Bot, user/assistant IDs and full text, and verified them in the original UI. The manifest records the exact capture times and hashes.

The live run exposed a final history-write delay after `RUN_FINISHED`. The runner now waits at most 30 seconds for exact text and IDs; it still fails malformed/unavailable history, identity changes and content that never settles. An earlier live transcript check also failed while reopened saved history was correct. That failure remains recorded; no upstream source was patched to conceal it. Native integration needs tests for streamed state and authoritative restoration.

Linux/rootful Docker remains outside the documented macOS preview. ChatGPT OAuth uses an experimental upstream LangChain implementation and requires online account access. Automatic Learning was not configured; conversation persistence was tested independently. Runtime image sizes, layer sharing, caches and growing data require measurement for a production budget. The installer's 40 GiB free-space check is not a 40 GiB desktop package requirement. Production packaging, native HyperTask chat, tool approvals and application recovery remain later acceptance work.

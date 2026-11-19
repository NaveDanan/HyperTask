# Nod assistant in HyperTask

Updated 2026-11-16. Branch `hyper/nod-backend`. This is the first slice of replacing the licensed backend services behind the OpenBot chat with [Nod](https://github.com/n8n-io/nod), n8n's Apache-2.0 personal agent, pinned at `866158b15302256b718e89dcaf5afdb5751adddb`.

## Why Nod

The OpenBot chat depends on CopilotKit Intelligence 0.15.1. Intelligence holds durable threads, the realtime gateway, memory and Learning. It needs a CopilotKit account, an accepted agreement, an entitlement and a renewable license ([audit](HYPER_OPENBOT_AUDIT.md), [baseline](HYPER_OPENBOT_BASELINE.md)). Nod's own server provides durable threads and turns in PostgreSQL, streaming, approvals, questions, memory, schedules, Vault and a sandboxed computer, with no license gate.

Nod speaks HTTP JSON and server-sent events and keeps one active conversation per owner. It runs independently of OpenBot and Hyper-Bot. The old OpenBot Chat renderer has been retired in Electron. Saved Chat pages display a retirement message, and their stored data remains in place.

## What this slice does

- **Nod assistant** opens from the sidebar and the collapsed rail. It is a singleton local tool tab (`local-tool:nod`), separate from Chat views.
- It shows Nod's one durable conversation, with live streamed text, activity steps, running, waiting and failed states, and older history pages. Messages that newer ones push out of Nod's 150-message window stay visible; hidden messages disappear.
- You can send text and stop Nod's work. Stop applies to every task Nod is running, so the control says so. Text typed while a message is sending is kept.
- It answers pending choice questions, by choice or in your own words, and approvals, including ones found in loaded history. Approvals show Nod's exact fields and body. Choice and written answers target their question, so a background task resumes. An open question in the main conversation takes a normal reply.
- Reopening the tab or restarting HyperTask reloads Nod's saved messages and sends nothing. A send whose outcome is uncertain keeps its message ID across reopening, so an identical retry cannot queue twice.
- Reconnects back off from 1 to 30 seconds and recheck readiness first. They keep retrying while Nod or the VM is unreachable, and stop for problems you must fix, such as setup, a refused token or a missing model. A failed conversation reload also retries, and Reload is offered.

Not yet included: attachments, model selection, the browser view, Vault, memory, schedules and app connections. An open question asked by a background task, without choices, cannot be targeted yet; Nod only resumes main-conversation questions from a plain reply. Nod has no API to create or list independent conversations; that needs a Nod change. Never use its development `POST /api/conversation/reset` as a "new chat".

## Architecture

| Layer | Files | Responsibility |
| --- | --- | --- |
| Shared | `src/shared/HyperNod.ts`, `api.ts` | Renderer-safe types, problem messages, the `hyperNod` bridge |
| Access | `src/main/HyperNodAccess.ts`, `HyperNodAccess.py` | Runs one bundled program over SSH that checks the deployment and returns the access token |
| Transport | `src/main/HyperNodTunnel.ts` | Private named pipe (Windows) or owner-only Unix socket (Linux), one `ssh -W 127.0.0.1:4311` relay per connection |
| Client | `src/main/HyperNodClient.ts`, `HyperNodWire.ts`, `HyperNodSse.ts` | Pinned Nod routes, response validation, the SSE parser, error mapping |
| Identity | `src/main/HyperNodSession.ts` | Binds Nod to the first local HyperTask identity and blocks it during sign-in and sign-out |
| IPC | `src/main/HyperNodIpc.ts` | Trusted main-frame callers, strict argument schemas, one event stream per window |
| Renderer | `src/renderer/features/hyper-nod/` | Controller, pure store, page; reuses the native transcript |

Nod routes used: `GET /api/health`, `GET /api/configuration`, `GET /api/state`, `GET /api/messages?threadId&before&beforeId`, `POST /api/messages`, `POST /api/thread/stop`, `GET /api/events`.

### Security model

- The renderer never receives the token, the host, the port or any SSH detail. It cannot choose a route, header or command.
- Main reads `NOD_AUTH_TOKEN` over the user's existing SSH trust and keeps it in memory only. A 401 discards it; sign-out, identity changes and app exit discard it with every connection.
- Requests carry `Authorization: Bearer`, the fixed `Host: 127.0.0.1:4311` and no `Origin`, so Nod's host, origin and cross-site checks stay in force. Redirects are refused.
- Nod's single-owner token opens the whole assistant. HyperTask binds it to one local profile in `<userData>/hyper-nod-session/owner.json`. Renderer file IPC cannot reach that directory.
- Message bodies follow Nod's strict input schema exactly. Choice answers send Nod's exact formatted text; approvals reply to the confirmation message with its approval ID.
- A send keeps its `clientMessageId` until Nod accepts it, so retrying identical input cannot queue it twice.

## VM runbook

Nod runs on `MMEMS-mems01` beside OpenBot, as a separate Compose project with its own volumes and keys. It does not use OpenBot's or Intelligence's networks, data or ports.

```sh
# On the VM, as agent. Use a pinned source checkout; do not fetch during runs.
git clone https://github.com/n8n-io/nod.git /home/agent/HyperTask-Nod
git -C /home/agent/HyperTask-Nod checkout 866158b15302256b718e89dcaf5afdb5751adddb
cd /home/agent/HyperTask-Nod/deployment/self-host
COMPOSE_PROJECT_NAME=hypernod-866158b1 sh setup.sh   # creates .env (mode 600) with a new token and keys
```

Then set these values in `.env`, keeping the generated secrets:

```dotenv
PORT=4311
NOD_BIND_ADDRESS=127.0.0.1
NOD_PUBLIC_URL=http://127.0.0.1:4311
NOD_ANALYTICS_ENABLED=false
NOD_FEEDBACK_ENABLED=false
NOD_TRACES_URL=
NOD_ONBOARDING_EMAIL_URL=
```

HyperTask refuses the deployment (`unsafe_deployment`) unless the first five values match exactly. It also refuses a `.env` that is not a regular file, owned by `agent` with mode 600. Start, stop and restart with `docker compose --file compose.yaml --env-file .env up -d --build --wait`, `stop` and `up -d --wait`. Never use `down -v`.

Connect a model in Nod once. The Nod assistant reports `model_required` until one is configured. For ChatGPT, use Nod's own sign-in; OpenBot's ChatGPT credentials are not shared. For a local model, set `LLM_PROVIDER=compatible`, `OPENAI_COMPATIBLE_BASE_URL` and `LLM_MODEL` in `.env`. The model must support tool calls; Nod recommends at least 64K of context.

Nod's app integrations go through n8n's hosted Composio proxy by default. Leave app connections unused until a disabled-integrations patch or a self-hosted replacement exists.

The MMEMS K3s cluster is not a target yet: Nod's workspace and browser are Docker containers it controls itself, and there is no Kubernetes provider. Any later cluster image must go to `artifactory.rafael.co.il/mems-docker-local-ww/danan/<image>:<tag>` and be pulled with `nave-pull-secret`.

## Licenses

HyperTask does not bundle Nod. It talks to a separately run Nod server. `hyperNodChoiceText` and `hyperNodApprovalLabels` reproduce two small Nod formatting rules so replies match what Nod expects. Nod is copyright 2026 n8n GmbH, under the Apache License 2.0. Distributing Nod itself requires its LICENSE and NOTICE, including the GPL notices for its optional local speech components. Existing CopilotKit MIT notices for the OpenBot UI remain.

## Validation

Synthetic tests only. They make no live model calls and contact no VM or account.

- **SSE parser:** split bytes, UTF-8 and CRLF at every boundary, comments, size limits, event validation.
- **Client:** a real HTTP server on a named pipe or Unix socket checks headers, exact bodies, history cursors, error mapping, readiness and live events.
- **Access reader:** fixed SSH arguments, report validation, abort and oversize handling.
- **Tunnel:** a real pipe relaying through a mocked `ssh -W` child, failure and close.
- **Session and IPC:** owner binding, transitions, untrusted frames, strict arguments, stale results, stream reporting.
- **Renderer:** stream and history store, controller (subscribe and refresh order, coalescing, retry IDs, reconnect backoff, answers), page states.

No live Nod run has been done yet. Live acceptance needs the VM deployment above and an owner-connected model. It must cover streaming, saved history, Stop, restarting both sides and reopening without resending.

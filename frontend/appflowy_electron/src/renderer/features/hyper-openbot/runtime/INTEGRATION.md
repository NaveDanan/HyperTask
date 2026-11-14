# Runtime integration

Source pinned to `/home/naved/HyperTask-OpenBot-baseline` commit
`f8af37ab73e96784f174a11104505a965e722cab`. Adapted computer tool schemas,
approval run observation, ownership/capability checks, outcome mapping and step
ordering retain CopilotKit MIT attribution. License is in `../LICENSE`.

Mount `<HyperRuntimeTools resolveFacts={resolveFacts} onApprovalPending={refreshApprovals} />`
once below `HyperOpenBotProvider`. `resolveFacts(botId)` must fetch the calling Bot's
server profile and current deployment capabilities. Its profile shape is
`{ visibility, canManage }`; capabilities are `cloudBrowser`, `cloudNetwork`, and
`cloudComputer`. Unknown profiles deny tools; unresolved switches follow upstream
semantics and leave final enforcement to the server. Do not substitute the selected Bot.
Apply `hyperFilterRuntimeTools(input.tools, facts)` to each calling agent's outgoing
run tool list, including continuation runs. Registration alone does not narrow offers.

Call `hyperObserveApprovalAgent(agent)` before starting an SDK conversation and use
`hyperWhileObserved(agent, () => /* existing runAgent invocation */)` around the entire
turn. Call the observer's returned release on unmount. Observation then remains alive
until in-flight turns finish. Channel agents need `runtimeAgentId` set to the real Bot;
`channel:*` and `default` are never computer destinations. No fallback to the screen.

Every tool sends the original captured runId, threadId, toolCallId, raw call args,
messages, state, context and forwardedProps to the server approval gate. Preserve
forwardedProps exactly, including `openbotTimeZone`, channel and thread routing data.
The provider's timezone property alone does not replace observing actual run input.
HTTP 202 stops the agent and returns `{ waiting: true }`; the server owns execution
and resume. The observer removes waiting placeholder answers from later run history.
The parent's approval inbox must handle decisions and refresh the saved thread when
server continuation arrives. Never execute an action again locally after approval.

Transport allowlist needed: `POST /api/approvals/computer/:botId` with the complete
snapshot JSON. No direct computer execution paths are needed for these 11 tools.
All reads also use this gate to avoid a separate every-step policy query. This is
more conservative than upstream's direct-read optimization. Transport must preserve
HTTP 202 and error status/body and propagate abort. Uses existing hyperOpenBotFetch;
no arbitrary host requests, process execution, file access or account authorization.

Lead manifest: schemas import `zod`, currently present transitively in the prepared
node_modules. Declare the existing compatible Zod version directly; no install was run.

Not registered: `computer_request_secret`, `computer_request_help`, sign-in and
arbitrary sandboxed/generative JavaScript. These require a real masked secret or
human-control surface, or a separately approved sandbox. No placeholder handlers.
The 11 registered tools execute in the server-managed computer, never the local host.

Live viewer investigation: upstream uses `/api/computers/:botId/stream` and
`/api/computers/:botId/terminal` WebSockets. Existing fetch IPC cannot proxy socket
messages. Any future bridge must restrict those paths, use the authenticated main
session, and enforce control ownership on reconnect. Screen frames begin with
`{"type":"frame"`; acknowledge requested frames with `{"type":"frame-received"}`.
Terminal accepts input/resize messages and binary output. Fatal/superseded viewer
errors must stop reconnects so tabs never compete for ownership. Do not point native
renderer WebSockets at the service or expose a general socket bridge. These are
future allowlist requirements, not implemented or advertised viewer controls.

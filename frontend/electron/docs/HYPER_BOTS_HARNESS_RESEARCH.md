# Choosing a harness for Hyper-Bot

20 November 2026 • HyperTask commit `365968d`

## Recommendation

Build the next Outlook or Jira capability on the existing runtime. When a feature calls for a second model API or streamed replies, trial Pi's provider package behind `HyperBotsEngine.complete()`. HyperTask already has an interface for a model call and another for a connector. Adding a connector can proceed independently of that trial. [Model engine](../src/main/HyperBotsEngine.ts) · [Tool contract](../src/main/HyperBotsRuntime.ts) · [Connector registry](../src/main/HyperBotsConnectors.ts)

## What a replacement would have to preserve

A Scout calendar read can lead to a hand-off to Scribe, which can propose creating a Jira issue. HyperTask records the model for each run, shows the owner the Jira destination, and checks it again before sending. A changed project needs a fresh approval. If Jira may have received the write when the app stops, HyperTask records the outcome as `unknown` and leaves it for the owner to reconcile. The default limit is eight model steps per run. The default hand-off depth allows the owner to reach a bot and that bot to reach another. [Runtime](../src/main/HyperBotsRuntime.ts) · [Flow tests](../src/main/HyperBotsFlow.test.ts) · [Destination and identity tests](../src/main/HyperBotsAudit.test.ts)

## Candidates

| Candidate | What it supplies | Where it earns its place in HyperTask |
| --- | --- | --- |
| Pi | The TypeScript package `@earendil-works/pi-ai` handles provider protocols, tool-call formats and streaming. The separate `pi-agent-core` package runs a tool loop and exposes execution hooks. Nod uses Pi for sessions and applies its own guard to tool calls. [Provider API](https://github.com/earendil-works/pi/tree/main/packages/ai) · [Agent core](https://github.com/earendil-works/pi/tree/main/packages/agent) · [Nod runtime](https://nod.n8n.io/docs/how-it-works/agent-runtime/) | First choice for expanding model support in Electron. Start with a single model call. HyperTask can persist the proposed action, collect approval and run its existing connector. Consider agent core separately if the product later needs its turn-loop features. |
| Hermes Agent | A Python agent with memory, skills, scheduled jobs, subagents and a messaging gateway. Its HTTP server runs tools on the backend. Python plugins can register custom tool handlers. [Project](https://github.com/NousResearch/hermes-agent) · [API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) · [Plugin guide](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins) | Strong candidate for an always-on assistant that learns routines and reaches users outside the desktop app. Using it for Hyper-Bot would require a bridge back to the signed-in user's connector and approval state. For that broader assistant role, compare it with the [existing Nod integration](HYPER_NOD_NATIVE.md). |
| LangGraph JS | Explicit steps and branches, checkpoints and human interrupts. A resumed node starts again at its beginning. The app chooses a checkpoint backend. [Interrupt semantics](https://docs.langchain.com/oss/javascript/langgraph/interrupts) · [Checkpoint backends](https://docs.langchain.com/oss/javascript/langgraph/checkpointers) | Strong candidate for a named process that branches and resumes over days, such as collecting evidence, waiting for review, revising and filing. Such a graph could reuse HyperTask's write records. A saved checkpoint alone cannot tell whether Jira accepted a request before a connection dropped. |

## How to decide whether to ship Pi

1. Choose one user-visible reason for the trial, such as a model provider with a different API. If the goal is streamed replies, include delivery of text updates to the renderer. The current engine interface returns one finished message.
2. Exercise the packaged app with the configured endpoint. Verify both Chat Completions and the existing Responses fallback, credentials from the main process, cancellation and redacted errors. Pi's Chat Completions implementation requests a stream. Test the proxy with that request shape. [HyperTask engine](../src/main/HyperBotsEngine.ts) · [Pi request builder](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-completions.ts)
3. Run Scout's read and Scribe's write against controlled connectors with the candidate engine. Restart once while an approval is pending and once during the write. Confirm that only the signed-in owner can resume, a changed destination asks again, and an uncertain write produces no second request. The existing flow and audit tests specify the expected outcomes. [Flow tests](../src/main/HyperBotsFlow.test.ts) · [Audit tests](../src/main/HyperBotsAudit.test.ts)

Adopt the provider package if it delivers the chosen feature and those cases hold. The tool count alone does not justify changing the runtime. This assessment draws on source and documentation. Packaging, proxy compatibility and runtime behavior with a candidate remain untested.

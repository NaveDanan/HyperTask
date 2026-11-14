# Computer and browser reuse

Upstream: `/home/naved/HyperTask-OpenBot-baseline`, commit `f8af37ab73e96784f174a11104505a965e722cab`. Copyright (c) 2026 CopilotKit, MIT. HyperTask by NaveDanan.

| Local file | Exact upstream source |
| --- | --- |
| HyperComputerApi.ts | app/src/lib/browser/mutations.ts, queries.ts; app/src/lib/bot-browser/mutations.ts, queries.ts; app/src/lib/computers/control.ts |
| HyperBrowserSection.tsx | app/src/components/browser/browser-page.tsx; shared/openbot-browser.ts; shared/bot-browser.ts |
| HyperBrowsersSection.tsx | app/src/routes/_authed/settings/browsers.tsx; app/src/lib/recorder/queries.ts, mutations.ts |
| HyperBotComputerTab.tsx | app/src/routes/_authed/bots.$agentId.computer.tsx; app/src/components/computer/computer-controls.tsx |
| HyperLiveScreen.tsx | app/src/components/computer/live-screen.tsx; server/src/computer/routes.ts human input contracts |
| HyperScreenConnection.ts | app/src/lib/computers/screen-connection.ts |
| HyperComputerSocketPolicy.ts | New native restriction for server/src/computer/routes.ts stream and terminal routes |
| index.ts | Native exports |
| HyperComputerApi.test.ts, HyperScreenConnection.test.ts | Native mocked transport and lifecycle regressions |

The native implementation uses existing Button/Input components and theme tokens. Cookies remain in main. Frames render as validated JPEG data URLs. Browser writes refresh authoritative state even after refusal. Failed browser polling disables navigation and input until a successful read. Queued input is cancelled when the viewer changes or ownership is lost.

## Remaining parity work

The full upstream desktop, this-computer and fleet settings, file explorer/editor/download, terminal UI, sleep/wake/reset/update, private secret handoffs, stream socket mouse/key gestures and microphone narration are not yet ported. The native viewer currently uses the server's HTTP human click/type/key routes. Recorder extension discovery/connection requires the browser extension bridge, which is not provided by this Electron renderer. Connected browser listing/revocation is implemented; recorder history pagination is not. These are incomplete scope, not claimed equivalents.

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

The native implementation uses existing Button/Input/Textarea components and theme tokens. Cookies remain in main. Validated frames decode into canvas bitmaps. Mouse press/release/move, drag, double-click, wheel, key up/down, modifier release and clipboard paste retain the upstream socket protocol. Browser writes refresh authoritative state even after refusal. Failed browser polling disables navigation and input until a successful read.

| Additional local files | Exact upstream source |
| --- | --- |
| HyperTerminal.tsx, HyperTerminalTheme.ts | app/src/components/computer/live-terminal.tsx, terminal-theme.ts |
| HyperScreenGeometry.ts | app/src/components/computer/take-the-wheel.ts, preview-visibility.ts; app/src/lib/hotkeys/hotkeys.ts keyOf |
| HyperWorkspaceApi.ts, HyperFiles.tsx | server/src/computer/routes.ts file list/read/write/download; server/src/computer/schema.ts |
| HyperComputerSettings.tsx | app/src/components/manage/computers-page.tsx; app/src/lib/computers/queries.ts, mutations.ts |
| HyperHostFolders.tsx | app/src/lib/computers/host-access.ts |
| HyperBrowserAddress.ts | app/src/lib/browser/address.ts |
| HyperNarration.ts, HyperNarrationControl.tsx | app/src/lib/browser/narration.ts, mutations.ts |
| HyperOnDeviceSpeech.ts | shared/on-device-speech.ts |
| HyperNarration.test.ts, HyperNarration.fixture.ts, HyperOnDeviceSpeech.fixture.ts | app/tests/browser-narration.test.ts, browser-narration.fixture.ts, on-device-speech.fixture.ts |
| HyperBrowserAddress.test.ts, HyperScreenRecovery.test.ts | app/tests/browser-address.test.ts, screen-connection.test.ts |
| HyperWorkspaceApi.test.ts | Native mocked transport contract tests |

Terminal uses upstream xterm 6.0.0 and addon-fit 0.11.0 from the parent's existing dependency installation. Binary output, snapshots, resize, acknowledgment flow control, ownership-gated input, reconnect and explicit retry are implemented. No dependency manifests or lockfile changed in this branch.

Files support folder listing, text reads and edits, confirmed overwrite, authoritative read-back and opaque downloads. Truncated reads cannot overwrite a full file. Remote file contents are inert text. Unsaved changes require confirmation before navigation. No delete endpoint exists in the assigned server file routes.

Settings support fleet GET/POST stop/reset/update, actual server state, confirmation, host-access status/grants/revoke/stop and connected-browser list/revoke. The server enforces admin and Bot permissions. Sleeping computers start on the next action; no invented wake route exists.

Narration preserves on-device-only recognition, language model installation by user gesture, phrase timing, speaking holds, mute/retry, network backoff and stop flush. Requests carry the original phrase/speaking schemas and stamp sentAt when sent. External narration is offered only for a Bot or a personal browser reporting external narration.

## Integration boundary and remaining work

This is a bounded terminal/files/settings/narration unit, not a claim of complete area parity. Recorder extension discovery/connection and recording history pagination remain unported. Private secret handoffs and full help/recovery cards remain unported. The existing conversation computer panel remains the prior screenshot/activity view; the exported Bot computer tab offers browser/terminal/files/folder navigation.

OpenBot's local This computer controls require its Tauri ShellIpc invoke/transformCallback bridge. This remote HyperTask integration exposes no equivalent permissioned host API. Upstream desktop restart/stop, diagnostics, local container memory, local update installation and native speech cannot be fabricated through backend routes. A future closed Electron bridge would need explicit operations, main-owned authenticated session and local runtime ownership checks, fixed runtime/container targets, user confirmation for destructive operations, bounded results and cancellation. Arbitrary shell commands are not an acceptable bridge. These controls remain unavailable here, as desktopShell is absent. The on-device Web Speech API reports unsupported when Electron cannot supply local recognition.

Shared edits are limited to this area's registry entries, policy family slot and appended policy tests, plus the owned main WebSocket route check. The main exact regex is duplicated intentionally to avoid importing renderer code into the composite Node project and is checked against the renderer policy by tests.

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

## Final supported integration

| Added local files | Exact upstream source |
| --- | --- |
| HyperRecorder.tsx | app/src/lib/recorder/queries.ts, mutations.ts; app/src/components/settings/browsers/browser-sections.tsx |
| HyperRecorderBridge.ts, HyperRecorderPage.ts, HyperRecorderExtension.ts/json | app/src/lib/recorder/bridge.ts; shared/recorder-page.ts, recorder-extension.ts/json |
| HyperRecorderBridge.test.ts | app/tests/recorder-bridge.test.ts |
| HyperPrivateHandoffs.tsx | app/src/lib/computers/control.ts; app/src/components/computer/help-request-card.tsx; reuses native vault/HyperSignInForm.tsx |
| HyperComputerDestination.tsx | app/src/routes/_authed/bots.$agentId.computer.tsx, adapted to native section navigation |
| HyperRecorder.test.ts | Native mocked recorder API, private secret and navigation regressions |

Recorder discovery handles connected, unconnected, older, absent and unreachable extensions. Pairing mints the original via:web code, passes it only to the discovered extension and observes connected, waiting, closed, cancelled and expiry states. Refusals retain upstream fixed sentences, including throttling. No code is stored. Record/stop use the original extension messages. History follows server nextCursor, polls loaded pages, shows unavailable/error/empty states and retains loaded rows on unavailable responses. Extension calls have bounded waits.

Conversation computer panels retain passive non-waking screenshots and activity until the person opens the shared live Bot computer tab. The same tab provides browser, terminal, files, folder grants, handoff take/release/cancel and masked secret entry. Secret fields reset before submitting, and secret-bearing errors are generic. Pending website login requests reuse Vault's typed HyperSignInForm and onOpenBrowser callback, including code, saved-login, takeover, finish and decline states. Bots and Vault navigate to one computer destination; no second Bot detail editor is created.

Settings reuse HyperTask's existing HyperServiceStatus/useHyperOpenBotService and main-owned service state/run/configure contracts for the configured owned VM. Start/check/stop/restart retain existing session/ownership checks and destructive confirmation. This work does not invoke live services. No arbitrary command IPC, remote HTML embedding, CSP relaxation or new credential storage is introduced.

## Environment limits

A native Electron page cannot discover extensions installed in a separate Chrome/Edge profile. The original bridge reports unreachable and explains using OpenBot in the browser or its Recorder toolbar. The pinned upstream configuration publishes neither a Chrome nor Edge store ID, so a store URL is not fabricated. If an extension runtime is exposed by a supported browser host, the complete upstream discovery/connection/record/stop flow runs. Live browser pages use the computer stream rather than embedding remote pages; extension store destinations use the existing external-browser opener. No iframe bypass is introduced.

OpenBot Tauri local-only contracts have no remote equivalent: desktop check_update/install_update/dismiss_update, open_logs, per-local-process/container memory, and plugin speech_available/speech_start/speech_stop/speech_abort callbacks. Native Web Speech is used only where the runtime supports on-device recognition; otherwise it reports unsupported. These environment limits are explicit. Equivalent remote runtime lifecycle uses the existing closed HyperTask service API; no local Tauri operation is reported as successful.

## Shared edits

Besides the owned registry and allowlist slots and main/socket checks, minimal wiring changes touch HyperOpenBotPage.tsx, bots/HyperBotsPanel.tsx and vault/HyperVaultSection.tsx to pass typed computer navigation. HyperComputerPanel.tsx is owned by this area. The shared policy checks encoded traversal only in the pathname so nested file paths and opaque recording cursors can be query values. Canonical query-path guards in main and the parent's voice/computer socket guards are preserved. Tests cover query values and refused route traversal.

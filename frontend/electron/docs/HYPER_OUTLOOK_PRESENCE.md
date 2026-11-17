# HyperOutlook presence

Classic Outlook must remain open for the calendar, mail and Hyper-Bot Outlook tools. Minimizing it is sufficient. New Outlook (olk.exe) is not a COM provider.

## Detection and connection

HyperOutlookPresenceWindows reads OUTLOOK.EXE App Paths in HKCU/HKLM, in both registry views, once per app process. A classic Outlook process is also installation evidence. It uses hidden, session-filtered tasklist calls every four seconds (twelve when HyperTask is minimized/hidden), with no overlapping poll. Registry/process checks do not use COM. Failed detection preserves the previous state rather than claiming Outlook closed.

The bridge uses Marshal.GetActiveObject('Outlook.Application') exclusively, including the directory fallback. There is no Outlook COM activation. Before attaching or reusing COM it checks OUTLOOK in the helper's Windows session; critical readiness properties use Hyper-ComGet/InvokeMember so failed reads cannot silently become null. Outlook-closed requests fail immediately once the watcher has observed closure, and the script checks again before any COM operation. Active Directory people searches can still work independently of Outlook.

On process exit or PID replacement, presence clears the helper's COM state by terminating only HyperTask's PowerShell helper. Disconnect HRESULTs also invalidate the cached connection. An in-progress write retains an unknown outcome; queued calls are rejected as not sent. Nothing is replayed automatically. The next request attaches to the reopened Outlook. Status probes back off during the first ninety seconds of profile/ROT startup, then continue every thirty seconds for late readiness and connection health. Process polling proceeds independently of a slow COM probe. Presence changes invalidate the Hyper-Bot connection cache and refresh its chip; connected events reload the calendar immediately, and closed events clear stale calendar events with the closed message.

## Notice and launch

A token-styled, non-modal card appears in the signed-in shell at bottom-right, 8rem above the bottom edge to leave the composer send control and Get support bubble clear. It uses the app's floating surface, buttons and scaled text styles. It waits five seconds after installation is known at startup if Outlook is closed (allowing a full process poll during grace), appears immediately after an observed running-to-closed transition, and stays silent if classic Outlook is absent. It hides when connected, including a manual reopen, with no success notification. Not now suppresses it until Outlook runs and closes again or the next app start; session memory survives shell/sign-in remounts.

Open Outlook uses a fixed Start-Process outlook.exe -WindowStyle Normal through a hidden PowerShell helper. It supplies no Outlook switches or profile arguments and does nothing if the process is already running. New IPC methods accept no arguments and trust only the main window's top frame. The button spins until connected, reports launch errors inline, and re-enables after ninety seconds if connection has not succeeded.

## Automated validation

- npm run typecheck: passed for main/preload/shared and renderer.
- npx --no-install vitest run src/main/HyperOutlook src/main/HyperBots src/renderer/features/hyper-outlook: final run had 226 passed, 1 failed, 1 skipped. All Outlook/presence/reconnect tests passed. The failure was the untouched HyperBotsStore.test.ts tombstone regression (#3): Windows EPERM renaming its temporary state.json.tmp to state.json (HyperBotsStore.ts:204). Those files were not changed. The previous full run passed all 226 then-existing tests, with only the real-Outlook integration test skipped.
- HYPER_OUTLOOK_IT was set to 0 for test runs so no real mailbox integration ran. No Electron app was launched, and Outlook was not started, closed or driven during implementation.
- PowerShell script parse: zero errors. A read-only App Paths/tasklist check confirmed installation and one classic Outlook process in the current session; the tasklist call took 652 ms on this PC.
- git diff --check: passed for edited tracked files (only existing Windows line-ending notices).

## Manual acceptance (use the real app)

1. With classic Outlook open and the calendar overlay and Hyper-Bot screen available, close Outlook using its window control. Within about four seconds (up to twelve if HyperTask was hidden), verify the notice, the unavailable calendar message and the disconnected Outlook chip. HyperTask must not start a hidden Outlook.
2. Reopen Outlook manually, completing any profile prompt. Verify the notice hides after status succeeds, calendar events reload, and the Outlook chip refreshes, without restarting HyperTask. Repeat a close/reopen cycle.
3. Close Outlook again. Press Open Outlook. Verify a visible normal Outlook window opens, the button reads Opening Outlook with a spinner until connected, then the notice hides. Check any profile prompt; leave it unresolved for ninety seconds to verify the inline timeout/retry behavior, then complete it and verify automatic recovery.
4. Close Outlook, press Not now, and keep HyperTask open. Verify the popup stays dismissed. Open Outlook manually, wait for connection, then close it again; verify the notice returns.
5. Start HyperTask with classic Outlook closed. Verify no popup for five seconds, then the notice. If Outlook auto-starts during that grace period, verify no notice. Verify it never appears on signed-out screens or when classic Outlook is not installed.
6. Check light/dark/custom themes and Appearance text scales, keyboard button focus, and placement alongside the composer and support bubble. No Outlook messages or calendar items need to be created, sent or modified.

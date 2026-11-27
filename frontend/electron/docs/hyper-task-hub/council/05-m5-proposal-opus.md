# M5 proposal: Opus (visuals and UX)

Written independently, without reading `05-m5-proposal-astra.md` or `05-m5-proposal-sol.md`.

## Summary

1. The view switch grows from two to five: **Focus, Board, Meetings, Matrix, Timeline** (keys 1 to 5). Filters stay shared, and the choice is saved per user.
2. **Write-back is a dialog, never a gesture.** A Board drag still changes local state only. Where the source disagrees, the card shows a "Jira says In Review · Update…" chip. A source write happens only through the **Change status in Jira/Newsletter…** dialog, which states the target, account, exact change and current version, and has its own confirm button.
3. The dialog offers only what the server lets *this* user do: Jira transitions from `GET …/transitions`, and Newsletter statuses only where Astra can prove both edit rights and a version guard. Otherwise it says why and offers **Open in source**.
4. Outcomes are visible on the card: *Updating…*, *Updated* (toast with Undo, where Undo opens a new, separately approved dialog), *Failed* (with the reason), *Conflict* (review again), and *Unknown* ("check in Jira", never retried).
5. **Settings → Task Hub** is a full page. It edits sources, aliases, work week, privacy and write-back opt-ins (off by default), and the weights, with presets and a live "what moves" preview.
6. **Meetings**: the next 7 days by day, each with readiness, Viewed and related work, plus a "Needs prep" filter. Every row opens the same brief sheet.
7. **Matrix**: a 2 × 2 of Sol's quadrants. A drag records a named override with Undo; it never writes to a source.
8. **Timeline**: a read-only wrapper over the vendored ReUI `Gantt`. It shows verified dependency arrows only, marks cycles, and lists undated items in a tray.
9. **Add to Hyper-Kanban** is an explicit card-menu action with Undo, and **Hyper-Event** meetings get a "Prep brief" entry. No vendor file is edited.

## A1 Q1. Write-back architecture, as the UI sees it

I want main to own everything that matters, and the renderer to hold only opaque tokens:

```
card menu / chip ──► hub.previewWrite({ taskId, sourceRefId })        (no gesture needed: read-only)
                     ◄── HyperHubWritePreview { previewId, expiresAt, target, account, current, options[], blocked? }
dialog confirm  ──► hub.executeWrite({ previewId, optionId, fields? })  (only from the dialog's confirm button)
                     ◄── { status: 'succeeded' | 'conflict' | 'failed' | 'forbidden' | 'unknown', ... }
snapshot         ──► task.writeBack?: { state, at, ledgerId, message? }  drives the card chip
```

UI rules that follow from this:
- **The confirm button is the only caller of `executeWrite`.** No keyboard shortcut, no drag, no batch and no Hyper-Bot path reaches it. Enter in the dialog confirms only after focus has visibly moved to the primary button. The initial focus is **Cancel**, as in `HyperOutlookSendConfirm`.
- **The preview expires.** When `expiresAt` passes while the dialog is open, the primary button changes to **Check again**, which calls `previewWrite` again.
- **Recheck results are shown, not hidden.**
  - A `conflict` keeps the dialog open with an alert: "ENG-317 changed in Jira since you opened this. It's now *In Progress*." The options are refreshed in place.
  - A `forbidden` result shows "Your Jira account can't make this change." with **Open in Jira**.
- **Unknown is sticky.** A card whose write timed out shows a warning badge, *Jira update unknown*, with **Open in Jira**, until the next sync settles it. The dialog for that card refuses a new write until then, and says why.
- **Undo** appears in the success toast only while the ledger entry is still the latest change and the source still shows our status. It opens the same dialog, prefilled with the reverse change. It is never one-click.

Offline: the menu entry stays visible but disabled, with the tooltip "Status changes need a live connection to Jira." I do not queue writes for later. A queued write would be a silent write.

## A1 Q2. Permissions in the UI

- **Loading:** a skeleton row reading "Checking what you can do in Jira…". The preview is fetched when the dialog opens, never in the background for every card.
- **Allowed, one option:** a single row "In Review → **Done**", with the transition's own name ("Resolve issue") as a secondary label.
- **Allowed, several options:** a radio group of server transitions, each showing *transition name → target status* plus a status-category lozenge (To Do grey, In Progress blue, Done green, using Badge light variants). The option Sol's mapping prefers for the requested Hub state is preselected.
- **Needs fields:** if a transition requires a **Resolution**, I render a single select over its `allowedValues`. That is the one exception, because Jira Server "Resolve" screens commonly require it. Any other required field disables the option, with "Needs fields Task Hub can't fill (Fix Version). Open in Jira to finish."
- **Not allowed:** an Alert, "You don't have permission to change this issue's status," with **Open in Jira**. There is no retry button.
- **Write-back off:** the menu item reads "Change status in Jira…" and opens a short explainer with a **Turn on in Settings** link, so the opt-in is never hidden.

## A1 Q3. Status mapping and where a write is offered

I defer the mapping tables to Sol and Astra, but the UI positions are mine:
- **A Board drag never writes.** After a drop that changes a card's Hub state on a write-enabled source, the toast says "Moved to Done in Task Hub" and offers a secondary action, **Also update Jira…**, which opens the dialog. Dismissing the toast changes nothing.
- **A status-differs chip** on cards and in the Focus "Do this first" card: "Jira: In Review". It is shown only when the local state and the source category disagree and write-back is on. Clicking it opens the dialog.
- **Explicit menu entry:** "Change status in Jira…" or "Change status in Newsletter…" on every card from a write-capable source, in Board, Focus, Matrix and Timeline.
- The Focus **Done** action (X) stays local and shows the same toast offer.
- **Newsletter progress:** when the target is *completed*, the preview shows "Progress 60% → 100%" only if the server sets it. I would not offer free progress editing in M5.

## A1 Q4. The other M5 items

### Meetings (`meetings/HyperMeetingsView.tsx`)

- **Layout:** day groups for the next 7 days in the owner's zone, with sticky headers ("Today", "Tomorrow", then "Tue 1 Dec").
- **Row:** time range (tabular, isolated), subject (`dir="auto"`), readiness badge (reuse `HyperReadinessBadge`), the Viewed eye, "3 open items", a **Join** button for `https:` links only, and a stale badge.
- **Private, confidential and unknown-sensitivity** items render as a muted "Busy" row with no subject and no click target.
- **Filter:** a **Needs prep** toggle (readiness *none*, eligible, starting within 7 days) with its count. It works with the shared search and source filters.
- **Keys:** J and K move, Enter opens the brief, O joins.
- **Empty states:**
  - "No meetings in the next 7 days";
  - "Connect a calendar", deep-linking to Settings → Task Hub;
  - "Calendar not refreshed since 09:12" as a partial-coverage alert.

### Matrix (`matrix/HyperMatrixView.tsx`)

- **Quadrants:** four labelled cells, **Do first** (urgent and important), **Schedule** (important), **Fit in** (urgent), and **Later**. I avoid "Delete" because the Hub never deletes.
- **Axes:** logical-direction labels ("More urgent", "More important"), so RTL mirrors correctly.
- **Cards:** the compact card variant. Each quadrant shows at most 50, then "+N more", the same cap language as the Board.
- **Separate trays:** items Sol cannot place (unknown urgency *and* unknown importance), and Waiting or blocked items, so they never inflate **Do first**.
- **Drag:** a dnd-kit drag between quadrants calls feedback `matrix-override { taskId, quadrant }`. The card then shows a "Moved by you" marker and the toast offers Undo. The **Why?** popover lists the override. A drag never offers a source write.

### Timeline (`timeline/HyperTimelineView.tsx`)

- **Gantt setup:** the vendored `Gantt` with `interactions` disabled and `readOnly` events, wrapped like `HyperGanttTimeline` through `data-slot` selectors, with no vendor edits.
- **Rows:** a resource tree of source, then project, then task.
- **Bars:**
  - a bar from the planned start to the due date, or an effort-length bar ending at the due date (Sol's selector decides);
  - a milestone when only a due date exists;
  - `progress` from Newsletter;
  - `dependencies` from verified edges only.
- **Cycles:** tasks in `cycleTaskIds` get a warning outline, and a legend explains "Dependency loop".
- **Range:** **7 days** and **4 weeks** presets, plus **Today**. The default is 4 weeks at the week scale.
- **Undated items:** a collapsible tray, "No dates (N)".
- **Clicking a bar** opens the same card popover as the Board, with **Why?**, menu and Open.
- **Colours:** bar colour follows the Hub state (Next primary, In progress info, Waiting muted, Done success), from design tokens only.

### Settings → Task Hub (`features/settings/HyperTaskHubSettings.tsx`)

- **Registration:** an additive `SettingsPage.taskHub = 'taskhub'`, registered in `SettingsDialog.tsx` with the `ListTodo` icon, and built with `components/app/settings-layout.tsx`.
- **Sections:** Sources, You, Work week, **Write-back**, Ranking, Privacy.
  - The first three reuse the setup sheet's step bodies. I extract them into `setup/HyperHubSetupSections.tsx`, so first-run and settings share one implementation.
  - **Write-back:** one switch per source, "Allow status changes in Jira" and "Allow status changes in Newsletter". The description reads: "Task Hub asks you before every change, uses your own account, and only offers what your permissions allow." Outlook shows a fixed line: "Outlook stays read-only."
  - **Ranking:** four sliders (slack, importance, unblocking, age), each 0 to 100 with its normalised percentage, and presets *Balanced (default)*, *Deadline first*, *Importance first* and *Unblock others*. **Reset** sits next to them.
  - **The live preview** shows Sol's pure diff over the current snapshot: the top 10 under the new weights, with ↑3 and ↓2 movement markers and a "12 tasks move" summary. It is debounced at 150 ms, and Save and Cancel apply or discard it.
  - **Privacy:** mail retention, AI-summary consent, and a destructive **Clear Task Hub data** confirmation.
- **The Hub's gear** keeps the first-run sheet until setup is complete, then opens Settings → Task Hub.

### Hyper-Event chips

The Hyper-Event Outlook event dialog (`hyper-outlook/HyperOutlookEventDialog.tsx`) gains a **Prep brief** button when Astra's shared cache maps the occurrence to an eligible agenda item. It uses the same brief-request store as Focus and HyperHome. I would not draw readiness icons inside the vendored calendar in M5.

### Add to Hyper-Kanban

- **Where:** a card-menu item on non-native items.
- **Effect:** it runs feedback `mirror { taskId }`, then shows the toast "Added to Hyper-Kanban" with Undo. A mirrored card shows "Open in Hyper-Kanban" instead.
- **Not offered:** for Triage items until they are accepted, or for anything derived from private meetings.

### Command palette (carried over from D9.1)

"Task Hub: Do this first", "Task Hub: Triage" and "Prep: <next meeting>", if they are still missing.

## A1 Q5. Security, from the UI side

- The renderer never sees tokens, account secrets or raw responses. It sees display names and the host only.
- All source text in the dialog is rendered as text (`dir="auto"`, `<bdi>`), never as HTML or Markdown. This includes Jira transition names, status names and the issue summary.
- There is one write entry point (`executeWrite`), reachable only from the dialog's confirm button. A test asserts that no other component imports it.
- Hyper-Bots get no new write tool through the Hub in M5.

## A1 Q6. Tests and acceptance (UI)

- **Write-back dialog states:**
  - loading, single option, several options, resolution required, unsupported fields;
  - forbidden, offline, expired preview, conflict, failed;
  - unknown (sticky badge, new write refused);
  - success toast with Undo, where Undo reopens the dialog.
- **Board:** a drop stays local, and the toast offer opens the dialog.
- **Meetings:** grouping by day across Jerusalem DST, private rows show "Busy", the Needs prep count, and Enter opens the brief.
- **Matrix:** the quadrant drag emits an override with Undo, and the trays hold waiting and unknown items.
- **Timeline:** only verified edges render, cycles are marked, and the undated tray appears.
- **Settings:** weights normalisation is shown, the preview diff renders, Cancel discards, and the write-back switches default off.
- **Harness screenshots** of every new view and dialog state in light and dark themes, with Hebrew content.

## Work breakdown (Opus files)

| File | Change |
| --- | --- |
| `HyperTaskHubView.tsx`, `HyperTaskHubPage.tsx` | five views, write-back toast offers |
| `meetings/HyperMeetingsView.tsx` (+ test) | new |
| `matrix/HyperMatrixView.tsx` (+ test) | new |
| `timeline/HyperTimelineView.tsx` (+ test) | new |
| `writeback/HyperWriteBackDialog.tsx`, `writeback/HyperWriteBackBadge.tsx` (+ tests) | new |
| `board/HyperHubCard.tsx`, `focus/*` | menu items, status-differs chip, write state |
| `setup/HyperHubSetupSections.tsx`, `setup/HyperTaskHubSetupSheet.tsx` | extract the shared sections |
| `features/settings/HyperTaskHubSettings.tsx`, `SettingsDialog.tsx`, `settings-dialog-store.ts` | new page, additive enum value |
| `hyper-outlook/HyperOutlookEventDialog.tsx` | Prep brief button |
| command palette | three entries |

## Positions I hold strongly

- No source write without the dialog and its own confirm. That rules out writes from a drag, a shortcut, a batch or a bot.
- An unknown outcome is shown and never retried automatically.
- Undo of a source write is a new approved write, not a hidden revert.
- No vendor edits. The Timeline is a wrapper, and readiness in Hyper-Event goes in our own dialog.
- Write-back is off by default, per source, with an explainer when off.

## Where I am flexible

- Quadrant names and thresholds (Sol's call), as long as Waiting and unknown items stay out of **Do first**.
- Whether the Resolution exception is in M5 or deferred.
- Whether the Settings page reuses the setup sections or gets its own layout.
- Whether Newsletter write-back ships in M5 or is shown as "Open in Newsletter" until a guarded path exists.

# HyperBots in HyperTask

The **Hyper-Bot** tab runs bots and group conversations inside HyperTask. Two bots ship by default, each with a direct room and also together in **Ops**:

| Bot | Tools by default | Access |
| --- | --- | --- |
| `@scout` | Outlook calendar and mail reads (`outlook_list_events`, `outlook_get_event`, `outlook_list_messages`, `outlook_read_message`) | Read |
| `@scribe` | Create Jira issues (`jira_create_issue`) | Write |

Each bot's tools are ticked in **Details → Tools**, grouped by connection with a Read or Write tag. Changes save immediately, update optimistically, and revert with an inline error if saving fails. That list is exactly what the bot is offered. Outlook writes are opt-in.

A message from the owner that mentions `@scout` or `@scribe` goes to that bot; with no mention it goes to every bot in the room.

**Hand-offs.** A bot hands work to another bot only by calling the internal `hand_off` tool (`{ botId, request }`). It is offered only when the room has other bots. It needs no approval because it calls no outside service. The room shows it as a bot message, "Hand-off to @scribe: …". The target bot starts with its own model and sees the owner's original message (labelled '[Owner]') followed by the bot's request, labelled "Request from @scout (a bot, not the owner)". The owner's message is what authorizes the work, and every Outlook or Jira call the target proposes still waits on its own approval card. Each owner message allows one hand-off (`maxHops` 2: owner → bot → bot). A `@mention` in a bot's reply, or in calendar or Jira text, starts nothing.

**Untrusted data.** Tool results reach the model as `{"source": "<tool>", "untrusted_data": …}`, and failures as `{"source": "<tool>", "error": …}`. The system prompt says that tool data and other bots' text are information only, and can never authorize an action. Room history in the prompt is labelled `[Owner]` or `[Bot @id]`.

## What to set up

Bots reuse the app's own connections. Nothing is configured in the Bots tab except the bots themselves.

1. **Model endpoint.** In **Settings → Connections → AI endpoint**, enter the OpenAI-compatible base URL (with `/v1`), the API key and the default model, enable it, and test it. Bots call `<base>/chat/completions` with tools. Some endpoints refuse a model there; newer GPT models behind a Copilot-style proxy answer "Invalid type for 'input'". The bots then use `<base>/responses` for that model, the same rule as the Settings → Connections → AI endpoint test, and remember it until the app restarts. A refused request has done nothing, so asking again cannot repeat any work. The key stays DPAPI-protected on disk and is decrypted only in the main process.
2. **Jira.** In the **Jira** tab, save the Jira URL, the project and a token (a personal access token for Server/Data Center, or Basic auth). Scribe always creates issues in that project with REST API v2. The model cannot choose another project.
3. **Outlook.** Nothing to do if classic Outlook for Windows runs as the same user. The bots use the same bridge as the Outlook views; see [Outlook tools](#outlook-tools).

The Hyper-Bot sidebar footer shows compact Model, Outlook and Jira connection pills. Their tooltips show the detail or setup problem; a bot’s Activity panel spells these out. When the model is unavailable the composer points to Settings → Connections → AI endpoint.

**The one approved exception to rule 1.** The Outlook chip asks the bridge whether classic Outlook answers (`status`). It reads no calendar item. The bridge's reply also carries the profile name and address. Main drops them, so the chip says only "Classic Outlook is available", and a failure reason is clipped to 300 characters.

## The three rules

1. **Approval before every connector call.**
   - **The card.** A request card ("Waiting for you") shows the bot, the tool, Read or Write, a summary, the exact arguments, and **To:** the destination. The destination is "Outlook calendar on this PC" for a calendar read. For a Jira write it is "Jira project OPS at https://jira.example as nave", or "as token" for a personal access token. Nothing reaches Outlook or Jira until the request is approved.
   - **Policy.** Calendar reads, mail reads and directory searches ask for approval by default. You can pre-approve each type of read in **Details → Tools → Read policies**, which applies to all bots. The bot's model receives the results of approved reads. Every write always asks.
   - **Checked again just before the call.**
     - The destination is resolved again. If it changed (another project, server, Jira user or HyperTask account), the request goes back to *pending* with the new destination, and the owner must approve it again. A rotated token for the same destination is not a change.
     - If the destination cannot be resolved, the request is *failed* and nothing is sent.
     - A read approved by policy goes back to the owner when the policy is no longer **allow**. Saving settings does this at once.
     - If the bot no longer has the tool, or the bot was removed, the request is *skipped* ("the bot no longer has this tool") and the run continues without the call. Saving settings skips such pending and approved requests at once.
   - **Unknown outcomes.** If the app stops while a call is running, the call is marked *unknown* and never re-run. A Jira call that times out, loses its connection or gets a 5xx is also *unknown*, so it is never retried into a duplicate issue.
2. **No message is sent twice.**
   - Each message carries an ID. A retry, or reopening the tab, re-sends the same ID and creates nothing new. A request can be approved only once.
   - The renderer keeps an outbox per signed-in user. A message keeps its ID until the app confirms it, even if the page closed and reopened meanwhile. Two unconfirmed messages keep separate IDs.
   - Main keeps a tombstone for each owner message ID (room, ID, text hash, model), apart from the room history. A message dropped from history is still recognized. The same ID with the same text creates nothing, and with other text it is refused.
   - Up to 100,000 tombstones are kept. When there are more, the oldest are trimmed to 90,000.
   - History pruning never drops a run that is still working, or that has a pending, approved or running request, nor that run's trigger message and reply.
   - A message and its whole run plan (each bot and its model) are stored in one write. A retry creates only the planned runs that are missing.
3. **Model fixed per message.** Pick a model in the message box, or leave it on **Bot default**. The model is recorded when the message is sent and used for every step of that answer, even if settings change. A bot reached by hand-off uses its own model. A bot's model can be set in **Details → Activity → Engine**; the default is the endpoint's model.

## Conversation history and tool activity

Hyper-Bot opens the selected room at its newest 16 messages. **Load earlier messages** adds 40 more and keeps the current reading position. The first room response includes compact previews and activity counts for the sidebar. Outlook, Jira and model connection checks finish separately. Each tool card appears under the message that started its run and shows the bot, action, destination and current outcome. Pending writes keep their approval controls.

The model receives the most recent complete, author-labelled room messages that fit within 32,000 characters, followed by the current request. Earlier messages remain available for reading within the existing 2,000-message retention limit. Active work can pin messages past that limit. Each run still has its own eight-step limit.

On 2026-11-20 a local fixture with 2,000 messages, 1,000 completed runs and 1,000 tool decisions produced a 12.4 KB opening snapshot. Reading and validating its state file took 24 ms. In a separate headless Chrome measurement with that snapshot and a simulated IPC bridge, the production renderer showed the conversation in approximately 115 ms after mounting. Loading the next 40 messages kept the first visible message within one pixel of its original position. These measurements exclude desktop startup, sign-in and live model latency.

## Where things live

- **State:**
  - Each HyperTask account has its own messages, runs, approvals, tombstones and bot settings in `<support>/hyper_bots/users/<account>/state.json`. `<account>` is the first 32 hex digits of a SHA-256 of the core profile's auth type, numeric id and email.
  - The file is written atomically, and every record is validated when it is loaded.
  - A run that fails validation, such as a step counter that is missing or not a whole number, is kept but stopped as *failed* ("Stored run was damaged and was stopped."). It is never run, and its open requests are *skipped*.
  - A request that fails validation becomes *unknown* and never runs.
  - A file that cannot be read at all is set aside as `state.json.corrupt-<time>`. The app still starts, and that account's Bots calls report the problem.
- **Who is signed in:**
  - Main asks the Rust core (`GetUserProfile`) on every Bots call and ignores anything the renderer says about the user. `open` takes only an optional room.
  - Signing out stops that account's bots. Switching accounts stops the old account's bots before the new account's runtime starts. Main checks the account again after core init, sign-in, sign-out and account changes.
  - When the app starts, approved work resumes for the signed-in account only. Nothing runs while signed out.
  - Each account's Scribe uses that account's Jira tab settings.
- **Earlier versions** kept one shared `<support>/hyper_bots/state.json` and a `hyperBots.userId` preference. The preference is removed at startup. The shared file is left on disk untouched and is not read, because it cannot be assigned safely to one account.
- **Errors** that reach the room or a request card are redacted before they are clipped. This covers the API key, the Jira token and Basic credentials, including their JSON-escaped and URL-encoded forms. Errors about a malformed model reply never repeat the reply's values.
- **Code:**
  - main: `src/main/HyperBots{Store,Engine,Runtime,Connectors,OutlookTools,Ipc,Hub}.ts`; Outlook ops in `src/main/HyperOutlook{Schema,Script,Bridge}.ts`
  - renderer: `src/renderer/features/hyper-bots/`
  - contract: `src/shared/HyperBots.ts`

## Outlook tools

| Tool | Access | What it does |
| --- | --- | --- |
| `outlook_list_events` | Read | Events between two times (up to 31 days), each with an `id` for the other tools. |
| `outlook_get_event` | Read | One event in full: description, attendees and their answers, join link. |
| `outlook_create_event` | Write | A new event; with attendees, Outlook sends the invitations. `onlineMeeting: "teams"` or `"skype"` adds an online meeting (below). |
| `outlook_update_event` | Write | Title, time, location or description of an event the owner organizes; the update goes to its attendees. |
| `outlook_forward_event` | Write | Organizer: adds people and sends the update to everyone. Attendee: forwards the original invitation (found in the Inbox or Deleted Items). |
| `outlook_list_messages` | Read | Inbox, Sent Items or Drafts, newest first, with sender, subject, time, a 300-character preview and an `id`. |
| `outlook_read_message` | Read | One message as plain text (8,000 characters by default, 20,000 at most), recipients, attachment names and sizes, and meeting details for an invitation. |
| `outlook_send_message` | Write, Send or Draft | A new plain-text email to up to 20 addresses (To and Cc). No attachments. |
| `outlook_reply_message` | Write, Send or Draft | Reply or reply all; the text goes above the quoted original. |
| `outlook_forward_message` | Write, Send or Draft | Forward with a note; the attachments go along. Forwarding an invitation forwards the meeting. |
| `outlook_respond_meeting` | Write, Send or Draft | Accept, tentative or decline, with a comment, from an invitation message or a calendar event. With tentative or decline it can propose a new time. |

- **The card.** Outlook writes show the lines the owner approves: **From** (the default sending account), **To** and **Cc**, recipients outside the sender's domain flagged in amber, the subject and the full text (each line in its own direction), and for a reply, forward or answer the message or meeting it acts on. A line that mixes English with a title or name stays left to right, and the title keeps its own direction, so a Hebrew meeting title neither flips the line nor moves its punctuation. A reply lists the recipients Outlook's own Reply or Reply All gives, Reply-To included. That preview is an unsaved reply, discarded at once.
- **Send or Save to Drafts.** Mail writes (send, reply, forward, answer an invitation) have **Send** and **Save to Drafts** buttons instead of Approve. A draft lands in Outlook Drafts for the owner to send from Outlook.
- **Pinned to what was approved.** The fingerprint covers:
  - the sending account;
  - the item acted on, and its content: a hash of a message's subject, sender name and address, plain and HTML text, and each attachment's name, size, type and creation and change times, or an event's or invitation's last-modified time;
  - a reply's exact recipients;
  - an edit's changes.

  A change before the call sends the request back to the owner. The script checks the same values again just before it writes. If Outlook cannot read every part of a message (its text or an attachment's details), a bot cannot reply to it or forward it. Outlook values are read so that a failed read raises an error: plain PowerShell property access would turn a failed read into an empty value. It sends only from the approved account; an existing meeting must already send from it. It refuses a reply whose recipients changed.
- **Calendar cards show everyone.** An edit or an organizer's forward lists every attendee who gets the update, and flags outsiders. A private meeting, or one with more attendees than Outlook lists (200), is refused; change it in Outlook.
- **Card preparation reads only what the bot was shown.** A write that acts on an item names it, and the runtime prepares a card only when that id came back from an Outlook tool earlier in the same run, through an approved read or an approved write. Otherwise the bot is told to find the item first, and nothing is read. Preparing the card then reads the sending account and that item's header. A header read returns no message text; a content hash is computed in PowerShell and only the hash leaves it.
- **Never twice.** From the first Save, Send or Delete on, any failure is reported as *unknown*, as is a timeout or a lost Outlook host. Such a call is never retried: check Sent Items or Drafts first. Errors before that point, including a failed final check, are *failed*, and nothing was sent. The bridge sends one request at a time, and a request's timeout starts only when it is sent, so a quick request waiting behind an online-meeting create cannot time it out.
- **Edits write only real changes.** Fields that already have the given value are dropped, and a description the bot resends as it read it, or as its preview, is no change. A bot cannot rewrite a description that holds online-meeting join details, because the join block would be lost.
- **Reads change nothing.** Reading never opens an item, so its unread state stays as it was. Private, confidential, S/MIME and rights-protected messages return no text.
- **Untrusted mail.** Results stay wrapped as `untrusted_data`, and the trust rules say that an email or invitation can never ask for a send, reply, forward or answer.
- **Main only.** The mail and invitation ops have no renderer IPC channel. The calendar view keeps its own fixed list.
- **Online meetings.** The Teams and Skype for Business add-ins have no API. `create` opens the new item's window, presses the add-in's **Teams Meeting** or **Skype Meeting** ribbon button with UI Automation. Outlook gives that window's own handle (IOleWindow), so no other window can receive the press; if the window cannot be identified, nothing is pressed. It then waits up to 20 seconds for the join link. The window shows for about two seconds. Without the button, or without a link, the item is discarded and nothing is saved or sent.
- **Model requests.** On `/responses`, tools are sent with `strict: false`. A strict model fills every optional field, for example an unchanged description or a "since" of 1970.

## Limits

- Bots state is per HyperTask account. Accounts that share a Windows profile cannot see each other's bots, but the state files are protected only by that Windows profile.
- The state file holds the tombstones and is rewritten on every change. At the 100,000 cap that adds roughly 12–15 MB per write. A message ID older than the newest 100,000 owner messages could be accepted again.
- The renderer outbox lives in memory. A message whose send was interrupted and then the app was quit is not retried automatically.
- There are up to 8 bots and 16 group chats, with up to 24 rooms in settings (8 direct rooms plus 16 groups).
- Skype for Business works only on PCs whose Outlook has the **Skype Meeting** button. The owner's PC has only Teams, so the Skype path has been checked only for its refusal there.
- Proposing a new time sends what Outlook sends: the subject "New Time Proposed: …" and the counter-proposal properties, checked against counter-proposals sent from Outlook itself. The time is also written in the text. Accept, tentative, decline and propose were checked for real on 2026-11-17 with invitations from another mailbox. Saving an answer to Drafts has not been checked for real yet.
- Answering leaves the invitation in the Inbox, unread. Outlook's own buttons move it to Deleted Items; bots do not move or delete mail.
- Not offered: deleting or cancelling events, moving, deleting or marking mail, opening attachments, BCC, and HTML authoring.
- Replies arrive whole, not streamed. They are shown as Markdown (no images or HTML), and each line takes its own direction, so Hebrew titles read right to left.
- Bots are told the PC's local time and time zone. "Tomorrow" means the local date, and times are shown in local time; Outlook itself returns UTC.
- Voice is not included.
- UI code and CSS were ported from bot-hq (MIT, Copyright (c) 2026 Nick Vasilescu): Sidebar, ChatView, Transcript, Composer, DetailsPanel, EngineSettings, MembersCard, modal/picker components, avatar shapes and palette, and shell/chat/details/cards/modals/base styles. See [NOTICE.md](../src/renderer/features/hyper-bots/NOTICE.md) for the full MIT license and the separate Grok Bot artwork notice; that artwork is not covered by the MIT grant.

## Tests

```
npm run typecheck
npx vitest run src/main/HyperBots src/renderer/features/hyper-bots src/shared
```

- `HyperBotsFlow.test.ts` runs the whole path with the per-account hub and the real store, runtime, engine and connectors. The model, Outlook and Jira are replaced by local fakes.
- `HyperBotsAudit.test.ts` re-runs the reproductions from the HyperBots audit against the integrated code.

## Hyper-Bot screen

The columns follow bot-hq's UI, restyled with HyperTask theme tokens. Entering the active Hyper-Bot tab temporarily collapses the main sidebar to its 56px rail. Leaving or closing the tab restores the previous state unless the user toggled it while in Hyper-Bot; only user changes persist. The generic plugin flag is prefersCollapsedMenu. At window widths of at least 900px with the main sidebar collapsed, the active primary page portals its 330px list into HyperChromePanel in the app chrome. A tab-owned width claim shifts HomeStack using the sidebar's existing transition and releases on tab switch/unmount. Otherwise the list stays inside the content card (212px below a 701px page width). The panel and dialogs retain data-hyper-bot.

The list has a bold title without header controls. Its first bot is pinned, other bots show a last-message preview or their type, and group rows stack their members' avatars. The Group chats row always includes a New group chat plus button, even without groups. Connection chips stay at the bottom and wrap on narrow layouts or larger text scales. Sidebar foreground/accent tokens keep rows consistent with the main sidebar in light, dark and custom themes. Working, needs-you and unread dots update from room events and compact room summaries. Opening a room clears its unread dot.

Hand-drawn inline Outlook and classic Jira SVG marks identify every tool row, approval header, recent decision (including those in the transcript), and Outlook/Jira connection chips in the list and details. They are decorative, preserve all labels, and use per-instance React useId gradient IDs. The current create/settings dialogs contain no tool picker; any shared HyperBotToolsForm gets the marks. Trademark attribution is in NOTICE.md.

A bot opens its direct room. The floating chat pill offers details, settings and a new group chat. User bubbles use the bot's color; bot replies use HyperMarkdown and the theme message surface. Group replies show sender avatars/names. Date dividers, grouped bubble corners, hover times, run/failure lines and approval cards share the transcript. The composer grows with its draft, retains per-room drafts and retry IDs, and keeps the selected per-message model, including an unlisted model. Group conversations retain the @mention hint.

The 320px details panel defaults open at page widths of at least 1100px and overlays the chat below that width; the page container query continues to measure the chat/details surface after the list moves into chrome. Its open/closed state lasts for the window session. A bot has Activity and Tools: Activity contains Connections, the endpoint/model Engine editor with Save/Undo, and recent decisions; Tools contains the per-bot catalog and global read policies. Groups show Members (add/remove, keeping at least one member) and recent decisions.

Create New Bot has the 13 silhouette shapes in 5/5/3 rows, 11 colors in 6/5 rows and Personal assistant / Teammate choices. A name is limited to 40 characters. New IDs are ASCII slugs capped at 24 characters, falling back to bot and adding unique -2/-3 suffixes. New bots have four Outlook read tools, with writes opt-in. A new bot's direct room gets a random four-character suffix (dm-<botId>-<hex>): messages stay stored under a deleted bot's room, so a later bot with the same name never inherits that history. Mode labels the bot and selects default instructions only. New group chat needs a name and at least two distinct existing bots. Bot settings edits identity/type/instructions (4000 characters) and offers confirmed deletion except for the last bot. Deletion removes the direct room and group memberships; empty groups are removed. Group settings renames or deletes the group. Dialogs close with Escape or a scrim click and restore focus. The last selected room is remembered per signed-in user in localStorage, with guarded storage access and a fallback to the first bot's direct room.

## Additive settings contract

Version remains 1; IPC channels, local-tool:bots and storage paths stay compatible. HyperBotConfig adds optional avatar: { shape, color } and mode: personal | teammate. Shape values are blob, cloud, square, sparkle, clover, heart, flower, teardrop, tablet, wedge, house, star and hex. Colors are black, brown, red, orange, yellow, green, cyan, blue, violet, magenta and gray. Scout defaults to sparkle/blue and Scribe to tablet/green; both are personal assistants. A bot saved without an avatar is drawn with its default look, or with a shape and color picked from its id (never black or gray), until Bot settings saves one. HyperBotsRoom adds optional kind: direct | group; Ops is a group.

hyperBotsWithDirectRooms converts kind-less rooms to groups and appends missing single-bot direct rooms. IDs start with dm-<botId>, are cut to 32 characters and get deterministic unique suffixes on collision. It is pure and idempotent. Runtime reads apply it after validation and the old policy fix; saves persist and return it. Both settings schemas accept the new fields and 24 rooms; a direct room must have exactly one bot, and a bot may have only one direct room.

### Renderer code

All paths below are in src/renderer/features/hyper-bots/.

| File | Purpose |
| --- | --- |
| HyperBotsPage.tsx | Signed-in entry point, keyed by user. |
| HyperBotScreen.tsx | Three-column composition, session preferences, room restoration and dialogs. |
| HyperBotsController.ts | IPC lifecycle, coalesced snapshots, room selection, summaries and user outboxes. |
| HyperBotSidebar.tsx | Pinned bot, direct/group rows, live dots and connection pills. |
| HyperBotChat.tsx | Floating header, menus, notices and chat composition. |
| HyperBotTranscript.tsx | Date dividers, grouped Markdown bubbles, sender labels, run lines and approvals. |
| HyperBotComposer.tsx | Auto-growing pill, model selection, menus and outbox draft binding. |
| HyperBotApproval.tsx | Existing approval semantics in the ported card shell and recent outcomes. |
| HyperBotDetails.tsx | Activity/Tools and group details. |
| HyperBotEngine.tsx | Provider detail, model select, Save/Undo and endpoint status. |
| HyperBotTools.tsx | Ordered per-bot tools and optimistic saves; global read policy controls. |
| HyperBotBrandLogos.tsx / HyperBotToolProvider.ts | Decorative integration marks and catalog-group provider lookup. |
| HyperBotMembers.tsx | Group membership editor. |
| HyperBotCreateDialog.tsx | Create a bot, save it and select its direct room. |
| HyperBotGroupDialog.tsx | Create a named group with at least two bots. |
| HyperBotSettingsDialog.tsx | Bot/group editing and confirmed deletion. |
| HyperBotModal.tsx | Scoped portal, focus trap/restoration, Escape and scrim dismissal. |
| HyperBotPickers.tsx | Accessible shape/color/type radio pickers. |
| HyperBotMenu.tsx | Anchored, keyboard-accessible contextual menus. |
| HyperBotAvatar.tsx | Silhouette rendering, the fallback look for bots saved without an avatar, and overlapping member avatars. |
| HyperBotMiniSelect.tsx | The compact value-and-chevron pill over a transparent native select (composer and Engine model pickers). |
| HyperBotShapes.ts | Ported silhouette/eyes SVG paths (separate artwork notice). |
| HyperBotColors.ts | Ported palette and bot CSS variables; black follows the app primary. |
| HyperBotSettings.ts | Pure bot/group CRUD, IDs, descriptions and guarded room storage. |
| HyperBot.css | Source CSS scoped under data-hyper-bot with hb tokens mapped to app tokens. |
| NOTICE.md | Full upstream license and artwork attribution. |

### Supporting files changed for this port

| File | Purpose |
| --- | --- |
| src/shared/HyperBots.ts | Avatar/mode/room-kind types and defaults, 24-room contract and pure direct-room migration. |
| src/shared/HyperBots.test.ts | Migration kinds, collisions, deterministic IDs, purity and idempotence. |
| src/main/HyperBotsRuntime.ts | SettingsSchema additions and direct-room validation; normalization in settings/saveSettings only, plus required imports. |
| src/main/HyperBotsIpc.ts | Additive settings argument fields, 24-room limit and direct-room invariants only, plus required imports. |
| src/main/HyperBotsRuntime.test.ts | Existing settings expectations updated for generated direct rooms. |
| src/main/HyperBotsIpc.test.ts | Existing settings expectations updated for generated direct rooms. |
| src/main/HyperBotsSettings.test.ts | Runtime/IPC compatibility, invalid shape/direct-room rejection and 24-room acceptance. |
| src/renderer/features/hyper-bots/HyperBotsController.test.ts | Existing guarantees plus selection, summaries, other-room events, draft isolation and stale settings reads. |
| src/renderer/features/hyper-bots/HyperBotsPage.test.tsx | New markup while retaining approvals, all delivery actions, drafts, model behavior and settings protections. |
| src/renderer/features/hyper-bots/HyperBotSettings.test.ts | Slugs, bot cap/defaults, deletion cleanup, group membership rules and tool descriptions. |
| src/renderer/features/hyper-bots/HyperBotPort.test.tsx | Direct/group markup, dialog picker counts, settings limits, sidebar status and transcript grouping. |
| src/renderer/features/sidebar/SidebarButtons.tsx | HyperBotsButton label changed to Hyper-Bot. |
| src/renderer/features/sidebar/HyperSidebarRail.tsx | Bots rail label and tooltip changed to Hyper-Bot. |
| src/renderer/features/tabs/plugin.ts | Bots tab title changed to Hyper-Bot; local-tool:bots preserved. |
| docs/HYPER_BOTS.md | Screen, migration, code inventory, licensing and validation handoff. |

### Implementation verification (2026-11-17)

- npm run typecheck: passed (main and renderer TypeScript projects).
- npx vitest run src/main/HyperBots src/renderer/features/hyper-bots src/shared: 18 test files passed, 229 tests passed.
- No production build, Electron launch, screenshot capture or mock app harness was run. The real-app screenshot review, including 900px layout, light/dark/custom themes, picker scale and keyboard focus, remains for Claude as requested. Portaled dialogs and the page carry data-hyper-bot; stylesheet tokens are feature-scoped and mapped to app tokens. The separate avatar artwork notice is in NOTICE.md.

### Chrome panel and integration marks verification (2026-11-17)

- npm run typecheck: passed.
- npx --offline --no-install vitest run src/renderer/features/hyper-bots src/renderer/features/home src/renderer/features/tabs src/renderer/features/sidebar: 13 files, 131 tests passed. Includes temporary collapse/restore, manual override and responsive transitions, stale slot-owner cleanup, tool/provider mapping, unique SVG references, and the empty group-list action.
- Electron and mock harnesses were not launched. Claude should review chrome/card title alignment, entering/switching/closing tabs, rail/header/hotkey overrides, the 899/900px boundary, the details overlay/scrim, dialogs opened from the chrome list (focus restoration and theme scope), and 14–16px logos in light/dark/custom themes with increased text scale.

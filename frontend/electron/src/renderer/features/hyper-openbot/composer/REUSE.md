# HyperTask composer reuse

Source: `/home/naved/HyperTask-OpenBot-baseline`, pinned commit `f8af37ab73e96784f174a11104505a965e722cab`.
Copyright (c) 2026 CopilotKit. MIT license reproduced in `LICENSE`.
Adapted for HyperTask, developed by NaveDanan.

| Local file | Exact upstream source files |
| --- | --- |
| `hyper-files.ts` | `shared/attachments.ts`; `app/src/components/channels/composer/picked-files.ts` |
| `hyper-models.ts` | `app/src/lib/models/effort.ts` |
| `hyper-model-picker.tsx` | `app/src/components/channels/composer/model-picker.tsx` |
| `hyper-composer.tsx` | `app/src/components/channels/composer/composer.tsx`; `app/src/components/channels/composer/attachment-strip.tsx` |
| `LICENSE` | `LICENSE` |
| `index.ts`, `hyper-composer.test.ts`, `REUSE.md` | New integration exports, policy tests and documentation. |

MIME policy, attachment limits, screening and model effort functions are ported from source. React markup adapts composer behavior to HyperTask Button, Textarea and Select primitives and tokens. Model and thinking effort use separate selects. Rich prompt segments, dictation and queue management are outside this assignment.

`HyperComposer` owns text and transient errors. The caller owns attachment state, uploads, server IDs and preview URL cleanup. `onFiles` receives screened files and must resolve after attachment placeholders are committed. Slots stay reserved while it runs. Server inspection remains required for unnamed MIME types. Uploading and failed attachments block send. Ready attachments may send without text.

`onSubmit` receives a text and attachment snapshot. Reject to retain the draft and show an error. Resolve when accepted; `onConsumeAttachments` then receives exactly the sent IDs. Text edited during the send is preserved. Enter sends, Shift+Enter inserts a newline, and IME composition does not send. Pending turns allow editing. Stop requires `stoppable` and `onStop`. Autofocus is claimed once; sends and model choices return focus to the editor.

Exported integration types: `HyperComposerProps`, `HyperComposerDraft`, `HyperComposerAttachment`, `HyperAttachmentStripProps`, `HyperModelPickerProps`, `HyperModelOption`, `HyperModelPick`, `HyperRejectedFile`, `HyperScreenedFiles`, `HyperAttachmentKind`. All exports are available through `index.ts`. Models and attachments are supplied by the caller.

HyperDictationFormats.ts, HyperDictationRecording.ts and HyperDictationSession.ts adapt shared/dictation.ts and app/src/lib/dictation/{recording,session}.ts respectively. HyperDictationControl.tsx adapts the recorded dictation controls from app/src/components/channels/composer/composer.tsx. Audio uses the main-owned transport, with no local persistence. Cancellation generations, microphone release, 120-second/10-MiB limits, retry and late results are preserved. The control checks the deployment's transcription capability and appends transcribed text to the current draft.

The earlier exclusions of queue management and dictation are superseded by HyperQueue.ts, HyperLiveDictation.ts and the integrated composer controls. Their exact upstream mapping and ownership interfaces are recorded in ../conversations/REUSE.md. Queue reducer tests are adapted from upstream; HyperComposerQueue.test.tsx checks the real submit/drain handlers, refusal restoration and attachment ownership. Slash choices use granted skill slugs, and the selected command IDs survive native draft navigation without serializing draft text or File contents.

Native Chat supplies `onRestoreQueued` to transfer unsent queued text, command IDs and staged attachment references back to the still-current channel draft when navigation unmounts the composer. It does not delete those restored files. Returning requires explicit sending of that draft; there is no background outbox or process-exit persistence. Identity-invalidated leases refuse restoration. Standalone callers without this callback retain upstream attachment cleanup behavior.

If a submitted send rejects after unmount, the callback also restores its complete queued/live snapshot in `failed-send` mode. A matching failed retry identity remains available rather than creating a duplicate user message. Newer content still merges into the owner draft, and stale identity leases refuse both restoration modes. No retry or model run is started automatically while the page is absent.

Mounted and uncontrolled send failures follow pinned upstream recovery: failed text is restored before newer text, and earlier/newer selected skill IDs are merged. Attachment-only failures do not erase newly typed words. Neither draft is silently dropped while the send is pending.

Native Chat also supplies channel-owned active attachment IDs. A remounted composer hides/excludes those refs from subsequent snapshots and cleanup until the owning send settles; ownership cleanup is tied to its submission ID and trusted draft lease. No File bytes or credentials enter the channel cache.

Review-06 composer corrections gate both explicit submission and queue drain on current readiness. `disabled`, `submitDisabled`, `allowQueue=false` and active dictation hold queued intent. Navigation transfers it to the existing owner draft without sending. Cached form/file/removal handlers use current callbacks; active refs cannot be parked twice or removed through an earlier strip. The active refs are excluded from the next draft's eight-file capacity while queued files and synchronous upload placeholders still count once.

The common form/Enter path checks the actual dictation session during microphone permission, recording, transcription, errors and live stop grace. Recorded/live subscriptions also disable Send. Draft revisions reject text from submitted, edited, cleared or disabled drafts, including callbacks retained before a rerender. Capability-read failure offers the existing supported recognition source and a scoped "Retry dictation availability" action. Neither starts recording or recognition automatically. No native recognition bridge or provider acceptance is claimed.

`HyperConversationDraftCache.beginAttachmentSend` reserves a fresh upload group for the next draft. The retry keeps its submitted message ID, file IDs and original group. Retrying those same refs does not rotate the follow-up bucket again. Completion checks both the identity generation and a per-send ownership token, including a retry of the same message ID. Queued navigation restoration preserves a still-pending send's retry, including text-only sends. Returning failed files beside newer files can exceed eight; all refs remain visible and Send refuses until the person removes excess files.

The pinned `server/src/channels/attachments.ts` counts unattached rows per uploader/channel/upload group, with eight per group and a separate 32-row per-uploader backstop across groups. These server limits and original routes are unchanged. `HyperComposerUploadGroups.test.tsx` exercises the production composer, draft lease and upload helper against a deterministic fixture of those limits. It is source contract coverage, not a live server/native test.

Required parent wiring remains outside composer ownership:

- In `HyperOpenBotPage`'s `onFiles`, call `assertDraftCurrent()` and capture `const uploadGroup = getDraft().uploadGroup` once at batch entry, before `hyperUploadDraftFiles`. Every file in that batch must post that captured value as the existing `uploadGroup` form field. Remove the render-level `uploadGroup` destructuring when it becomes unused. Reading the group from a previous render, or anew for each file, can mix buckets after a send rotates ownership. Keep the existing raw `getAttachmentCount={() => getDraft().attachments.length}`, owner-active ID guards, placeholder helper and lease assertions.
- `HyperComposerProps.focusRequest?: string | number` requests current-textarea focus once per changed token and defers while disabled. In `HyperNewConversationSection`, supply a monotonically changing token when a valid preselection exists on arrival, when a recipient is added, and after successful inline Bot creation selects its recipient. Leave it undefined until a recipient exists. Increment rather than using the recipient count, so clearing and reselecting the same Bot still requests focus. Keep existing arrival/navigation guards. The composer does not claim recipient focus integration until that caller is wired.

Final parent wiring implements both requirements above: the owned lease is asserted and its upload group captured once at batch entry; the new-conversation caller supplies changing focus tokens for current preselection, recipient choice and inline creation. All new props/retry metadata remain optional. Existing exports, ownership, protocols and notices are preserved. The focused real-handler cases and combined 1614-test suite pass. Native verification and another Codex review were explicitly waived by the owner, not counted as passes.

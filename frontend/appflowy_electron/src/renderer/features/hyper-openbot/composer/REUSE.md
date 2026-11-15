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

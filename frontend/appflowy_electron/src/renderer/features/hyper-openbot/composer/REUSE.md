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

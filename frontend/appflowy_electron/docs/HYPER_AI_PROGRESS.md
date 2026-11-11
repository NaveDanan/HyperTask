# AI chat and document writing

AI chat uses the existing Rust chat store and native stream ports. It loads message history,
streams responses, cancels generation, selects the configured model and chooses document
sources. The renderer keeps message IDs as bigint and reconciles streamed text with the
persisted answer. Markdown rendering escapes HTML and refuses executable link schemes.

OpenAI-compatible endpoint mode refreshes the selected source documents before sending a
question, including pending editor saves. Provider keys remain in the existing core/settings
path. The renderer does not store provider keys or implement a separate AI provider.

The document writing control provides summarize, rewrite, spelling/grammar, continue,
explain and translate through the existing CompleteText events. Generated output is a draft.
Only explicit Insert result or Replace selection actions call the editor callback. Replacing
requires both the captured source text and selection identity to match the current selection.
The editor callback must check these again when applying a result because the document may
change while an asynchronous apply is pending.

The control captures the current selection for each Generate action. Request and model-list
versions keep stale responses from overwriting later state. Cancellation waits for a task
acknowledgement when needed; disposal closes the port and stops a task whose acknowledgement
arrives after the control closes. Chat history, model and source requests also check their
view lifecycle before applying responses to a reopened view.

Integration contract for `HyperDocumentAI`:

```tsx
<HyperDocumentAI
  documentId={session.id}
  selectionText={selectedText}
  documentText={pageText}
  selectionKey={blockAndRangeRevision}
  editable={canEdit}
  onApply={(result, mode, captured) => applyValidatedResult(result, mode, captured)}
/>
```

Labels are exported as `hyperDocumentAIStrings` for the `hyperDocumentAI` translation
namespace. Controls use existing Base UI wrappers and ReUI alerts/badges with theme tokens.

Summary and Translate database fields have explicit saved-property and row-body source
selection, model/language controls, cancellable previews and an Apply action. Applying checks
the current owner, permissions, field options and source bytes. Read-only inspection does not
start a generation request. The core has no compare-and-swap cell event, so these checks do
not establish atomic protection against another client's simultaneous write.

Canvas AI previews mind maps and presentations without changing the document. Generated
JSON has bounded depth, size and strict fields; the app chooses element IDs, geometry and
wrapping. Add to canvas appends editable elements once, preserves unrelated edits and rejects
changed included sources. Existing page text and selected labels are opt-in. The controls use
the existing model selection and completion stream events.

Generate image uses the endpoint's separate image-model setting. It imports a validated
artifact for the preview, then requires Add image to canvas. The preview must load before Add
becomes available. Completion context includes only the supplied source IDs, so saved file
attachments cannot enter a canvas request implicitly. The chat attachment flow keeps its
existing behavior.

Generated assistant image URLs pass through a main-process bridge that accepts only raster
artifacts in the active core's generated-image directory. Validated bytes are copied into
managed image storage with content-derived names. Repeated renders reuse the file; existing
files are never replaced. Chat renders the managed protocol URL and offers an explicit save
action. Remote Markdown images remain links. Owner changes discard late preview replies.
Canvas images store the managed path and description; exported SVG/PNG and document exports
embed raster data instead of machine paths. Missing attachments stop an export.

The completed desktop checkpoint passed 1,627 tests in 265 files without skips, typechecking and
a production build. It covers Canvas AI model/controller/native dialog interactions,
real-core loopback requests and restart, image bridge/filesystem boundaries, native image
display/save/owner changes, chat owner transitions and portable image exports. Check [FEATURE_PARITY.md](FEATURE_PARITY.md)
for the current checkpoint and remaining scope. These are disposable fixtures, not claims
about a real configured provider. Real Ollama, vLLM, embeddings, self-hosted multi-client
validation, transcription and workflows remain open.

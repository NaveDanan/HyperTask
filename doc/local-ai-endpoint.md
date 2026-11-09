# User-configured AI in the local desktop build

Open **Settings > AI**, enter the API base URL (including its API prefix, commonly `/v1`) and exact chat model ID, optionally enter an API key, embeddings model ID, and image generation model ID, enable the endpoint, and save. **Test endpoint** sends a small chat request to the configured API. Reopen existing chats after changing the model. No provider URL or credential is preconfigured.

Inference uses the OpenAI `POST /chat/completions` API. Streaming uses SSE; a non-streaming JSON completion response is also accepted. The configured service must supply a text-capable chat model. If its optional embeddings model is configured, it must also supply OpenAI-compatible `/embeddings` responses. Redirects are rejected so credentials never move to an unconfigured host. AppFlowy-owned domains are rejected by both settings validation and the backend. Disabling the endpoint produces a configuration/capability error and does not select a hosted fallback.

## Feature coverage

- Existing AI chat, conversation history, answer regeneration, and follow-up generation use the configured model. Messages are persisted through the local SQLite chat service.
- Editor AI writer actions (improve writing, grammar, shorten, expand, continue, explain, and custom prompts) use the same backend adapter and preserve writer history.
- Database row summaries and translations use the endpoint through `LocalAIController`. Translation responses are validated against the source cell titles before use.
- Selected document pages, selected database pages exported as CSV, inline page attachments, and Markdown/text attachments are exported and indexed locally. Retrieval ranks text chunks by the query and includes up to eight chunks of 3,000 characters in the prompt. The chat/writer text index requires no embeddings service. Explicitly selected sources and attached text are sent to the user's configured model; this should be an internal endpoint if those sources must remain on the internal network.
- PNG/JPEG/GIF/WebP attachments are sent as OpenAI multimodal image inputs to the configured chat model. The chat model must support vision; a rejected format returns a model/capability error. Attachment files are held in the local source store.
- PDF extraction uses the existing `flowy-ai/file_reader` build feature. Without it, the attachment action reports that a Markdown/text export is needed. Image-only and text-plus-image format controls are available for local and selfhost workspaces. With an image model ID configured, image generation calls the same endpoint's `POST /images/generations` API, accepts base64 or image-URL responses, saves the result locally, and passes it through the existing local image storage helper for editor/chat rendering. Downloads do not carry the API credential and do not follow redirects. An unset image model or unsupported API returns a capability error.
- Whole-workspace AI search reads current local document text through `DocumentManager`, ranks matching excerpts, and generates source-attributed summaries through the configured endpoint. Optionally set an embeddings model ID to use the same endpoint's `POST /embeddings` API for semantic ranking. Document chunks are embedded only during a user-initiated search; vectors are cached locally in memory and refreshed when document text, endpoint, or model changes. Without an embeddings model, text ranking works without any embedding requests. Database CSV sources are supported in chat/writer; whole-workspace search currently scans document pages.

## Local persistence and credentials

Endpoint metadata and encrypted key material are written to `local_ai/openai-endpoint.json` beneath the application's support directory. The backend receives only an `openai+file:` pointer through the existing local-AI settings protobuf. The Windows API key is encrypted using DPAPI, bound to the current Windows account. It is never stored as plaintext in settings, passed in protobuf, or included in log/error output. Copying the encrypted file to another Windows account does not transfer a usable credential.

This credential implementation targets the Windows desktop build. Keyless endpoints can work on other platforms; persisted keyed endpoints require a native credential-store implementation there. The user can replace or remove a saved key in the AI settings form.

Local source text is stored in `ai-sources-<chat-or-page-id>.json` beside the endpoint settings. It stays on disk locally and is used only for requests initiated by the user. Network/model errors do not fall back to AppFlowy servers. Stream cancellation drops the endpoint request, including during connection establishment; writer task entries and native completion ports are cleaned up.

## Integration

`OpenAIEndpointSettingsView()` is the settings entry widget. Existing `LocalSettingsAIView(userProfile:, workspaceId:)` displays it. `ChatServiceMiddleware` handles endpoint inference while the configured local server service handles SQLite message persistence. `SearchDepsResolver::resolve(folder_manager, document_manager, ai_manager)` injects the local document search service; it does not use a vendor search provider. No new protobuf event or global Dart code generation is required.

Direct Dart dependencies are `ffi` and `win32`, already available in the existing package cache. Rust `reqwest` must enable its `stream` feature. The desktop backend must be rebuilt to use the adapter; a precompiled old DLL cannot use these source changes.

## Verification

Focused Rust compilation:

```powershell
$env:RUSTUP_TOOLCHAIN = '1.85.0'
Set-Location D:\Projects\appflowy\frontend\rust-lib
cargo check -p flowy-ai --offline
```

Configuration and Windows credential tests:

```powershell
Set-Location D:\Projects\appflowy\frontend\appflowy_flutter
D:\Tools\flutter\bin\flutter.bat test --no-pub test/ai_endpoint/openai_endpoint_settings_test.dart
```

Nine Flutter tests cover endpoint validation/DPAPI, local generated-image storage migration, exact API prefixes, and refused redirects. The image generation method itself has been exercised with a local HTTP mock using the actual request/storage code: base64 response persistence, URL response validation, unset image-model error, and image downloads without forwarding the credential.

The actual Rust SSE decoder has also been tested with every byte chunk boundary across UTF-8 Hebrew text and CRLF framing, comments, multiline data, malformed JSON, and redacted provider errors. Live inference needs the endpoint/model/credential the user chooses and is intentionally not configured by the agent.

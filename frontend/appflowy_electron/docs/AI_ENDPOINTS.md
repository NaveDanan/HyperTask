# Connect an AI endpoint

1. Open **Settings → AI** and enter the OpenAI-compatible API base URL, including its prefix, such as `http://localhost:8000/v1`.
2. Enter an API key if the endpoint requires one. Leaving the field empty keeps a saved key; use **Remove saved API key** to test or save without it.
3. After you pause typing, HyperTask checks the endpoint's models API. It shows the available model IDs and a searchable **Default chat model** picker. **Refresh models** requests a fresh list.
4. Choose a model, or type its exact ID and click **Use entered model ID**. Turn on the endpoint when you are ready to use it, then click **Save AI settings**. You can also save the configuration while it is disabled. Searching the list alone does not change the selected default.

**Test selected model** sends a small chat request using the selected model. Automatic discovery reads the model list; it does not generate a chat response. An endpoint may list chat, embedding and image models together, so a listed ID is not proof that it supports chat.

If the endpoint does not expose a models API, you can still enter a model ID manually. Authentication failures, missing model APIs, malformed responses and unreachable servers show an error without clearing the selected default. Responses from an old address or API key cannot replace a newer result.

API keys are saved using operating system protection. Windows keeps the existing DPAPI format. Linux and macOS use native secure storage; Linux requires an unlocked libsecret or KWallet keyring. HyperTask refuses a plaintext fallback. Entered keys used for discovery or testing are not saved until you click **Save AI settings**.

The embeddings and image-generation model fields remain separate. Model discovery does not change those settings. Individual chat model choices remain separate from the endpoint default.

## Generate canvas content

Open a document's **Canvas** mode and choose **Canvas AI**. Select **Mind map** or **Presentation**, enter instructions and choose **Generate**. Review the preview, then choose **Add to canvas**. The result becomes ordinary editable canvas elements. **Include page text** and **Include selected canvas labels** start unchecked; select them only for content you want to send.

To generate an image, first save an image-generation model under **Settings → AI**. On the canvas, choose **Generate image**, enter a description and choose **Generate**. When the preview loads, choose **Add image to canvas**. Move or resize it and edit its description from the canvas properties. This uses the separate image model, rather than the default chat model.

Closing a generation dialog stops its request. If included content or editing permissions change before you add the result, generate again using the current content. Exported canvas images are embedded in SVG/PNG and document exports; missing image files report an error. For Markdown document exports, keep the companion files beside the page.

## Maintainer checks

Discovery, credential handling and selected-model tests run in Electron's main process. Credentials never enter URLs or command arguments; redirects and unsafe pagination are rejected. Settings keep their existing file path and JSON fields, and writes replace the file atomically.

Focused verification includes debouncing and stale results, all returned model pages, default selection and persistence, empty/error/manual flows, credential overrides, atomic writes and a native Electron settings interaction test. The credential suites also cover native secure-storage wrapping and Rust envelope decryption using disposable data and dummy credentials. Real provider, TLS policy and model capabilities still depend on the configured endpoint.

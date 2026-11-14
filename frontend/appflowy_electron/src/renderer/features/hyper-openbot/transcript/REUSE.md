# Transcript source reuse

Pinned source: `/home/naved/HyperTask-OpenBot-baseline`, commit
`f8af37ab73e96784f174a11104505a965e722cab`.
Copyright (c) 2026 CopilotKit. The complete upstream MIT license is in `LICENSE`.
HyperTask adaptations preserve the protocol identifiers passed in through props.

| Local file | Exact upstream file | Reused behavior |
| --- | --- | --- |
| `citations.tsx` | `app/src/lib/markdown.tsx` | Document host/type recognition and citation chips; Tabler icons replaced with existing Lucide icons. |
| `paced-reveal.ts` | `app/src/components/channels/paced-reveal.ts` | Word-boundary pacing, tail settling, catch-up timing and stalled-frame fallback. Motion preference uses native matchMedia. |
| `HyperMarkdown.tsx` | `app/src/lib/markdown.tsx` | Reply single-line breaks, safe external links and code rendering contract. Original Streamdown runtime and code plugin preserve CommonMark and syntax highlighting. |
| `HyperTranscript.tsx` | `app/src/components/channels/tool-line.tsx` | Expandable native details and distinct running, refused, failed, not-yet and person-completed states. |
| `HyperTranscript.tsx` | `app/src/components/channels/chat-transcript.tsx` | User/reply rendering, restoring skeleton, thinking/working and stopped states. API/SDK access replaced by data and render callbacks. |
| `HyperTranscript.tsx` | `app/src/components/channels/follow-intent.tsx` | Follow-latest threshold and pause while selecting text; adapted to native overflow container and ResizeObserver. |

`index.ts` and `transcript.test.tsx` are new integration exports and focused tests.

## Integration

Import from this directory's `index.ts`. Supply ordered messages with stable IDs.
Set `live` only for newly received messages, and `streaming` while their text is arriving.
Keep `busy` true for the running turn; supply `stopped` only with a real failure reason.
`onOpenLink` overrides anchor navigation for the desktop host. `renderTool` supplies API-backed
approval or custom result cards. No networking or model execution happens in these components.

The Markdown renderer uses the pinned Streamdown runtime and code plugin for prose,
tables, task lists and highlighted code. Image components render inert alt text; passive
resource URL properties are stripped and HTML skipping is enabled. Assistant and tool-result
images cannot initiate automatic requests. Citations retain explicit user navigation.
Regressions exercise the real renderer, including image preload output, raw HTML and
remote/loopback/relative/data image sources. Tool arguments remain literal text, including
incomplete streamed JSON.

UI uses existing Button/Skeleton primitives, Lucide icons and theme tokens. The local
collapsible result panel follows the upstream tool-line behavior. No shell/theme changes.

# Transcript source reuse

Pinned source: `/home/naved/HyperTask-OpenBot-baseline`, commit
`f8af37ab73e96784f174a11104505a965e722cab`.
Copyright (c) 2026 CopilotKit. The complete upstream MIT license is in `LICENSE`.
HyperTask adaptations preserve the protocol identifiers passed in through props.

| Local file | Exact upstream file | Reused behavior |
| --- | --- | --- |
| `citations.tsx` | `app/src/lib/markdown.tsx` | Document host/type recognition and citation chips; Tabler icons replaced with existing Lucide icons. |
| `paced-reveal.ts` | `app/src/components/channels/paced-reveal.ts` | Word-boundary pacing, tail settling, catch-up timing and stalled-frame fallback. Motion preference uses native matchMedia. |
| `HyperMarkdown.tsx` | `app/src/lib/markdown.tsx` | Reply single-line breaks, safe external links and code rendering contract. Local React parser replaces unavailable Streamdown dependencies. |
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

The local Markdown renderer supports paragraphs, headings, emphasis, inline/fenced code,
links, quotes, flat lists, task checkboxes and pipe tables. Raw HTML is escaped. It does not
implement full CommonMark, reference links, nested list indentation, syntax highlighting or
Streamdown plugins. Images remain literal Markdown to avoid fetching remote model-generated
URLs. Tool arguments remain literal text, including incomplete streamed JSON.

UI uses existing Button/Skeleton primitives, Lucide icons and theme tokens. The local
collapsible result panel follows the upstream tool-line behavior. No shell/theme changes.

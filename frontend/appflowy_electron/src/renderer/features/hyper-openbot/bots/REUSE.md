# Source and integration

Adapted from OpenBot by CopilotKit, MIT licensed. Original source is pinned at
`/home/naved/HyperTask-OpenBot-baseline`, commit `f8af37ab73e96784f174a11104505a965e722cab`.
Preserve the upstream copyright and license in `../LICENSE`.

References: `app/src/lib/agents/{queries,mutations}.ts`,
`app/src/lib/api/served-today.ts`, `app/src/components/bot-profile/{profile,setup,manage}.tsx`,
and `server/src/agents/lifecycle-routes.ts`.

Import `HyperBotsPanel` from `./bots` and render with `onChat(botId)` to open the existing
chat flow. No provider props are required. The panel uses the shared `../transport` and existing
session, lists visible or hidden Bots, creates native Bots, edits manageable profiles, updates
personal pause and notification settings, pins/hides/restores, previews personal reset counts before a confirmed reset, and deletes with confirmation.
Server-derived `canManage`, `assignedToMe` and built-in capability govern controls.

The design document has no Bot-specific layout. This uses its token-based cards, form fields,
header and two-column list/detail pattern. Native select and checkbox controls provide accessible
choices without introducing dependencies. Remote endpoint credentials and account authorization
are intentionally absent from this native creation flow.

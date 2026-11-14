# OpenBot source reuse

Pinned source: `/home/naved/HyperTask-OpenBot-baseline`, commit `f8af37ab73e96784f174a11104505a965e722cab`.

| Local export | Exact upstream files |
| --- | --- |
| HyperConversationsScreen | app/src/components/channels/conversation-actions.tsx; app/src/components/channels/delete-conversation-dialog.tsx; app/src/components/app-sidebar/channel-pagination.tsx |
| HyperConversationTitle | app/src/lib/channels/label.ts; shared/conversation-title.ts |
| HyperBotRosterScreen | app/src/components/bots/bot-roster.tsx |
| HyperGroupRoster | app/src/lib/agents/roster.ts |
| HyperBotProfileScreen | app/src/components/bot-profile/profile.tsx |
| HyperSkillsScreen | app/src/components/manage/skills-page.tsx; app/src/lib/agents/grant-roster.ts |
| HyperGrantSummary | app/src/lib/agents/grant-summary.ts |
| HyperConnectionsScreen | app/src/routes/_authed/_app/connections.index.tsx |
| HyperSortConnections, HyperConnection | app/src/lib/connections/rows.ts |

Implementations live in HyperScreens.tsx and HyperScreenModels.ts. Tests and index.ts are new integration code.

Adaptation replaces router/query/mutation dependencies with data and callback props and uses HyperTask UI controls and theme tokens. The caller supplies API-derived rows, authorization results, hidden holder Bots, and profile content. Connections retain upstream state/action identifiers. Pagination is explicit rather than intersection-driven. Profile notification permission handling belongs to the integration caller. Bot attention/activity/settings/manage content is supplied through slots. Conversation deletion awaits the caller, which must leave the active conversation before deleting. Pin pending state is controlled by pendingId. The list filters loaded conversations only. No backend behavior, API implementations, or seeded data are included.

Native notification select uses existing token styles; no custom select implementation or global styles are added.

## Upstream license

MIT License

Copyright (c) 2026 CopilotKit

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

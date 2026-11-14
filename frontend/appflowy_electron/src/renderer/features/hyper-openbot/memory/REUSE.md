# Native memory and learning

Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. Upstream revision f8af37ab73e96784f174a11104505a965e722cab. The repository's upstream license notices remain authoritative.

| Local file | Upstream source |
| --- | --- |
| HyperMemoryApi.ts | app/src/lib/memory.ts |
| HyperMemorySection.tsx | app/src/routes/_authed/_app/memory.tsx; app/src/components/memory/memories.tsx; app/src/components/memory/sources.tsx; app/src/routes/_authed/_app/bots.$agentId.memory.tsx |
| HyperLearningSection.tsx | app/src/routes/_authed/admin/learning.tsx; app/src/components/admin/controls/people-learning.tsx; app/src/components/settings/learning-sharing.tsx; app/src/components/settings/learning-review.tsx; app/src/components/learning/proposal-dialog.tsx; app/src/components/learning/learned-skill-dialog.tsx; app/src/components/learning/skill-files.tsx |
| HyperPersonalLearningSection.tsx | app/src/routes/_authed/settings/learning.tsx |
| HyperLearningConfiguration.tsx | app/src/routes/_authed/admin/learning.tsx |
| HyperLearningQueries.ts | app/src/lib/learning/queries.ts |
| HyperLearningMutations.ts | app/src/lib/learning/mutations.ts |
| HyperLearningTypes.ts | shared/learning.ts |
| HyperMemoryClient.ts; HyperQueryOptions.ts; index.ts | Native transport adapter, option descriptors, exports |
| HyperMemoryApi.test.ts | Native mocked transport contract tests |

Settings memory and capabilities memory upstream routes redirect to memory, represented by the same native section. Personal learning has its own personal navigation entry. Remote skill files and evidence render as inert text.

Remaining parity gaps: enterprise capability preview/batch permission editing from lib/capability-changes and admin skill-sharing controls; automatic container entitlement/create-state presentation; bot delivery detail presentation; upstream custom schema object input handling for app sources; rich evidence presentation and recording navigation. These need additional work; existing query descriptors alone do not constitute UI parity. Bot selection currently uses an ID input. No live backend or Electron validation was performed.

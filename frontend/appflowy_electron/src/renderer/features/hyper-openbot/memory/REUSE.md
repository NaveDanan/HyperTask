# Native memory and learning

Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. Upstream revision f8af37ab73e96784f174a11104505a965e722cab. Full license: ../LICENSE. HyperTask was developed by NaveDanan.

All upstream paths below are relative to the pinned checkout.

| Local file | Exact upstream source |
| --- | --- |
| HyperMemoryApi.ts | app/src/lib/memory.ts |
| HyperMemorySection.tsx | app/src/routes/_authed/_app/memory.tsx; app/src/components/memory/memories.tsx; app/src/components/memory/sources.tsx; app/src/routes/_authed/_app/bots.$agentId.memory.tsx |
| HyperLearningSection.tsx | app/src/routes/_authed/admin/learning.tsx; app/src/components/admin/controls/people-learning.tsx |
| HyperPersonalLearningSection.tsx | app/src/components/settings/learning-sharing.tsx; app/src/components/settings/learning-review.tsx; app/src/routes/_authed/settings/learning.tsx; app/src/components/skills/skills-settings-page.tsx |
| HyperLearningConfiguration.tsx | app/src/routes/_authed/admin/learning.tsx |
| HyperLearningDetail.tsx | app/src/components/learning/proposal-dialog.tsx; app/src/components/learning/learned-skill-dialog.tsx; app/src/components/learning/skill-files.tsx |
| HyperSharingRequests.tsx | app/src/components/admin/controls/people-learning.tsx |
| HyperLearningPermissions.tsx | app/src/components/admin/controls/skill-sharing-section.tsx; app/src/lib/capability-changes/queries.ts; app/src/lib/capability-changes/mutations.ts; app/src/lib/capability-changes/translate.ts |
| HyperCapabilityTranslate.ts | app/src/lib/capability-changes/translate.ts |
| HyperCapabilityQueries.ts | app/src/lib/capability-changes/queries.ts |
| HyperCapabilityMutations.ts | app/src/lib/capability-changes/mutations.ts |
| HyperCapabilityTypes.ts | app/src/lib/enterprise/queries.ts |
| HyperLearningActions.ts | app/src/routes/_authed/admin/learning.tsx; app/src/components/admin/controls/people-learning.tsx; app/src/components/memory/sources.tsx |
| HyperLearningRecordings.tsx | app/src/components/learning/learned-skill-dialog.tsx; app/src/lib/recorder/queries.ts; shared/recorder-api.ts |
| HyperLearningDisplay.ts | app/src/lib/learning/display.ts |
| HyperLearningQueries.ts | app/src/lib/learning/queries.ts |
| HyperLearningMutations.ts | app/src/lib/learning/mutations.ts |
| HyperLearningTypes.ts | shared/learning.ts |
| HyperMemoryClient.ts; HyperQueryOptions.ts; index.ts | Native transport adapter, option descriptors, exports |
| HyperMemoryApi.test.ts; HyperLearningActions.test.ts; HyperLearningDetail.test.tsx | Native mocked transport and renderer regression tests |

## Native destinations and behavior

- Memory adapts the facts page: create, edit, confirm, pause/resume and forget; provenance, Bot names, source links and observed timestamps; Intelligence-held memories omit pause/review. The personal edition offers the Bots destination without querying memory.
- HyperBotMemoryTab({ agentId }) adapts a Bot's Memory tab. It filters sources to that Bot, lists source action, sync status/time and failures, enables/disables, syncs and removes. Source creation uses server-provided schema fields, required fields, enums, booleans, finite numbers and newline arrays. Upstream refuses entered object settings; this port does the same. Object input support was not an upstream behavior.
- The personal-learning destination contains learned skill sharing/review, written skills by reusing ../skills/HyperSkillsPanel, and Teach a Bot navigation. The existing Skills area owns written skill CRUD and grants. This area imports that component without modifying its files.
- Personal review groups recording/conversation containers by label, starts every available container in a group, disables starts while running, exposes automatic approval and model problems, reviews only pending proposals when permitted, and refreshes published skills after decisions or automatic approvals.
- Admin Learning includes default and per-Bot container/revision settings, inheritance/exclusion, visible and hidden Bot roster, automatic assignment/entitlement/off/unavailable/missing states, and credential-free server container creation when offered. Participation writes omit personalReview and autoApprove; who approves is saved independently.
- Admin review covers default/Bot proposals, run history/status/times/counts/failure codes, published skill files, people review and sharing requests. Delivery reports configured/initialized/stale, revision, last check and retryable failures. Backend dashboard links accept only HTTP(S) without embedded credentials.
- Skill details show inert SKILL.md/other files, binary markers, insights, cited conversation messages and recording events, unavailable evidence and recording provenance. Available provenance opens a local paginated Your recordings view without opening or starting the browser. The caller may supply onOpenRecordings instead.
- Sharing decisions require a successfully loaded skill tied to the current request timestamp. A conflict reloads requests; a changed timestamp remounts and reloads the skill before another decision. Removed requests cannot be decided.
- Skill sharing uses the upstream enterprise setting. Capability editing supports organization/role/group scopes, inheritance, description translation, server validation, affected-person/activity preview and atomic batch save with optional English authoring provenance. Editing a draft invalidates its preview.

Settings Memory and Capabilities Memory upstream redirects use Memory. Settings Learning, Capabilities index and Capabilities Skills lead to the native learned/written Skills destination. Native sections replace router redirects; no upstream shell or global CSS is imported.

All reads and mutations use ../transport, including reused written skills. Loading, empty, error/refusal and retry states are local to their sections. Remote skill/evidence text stays inert. Raw transport errors are not echoed, and no credentials are persisted in the renderer.

## Integration and verification

Shared edits are confined to the memory registry slot, memory allowlist slot and appended memory test blocks. Parent b770796 is merged, retaining its async conversation/navigation contracts and security/upload guards. No other feature folder is modified by memory implementation commits.

Exports include HyperBotMemoryTab, HyperMemorySection, HyperMemorySkillsSection, HyperPersonalLearningSection, HyperLearningSection, HyperLearningDetail, HyperLearningProposals, HyperLearningPermissions, HyperLearningHealth and HyperLearningRecordings, plus upstream-compatible query/mutation descriptors.

No known assigned implementation dependency remains. Visuals use existing UI components and token-based bordered sections; file bodies use inert readable text rather than upstream Markdown rendering. No live backend, Electron launch or real credentials were used. Typecheck, focused tests, full tests and production build run with Node 24.18.1 and locked dependencies. Acceptance against a live deployment remains outside this task's authorization.

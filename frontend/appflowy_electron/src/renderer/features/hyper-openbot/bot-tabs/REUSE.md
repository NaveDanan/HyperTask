# Source and integration

Adapted from OpenBot by CopilotKit, MIT, Copyright (c) 2026 CopilotKit.
Read-only source `/home/naved/HyperTask-OpenBot-baseline`, pinned at
`f8af37ab73e96784f174a11104505a965e722cab`. Preserve `../LICENSE`.

| Local file | Upstream source |
| --- | --- |
| HyperBotTabsApi.ts | app/src/lib/app-access/{queries,mutations}.ts; app/src/lib/team-bots.ts |
| HyperBotDetailTabs.tsx | app/src/components/bot-profile/{access,sharing}.tsx; app/src/routes/_authed/_app/bots.$agentId.{access,apps,sharing}.tsx |
| HyperBotHandoffTab.tsx | app/src/lib/agents/{queries,mutations}.ts handoff contracts |
| HyperBotApprovalsTab.tsx | app/src/components/approvals/bot-rules.tsx; app/src/lib/approvals.ts; app/src/routes/_authed/_app/bots.$agentId.approvals.tsx |
| HyperBotSkillsTab.tsx | app/src/components/bot-profile/access.tsx YourSkills/Granted; app/src/lib/plugins/{queries,mutations}.ts; app/src/routes/_authed/_app/bots.$agentId.skills.tsx |
| HyperReachability.tsx | app/src/components/delivery/reaching-you.tsx; app/src/lib/delivery.ts; app/src/routes/_authed/_app/{reachability,bots.$agentId.reach}.tsx |
| HyperExternalAgents.tsx | app/src/components/agents/new-bot-sheet.tsx; app/src/lib/agents/{form,queries,mutations}.ts; app/src/routes/_authed/_app/agents/index.tsx |
| HyperBotActivityTab.tsx | app/src/components/bot-profile/activity.tsx; app/src/lib/bot-lifecycle/{queries,mutations}.ts; app/src/routes/_authed/_app/bots.$agentId.activity.tsx |
| HyperBotExtraTabs.ts | Native typed extension registry for four separately owned tabs |
| HyperBotResource.ts | Native load/mutation lifecycle helper replacing upstream query invalidation |
| index.ts | Native exports |
| HyperBotTabsApi.test.ts, HyperBotDetailTabs.test.tsx | Native regression tests |

Native token cards, form fields and local detail navigation replace the upstream router,
page shell and theme. All requests use the main-owned transport. Mutations reload server state,
including after failure. Personal approval patterns preserve upstream glob semantics; team rules
remain locked. Skill switches use the authenticated user's ownership and only appear on own Bots.
Reachability polls at ten seconds, reads every channel page, connects Slack/Teams or verifies SMS,
and disconnects destinations. Personal reachability additionally removes push devices and shows
recent delivery statuses. Verification and link values stay in component memory, without the
upstream sessionStorage persistence, to satisfy the renderer credential constraint.

The existing Bots panel mounts these tabs, preserves Chat and lifecycle/reset controls, sorts
assigned/pinned Bots first then own/shared Bots and reports search misses. Existing profile forms
remain above the detail tabs. No dependencies added. The node_modules symlink is local tooling only.

Remaining parity gaps: upstream attention board and proactive activity summaries; activity links
without a conversation and channel opening from the existing Bots host; group assignment management,
shared-app exposure notices and share-link copy; administrator app grant authoring/replay and app
connection initiation; external framework selection; advanced isolation setup and Bot duplication.
Callback token issue/display is excluded because the task forbids provider tokens in the renderer.
Standalone bot deep links and route history are replaced by selection within the native Bots view.
These gaps are explicit and must not be reported as full feature parity.

Exports: HyperBotDetailTabs, HYPER_BOT_EXTRA_TABS / HyperBotExtraTab, HyperBotTabsApi.
The four extra-tab slots accept a component receiving `{ agentId: string }`.

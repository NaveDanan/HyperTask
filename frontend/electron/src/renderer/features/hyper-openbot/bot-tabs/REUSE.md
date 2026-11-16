# Source and integration

Adapted from OpenBot by CopilotKit, MIT, Copyright (c) 2026 CopilotKit.
Read-only source `/home/naved/HyperTask-OpenBot-baseline`, pinned at
`f8af37ab73e96784f174a11104505a965e722cab`. Preserve `../LICENSE`.

| Local file | Exact upstream sources |
| --- | --- |
| HyperBotTabsApi.ts | app/src/lib/app-access/{queries,mutations}.ts; app/src/lib/team-bots.ts |
| HyperBotDetailTabs.tsx | app/src/components/bot-profile/{access,sharing}.tsx; app/src/routes/_authed/_app/bots.$agentId.{access,apps,sharing}.tsx |
| HyperBotHandoffTab.tsx | app/src/components/agents/handoff-panel.tsx; app/src/lib/agents/{queries,mutations}.ts |
| HyperBotApprovalsTab.tsx | app/src/components/approvals/{bot-rules,rules}.tsx; app/src/lib/approvals.ts; app/src/routes/_authed/_app/bots.$agentId.approvals.tsx |
| HyperBotSkillsTab.tsx | app/src/components/bot-profile/access.tsx YourSkills/Granted; app/src/lib/plugins/{queries,mutations}.ts; app/src/routes/_authed/_app/bots.$agentId.skills.tsx |
| HyperReachability.tsx | app/src/components/delivery/reaching-you.tsx; app/src/lib/delivery.ts; app/src/routes/_authed/_app/{reachability,bots.$agentId.reach}.tsx |
| HyperExternalAgents.tsx | app/src/components/agents/new-bot-sheet.tsx; app/src/lib/agents/{form,queries,mutations,legacy-routes}.ts; app/src/routes/_authed/_app/agents/index.tsx |
| HyperBotActivityTab.tsx | app/src/components/bot-profile/activity.tsx; app/src/lib/bot-lifecycle/{queries,mutations}.ts; app/src/routes/_authed/_app/bots.$agentId.activity.tsx |
| HyperBotSetupTab.tsx | app/src/components/bot-profile/setup.tsx; app/src/components/agents/callback-token-panel.tsx; app/src/lib/agents/form.ts; app/src/lib/enterprise/queries.ts; app/src/routes/_authed/_app/bots.$agentId.setup.tsx |
| HyperBotAppGrants.tsx | app/src/components/manage/describe-grants.tsx; app/src/components/plugins/grant-list.tsx; app/src/lib/app-grants/{queries,mutations,translate}.ts; app/src/components/plugins/shared-approval-fields.tsx |
| HyperSharedAppNotice.tsx | app/src/components/plugins/shared-app-notice.tsx; app/src/lib/plugins/shared-use.ts |
| HyperBotAttentionBoard.tsx | app/src/components/needs-you/{board,needs-you}.tsx; app/src/components/approvals/waiting.tsx; app/src/components/bot-profile/attention.tsx; app/src/lib/{approvals,proactive}.ts; app/src/lib/tasks/{queries,mutations}.ts |
| HyperBotSection.tsx | app/src/routes/_authed/_app/{bot,bots.$agentId.index}.tsx; app/src/lib/agents/default-agent.ts |
| HyperBotWorkflowApi.ts | app/src/lib/delivery.ts; app/src/lib/agents/{form,queries,mutations}.ts; app/src/lib/app-grants/{queries,mutations,translate}.ts |
| HyperHarnesses.ts | shared/harnesses.json, webCreate entries only |
| HyperBotExtraTabs.ts | Native typed extension registry for four separately owned tabs |
| HyperBotResource.ts | Native load/mutation lifecycle helper replacing query invalidation |
| index.ts | Native exports |
| HyperBotTabsApi.test.ts; HyperBotDetailTabs.test.tsx; HyperBotParityStates.test.tsx; HyperBotWorkflowApi.test.ts; HyperBotActivitySummary.test.ts | Native mocked transport, permission, payload, summary and initial-state regression tests |

Native token cards, form fields and local detail navigation replace the upstream router,
page shell and theme. No upstream shell, global CSS or router is imported. No dependencies added.
All requests use the main-owned transport. Writes refetch server state even after failure;
stale reads cannot overwrite a mutation refresh, and refused reads discard old permissions.

# Behavior coverage

- Bots roster preserves Chat, search, hidden/restore, assignment/pin priority, create, edit,
  delete confirmation and reset preview/confirmation. Duplicate works for visible shared Bots
  as upstream permits. Creation gives selected owner-grantable apps independently after success;
  a failed app grant does not recreate or discard the Bot. The Bot page opens the deployment's
  preferred `picked-harness`, otherwise its first Bot, with explicit ID lookup and refusal states.
- Setup retains profile/name/title/description/instructions editing above its tabs. Team-only
  visibility/isolation obey deployment, member, system-owned and management verdicts. Turning
  isolation off remains available when enabling is no longer allowed. Personal editions omit
  per-Bot isolation and handoff controls. External agents validate/test URLs, select upstream
  framework IDs, preserve an existing key on blank edits, and support confirmed deletion.
- Apps reads server states, owner give/take-back, request/withdraw and administrator approve.
  Personal editions omit per-Bot owner switches. Account connection uses the existing native
  Connections panel. Administrator action editing supports manual selection, English translation,
  independent explanation, other-app notices, replay/check/warnings, explicit add/remove,
  authoring and shared audience approval. Shared audiences use the server-proposed existing
  members and can be narrowed, as upstream; arbitrary new members cannot be entered. Manual
  switches write immediately through plugin grants; the Routines app stays always on. No write
  occurs at translate/replay time.
- Skills filters editable own skills using `/api/me`; held skills remain visible on shared Bots.
- Sharing publishes team or people/groups audiences, updates/unpublishes, assigns/unassigns groups
  for admins, and shows shared-account exposure/refusal/request states before publishing and on
  manageable profiles. Copy link uses `/api/plugins`' redirectUri public origin because a native
  renderer has no shareable origin. Server `plugins/route-groups/servers.ts` derives that URI from
  publicUrl via `plugins/oauth.ts:redirectUriFor`. Missing public URL gives an explicit unavailable
  state. Clipboard failure is reported without exposing remote content.
- Approval rules preserve Bot glob semantics, personal rules, locked team rules, custom-rule
  refusal, add/update/revoke and exact behaviour enum values. The attention board groups Bots,
  shows independently failing sources, renders approval argument details through the existing
  inbox presentation, answers/dismisses questions, makes permitted decisions, reviews/reopens/
  retries tasks, and starts/hides check-in findings. It creates no global reply/mark subscription.
- Activity shows a three-item profile glance, in-progress/scheduled/completed lists, authoritative
  Stop/Cancel, conversation links, the Bot's action trail through the existing native Activity
  component, and routine counts without double-counting goal starts. On-demand goals belong to
  Routines. Routines/detail links select the owner-supplied tab.
- Reachability supports paged active-conversation selection, explicit Bot selection, deployment availability, Slack/Teams link
  commands retained per platform, copy and expiry, SMS start/confirm, STOP status and disconnect. Personal reachability also
  removes push devices and shows delivery states. Link/challenge values stay in component memory
  instead of upstream sessionStorage to satisfy the renderer credential constraints.

# Integration and security constraints

The route slot calls `team-bots`, `me`, `delivery`, `tasks`, `proactive/suggestions` and `routines`.
Existing base families cover agents/bots/plugins/approvals/capabilities; parent slots already cover
proactive/settings and audit. Family boundaries and canonical path/traversal guards are preserved.
Parent merges retain voice security fixes, memory, computer and navigation. Memory and Computer
are wired. Routines and Responsibilities slots remain reserved for their owners and lead integration.
The named parent exposes roster `onComputer` and the shared `hyperOpenBotComputer` destination;
that callback is preserved. The Bot section also prefers optional context.openBotComputer when
supplied, otherwise uses the same shared destination helper. It opens existing conversations through
section context. No shared main-process or transport edits were made by this area.

Callback key status and revocation are supported. Creation/rotation and showing the one-time token
are blocked by the task's explicit prohibition on tokens in the renderer. Upstream returns the token
in the POST response and displays it. Supporting that requires a lead-owned main-process credential
handoff, outside this folder's ownership. This port does not call or cache that endpoint or claim
that workflow complete. The original Bot chat route uses HyperTask's existing conversation/runtime/
computer implementation, owned by the Conversations specialist; no second chat runtime is installed.

Exports in index.ts include the detail tabs, workflow API, typed extra-tab registry, reachability,
activity, approvals, skills, setup and external-agent components. HyperBotEditor is additionally
exported from bots/HyperBotsPanel.tsx for the context-aware Bot page.

# Resumed validation checkpoint

The resumed worktree was clean. The earlier commits already implement the assigned
reachability, approvals, skills, external-agent and roster workflows described above.
This pass preserves account and Bot-pattern qualifiers on approval rows, restores the
upstream wildcard defaults for effect/target, clears a successfully saved rule draft,
and locks external-agent fields during connection verification and writes. The scope
qualifiers have a regression case in HyperBotParityStates.test.tsx.

Validation after these changes: `npm run typecheck`, `npm test` and `npm run build`
passed. Vitest reports 113 passing files, 840 passing tests, two skipped files and five
skipped tests. The build retains the existing launcher dynamic-import warning. No live
backend or Electron session was used. No new route families, shared-file edits,
dependencies or exports were needed. The callback-token creation and owner-supplied
Routines/Responsibilities integration limitations above remain explicit.

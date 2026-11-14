# Settings reuse

Source: OpenBot, pinned f8af37ab73e96784f174a11104505a965e722cab. MIT, Copyright (c) 2026 CopilotKit. See LICENSE.

| Local file | Exact upstream sources | Adaptation |
| --- | --- | --- |
| HyperSettingsApi.ts | app/src/lib/settings/queries.ts, mutations.ts, message-list.ts; app/src/lib/auth/queries.ts, mutations.ts; app/src/lib/edition-guard.ts | Main-owned transport; named response fields; validation; refresh identity after profile save; server-authoritative instructions/preferences; edition failure defaults to team. |
| HyperSettingsSection.tsx | app/src/routes/_authed/settings/index.tsx, route.tsx; app/src/components/settings/profile.tsx, standing-instructions.tsx, message-list-preference.tsx, settings-sidebar.tsx | Native HyperTask card rows and dialogs; loading, retry, error, empty, pending and saved states; character count; explicit clearing; preference preview. No upstream shell, theme, CSS or desktop bridge. |
| index.ts | No upstream equivalent | Public native exports. |
| HyperSettings.test.tsx | No copied tests | Mocked transport contract tests and static native UI states. |

Verified settings and profile mounts in server/src/app.ts, including /api/settings/instructions, /api/settings/preferences and /api/me/profile. Allowlist families are settings and me. Existing capabilities family serves edition discovery. No dependencies added. No telemetry initialized or enabled. All user content renders as text.

## Resumed settings implementation

| Local file | Exact upstream sources | Native behavior |
| --- | --- | --- |
| HyperSettingsAutomation.tsx | app/src/components/settings/check-ins.tsx, github-sources.tsx; app/src/lib/proactive.ts, responsibilities.ts | Admin-disabled check-ins, single-field preference updates, 30-second permission refresh; repository list, empty/loading/error/retry, create with memory-only secret and generic errors, disconnect and server refresh. Webhook path is relative to the remote OpenBot server, never the renderer origin. |
| HyperActivityApi.ts | app/src/lib/audit/queries.ts; app/src/lib/agents/queries.ts; app/src/components/manage/audit-page.tsx | Saved-view exclusions, Bot scope, cursors, CSV with truncation header, paged visible/hidden Bot roster and skill titles. |
| HyperPersonalActivity.tsx | app/src/routes/_authed/settings/_personal/activity.tsx; app/src/components/manage/audit-page.tsx; app/src/components/audit/audit-table.tsx | Personal-only in-section Activity, saved views, local search, multi-select outcome/Bot/initiator facets, time sort, refresh, older-page retry, export and cap warning. Ask, vocabulary chips and Why are upstream Admin-only and are deliberately absent. Stale older-page results cannot contaminate another view. |
| HyperSettingsNavigation.ts | app/src/components/settings/settings-sidebar.tsx; app/src/lib/manage-paths.ts; app/src/routes/_authed/settings/skills.tsx, _personal.tsx, _personal/plugins.$.tsx, _personal/skills_.new.tsx, _personal/skills_.$slug.tsx | Exported IDs and resolver preserve new/slug/app/tool/broker-directory intent, guard personal routes, and retain Activity bot query. |
| HyperSettingsEdition.tsx | app/src/components/edition/for-a-team.tsx, team-features-dialog.tsx, business-link.tsx, brand-name.tsx | Edition loading/refusal view, personal business offer and feature groups, session component dismissal, upstream browser booking fallback. |
| HyperSettingsAppearance.tsx | app/src/routes/_authed/settings/index.tsx; app/src/skins/skin-picker.tsx | Uses HyperTask's existing persisted native dark/light action. Saves upstream skin preference for the web client without importing the upstream shell or themes. |
| HyperActivity.test.tsx | No copied tests | Mocked transport pagination, exclusions, export/refusal/truncation, roster fallback, outcome/deduplication and legacy destination tests. |

The adapted audit cells and pure protocol/wording helpers below preserve upstream logic. No model-generated HTML is executed.

- `HyperActivityCells.tsx`: `app/src/components/audit/audit-cells.tsx`.
- `HyperActivityOutcome.ts`: `app/src/lib/audit/outcome.ts`.
- `HyperActivityRows.ts`: `shared/activity-rows.ts`.
- `HyperActivitySilence.ts`: `app/src/lib/audit/silence.ts`.
- `HyperApprovalOutcomes.ts`: `shared/approval-outcomes.ts`.
- `HyperAuditWords.ts`: `shared/audit-words.ts`.
- `HyperCheckInOffer.ts`: `shared/check-in-offer.ts`.
- `HyperConnectPrompt.ts`: `shared/connect-prompt.ts`.
- `HyperOpenbotActor.ts`: `shared/openbot-actor.ts`.
- `HyperResearch.ts`: `shared/research.ts`.
- `HyperSubagent.ts`: `shared/subagent.ts`.
- `HyperToolName.ts`: `shared/tool-name.ts`.
- `HyperToolNameWords.ts`: `shared/tool-name-words.ts`.
- `HyperToolSearch.ts`: `shared/tool-search.ts`.

## Integration dependencies and deliberate platform adaptations

Parent must supply `context.navigate(sectionId, { path })` for destination buttons and legacy forwarding. `HYPER_SETTINGS_DESTINATION_IDS`, `hyperSettingsDestination` and `HyperSettingsContext` are public exports. `HyperSettingsSection` accepts optional `path` to preserve legacy route and Activity Bot intent. Without navigate, destination buttons are disabled. Registered section IDs are the original allocated slot IDs; parent owns final registration and routing.

Excluded screens remain owned by their specialists: notifications/approvals → approvals-inbox, vault/passwords/credentials/accounts → vault, computer/browsers/this-computer → computer-browser, memory/learning → memory, setup → onboarding, gallery → screens, skills → skills, apps → connections. This folder supplies destinations, not duplicate implementations.

OpenBot Desktop AI-provider and usage-data bridge controls are correctly absent for the remote backend, matching upstream's null desktop bridge. No telemetry is initialized or enabled. Product-result telemetry has no settings UI and was not ported.

No upstream shell, router, global CSS, skins or theme is loaded. The native theme switch uses HyperTask's theme store; web skin changes persist to the remote account only. Message emphasis persists/previews here; conversation-list consumption is parent-owned. Keyboard bindings remain HyperTask-owned; upstream Shift+N listeners were not installed by settings. The audit component catalogue lookup falls back to upstream humanised names rather than importing the upstream gallery runtime.

The existing Electron CSP blocks third-party calendar frames. The edition dialog retains the exact upstream browser fallback https://open.bot/business; the embedded Calendly calendar and decorative branding/orb are not loaded. CSP and webPreferences are unchanged. Offer dismissal is component-session memory rather than upstream sessionStorage.

Allowlist settings slot now contains settings, me, proactive/settings, responsibilities/sources/github, admin/audit-events and v2/organizations/default/bots. Existing plugins and capabilities families supply titles and edition. These paths were checked against server/src/app.ts, server/src/proactive/routes.ts, server/src/responsibilities/routes.ts and app/src/lib/api/generated/bots/bots.ts. No unrelated shared source files were edited.

## Validation

On the settings branch, using the authorized shared locked node_modules: npm run typecheck passed; focused settings/policy tests passed, 18 tests across 3 files; full npm test passed, 582 passed and 5 skipped across 78 files; npm run build passed. Build emitted existing bundle/dynamic-import warnings. No live backend, Electron app, external calendar or real credentials were used. Self-review checked transport contracts, personal edition gating, encoded cursors, stale-page protection, inert cells, secret error redaction and destination guards. Integration navigation and conversation preference consumption require parent wiring and were not exercised here.

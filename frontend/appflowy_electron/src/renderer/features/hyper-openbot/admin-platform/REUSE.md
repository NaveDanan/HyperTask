# Hyper admin platform

Source: OpenBot f8af37ab73e96784f174a11104505a965e722cab, Copyright (c) 2026 CopilotKit, MIT. Full notice in ../LICENSE. HyperTask developed by NaveDanan. Upstream checkout remains unchanged.

## Mapping

- HyperCredentialsSection.tsx and HyperPlatformApi.ts: app/src/routes/_authed/admin/credentials.tsx and credentials_.new.tsx. Uses parent vault/HyperKeyForm for ephemeral entry, provider compatibility, active-key replacement warning and server-owned key names. Revocation is confirmed.
- HyperProvidersSection.tsx and HyperPlatformApi.ts: app/src/routes/_authed/admin/providers.tsx, app/src/components/admin/controls/model-sections.tsx, app/src/lib/models/queries.ts and app/src/lib/enterprise/{queries,mutations}.ts. Catalogue, source/default/efforts, team allowlist switch, search and extra provider/model names, 30-day usage and independent error states. `/api/model-provider/v1/*` is the backend inference proxy, not a provider-settings renderer endpoint. This UI does not call it.
- HyperPlaygroundSection.tsx and HyperPlaygroundApi.ts: app/src/routes/_authed/admin/playground.tsx and app/src/lib/sandboxed/{queries,mutations}.ts. Draft editing, JSON-object validation, upstream SDK sandbox preview, server draft list, save-before-publish, published revision state and confirmed deletion. No CSP changes or arbitrary renderer evaluation.
- HyperProactiveSection.tsx and HyperProactiveApi.ts: app/src/routes/_authed/admin/proactive.tsx, app/src/lib/enterprise/{queries,mutations}.ts and app/src/lib/deployment/queries.ts. Personal/team controls, organization proactive capability and override count, 1–1440 daily limit, independent metrics/settings failures, 7/30-day window, all per-Bot outcome/skip/item/ping/acceptance breakdowns.
- HyperCheckInsPanel.tsx and HyperCheckInsApi.ts: app/src/lib/proactive.ts and app/src/components/suggestions/proactive-panel.tsx. Create with duplicate refusal, edit focus/interval, toggle, run-now queued/skipped answers, confirmed removal, polling, conversation navigation and suggestion start/hide/source actions. Server interval bounds 60–1440 and text/link bounds are checked locally. New check-ins use a paged conversation selector, reusing parent onboarding/HyperReadHomeChannels.
- HyperComputersSection.tsx and HyperComputersApi.ts: app/src/routes/_authed/admin/computers.tsx, app/src/components/manage/computers-page.tsx, app/src/components/admin/controls/computer-sections.tsx, app/src/lib/computers/{queries,mutations,host-access}.ts and app/src/lib/enterprise/network-allowlist.ts. Fleet isolation, status, egress, stop/reset/update, confirmations, own-browser clear, folder requests/revocation/stop/polling, idle cleanup, organization/group network policies, preserved domain/CIDR ports, translation/readback/compiler refusal, history replay, lock, save/remove. Governance's action-policy editor remains in its owned area.
- HyperPluginsSection.tsx: native connections panel in admin mode. See ../connections/REUSE.md.
- HyperSkillsSection.tsx: native skills panel in admin mode. See ../skills/REUSE.md.

## Parent integration

Merged parent 13298d5 without changing its API, voice, notification or upload security implementations. Vault exports reused: HyperKeyForm, hyperStoreMcpToken. Parent owns callback routing: provider callback credentials must be consumed in main, and only the app/server id may be passed to the native connection view. See connections navigation contract. No callback code or tokens are parsed or displayed by these modules.

## Validation limits

All validation uses locked dependencies on Node 24.18.1 and mocked transport. No live backend, desktop launch, deployment or real credentials. Browser consent completion requires the parent main-only callback integration and is not claimed as end-to-end verified. No independent delegated review was started, as instructed. Local source/contract review and automated checks are recorded in commits.

## Route inventory

Renderer calls use the parent transport exclusively. Identifiers are encoded; query payloads remain queries.

- GET/POST `/api/admin/credentials`; POST `/api/admin/credentials/:id/revoke` via Vault.
- GET `/api/models/available`, `/api/admin/enterprise`, `/api/admin/enterprise/models/usage?days=30`, `/api/capabilities`.
- PUT `/api/admin/enterprise/settings/{modelAllowlist,proactiveDailyRuns,inactiveComputerDays,mcpAllowlist}` with `{value}`; PUT `/api/admin/enterprise/capabilities` with organization proactive scope.
- GET `/api/admin/proactive?days=7|30`; GET/POST `/api/proactive/settings`; PATCH/DELETE `/api/proactive/settings/:id`; POST `/api/proactive/settings/:id/run`; GET `/api/proactive/suggestions`; POST `/api/proactive/suggestions/:id/{start,dismiss}`.
- GET/POST `/api/computers/fleet`; POST `/api/browser/clear`; GET `/api/host-access`; POST `/api/host-access/grants`; DELETE `/api/host-access/grants/:id`; POST `/api/host-access/stop`.
- POST `/api/admin/enterprise/computers/terminate-inactive`; PUT `/api/admin/enterprise/network`; DELETE `/api/admin/enterprise/network/{organization,group}`; POST `/api/admin/enterprise/network/{translate,replay}`.
- GET/POST `/api/sandboxed`; POST `/api/sandboxed/:name/publish`; DELETE `/api/sandboxed/:name`.
- GET `/api/plugins`, `/api/plugins/connections`, `/api/plugins/composio/apps?q=...`; POST `/api/plugins/composio/apps`, `/api/plugins/servers`, `/api/plugins/servers/by-url`; DELETE `/api/plugins/servers/:id`.
- POST `/api/plugins/servers/:id/{connect,refresh,oauth-client}`; PUT `/api/plugins/servers/:id/{account-mode,owner-grants}`; POST `/api/plugins/servers/:id/connection/{confirm,recheck}`; GET `/api/plugins/servers/:id/connection/siblings`; DELETE `/api/plugins/servers/:id/connection`.
- GET `/api/plugins/servers/:id/accounts`; POST `/api/plugins/servers/:id/accounts/:account/default`; DELETE `/api/plugins/servers/:id/accounts/:account`.
- POST/DELETE `/api/plugins/grants`; POST `/api/plugins/skills`; DELETE `/api/plugins/skills/:slug`; GET `/api/agents` and `?hidden=true`; GET `/api/channels` and cursor pages.
- GET `/api/approvals/shared-use` and `/api/approvals/shared-use/bot/:id`; POST `/api/approvals/shared-use/:id/{approve,decline}`.
- GET/POST `/api/plugins/access-requests`; DELETE `/api/plugins/access-requests/:id`; POST `/api/plugins/access-requests/:id/{approve,dismiss}`; GET `/api/plugins/for/:bot/apps/:app`; POST `/api/plugins/for/:bot/apps/:app/approve`; POST/DELETE `/api/plugins/for/:bot/apps/:app/give`.

Shared edits are confined to this area's registry entries, allowlist slot, appended policy tests and conflict reconciliation preserving parent tests. Existing parent families permit some of these paths too. Added own slot families are sandboxed, admin/credentials, admin/proactive, proactive/settings, proactive/suggestions, computers/fleet, host-access, browser/clear and called enterprise settings/network/metrics paths. Parent broader governance allowlisting remains unchanged.

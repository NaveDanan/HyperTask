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

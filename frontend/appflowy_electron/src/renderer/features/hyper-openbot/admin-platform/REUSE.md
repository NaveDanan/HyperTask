# Hyper admin platform

Adapted from OpenBot f8af37ab73e96784f174a11104505a965e722cab, Copyright (c) 2026 CopilotKit, MIT. License preserved in ../LICENSE. HyperTask developed by NaveDanan.

- HyperCredentialsSection.tsx and HyperPlatformApi.ts: app/src/routes/_authed/admin/credentials.tsx and credentials_.new.tsx. Create and revoke credentials; secret stays in component memory and request bodies.
- HyperProvidersSection.tsx: app/src/routes/_authed/admin/providers.tsx and app/src/lib/models/queries.ts. Server provider and model catalogue.
- HyperPluginsSection.tsx: delegates to ../connections/HyperConnectionsPanel.tsx. See ../connections/REUSE.md for mapping and limitations.
- HyperSkillsSection.tsx: delegates to ../skills/HyperSkillsPanel.tsx. See ../skills/REUSE.md.
- HyperProactiveSection.tsx: app/src/routes/_authed/admin/proactive.tsx. Organization capability, daily limit validation 1–1440, personal edition explanation, period selection and expandable Bot activity breakdown. Native bordered panels, labeled inputs and details replace upstream page shell and dialogs.
- HyperProactiveApi.ts: app/src/lib/enterprise/queries.ts and mutations.ts, app/src/lib/deployment/queries.ts. Contracts verified against server/src/admin/routes.ts. Capabilities default to team if edition cannot be loaded. Writes reload authoritative state.

## Remaining parity work

Computers and playground have no native admin section yet. Playground must use an approved sandbox renderer before executing authored content. Plugins currently reuse the basic connection directory; Arcade/Composio setup, dynamic credential field forms, tool and Bot grant detail pages and account-mode configuration need porting. Connections requiring credential fields currently explain that configuration is needed rather than collecting them. Provider configuration beyond the existing catalogue needs comparison with all upstream model-provider routes. Skills ownership/admin distinctions and all refusal states still need a complete comparison. lib/proactive.ts personal check-in create/update/run/remove and suggestion actions are not part of this admin metrics implementation and remain unported here. Admin check-in activity currently loads alongside controls; a failed controls read also prevents that activity refresh. Permission navigation is described but has no cross-section link.

Validation uses mocked transport only. No live backend or Electron launch.

Continuation: HyperProvidersSection and HyperPlatformApi now also adapt app/src/components/admin/controls/model-sections.tsx: team model allowlist, model names outside the catalogue, default explanation and 30-day usage. HyperPlaygroundSection/Api adapt app/src/routes/_authed/admin/playground.tsx and app/src/lib/sandboxed/{queries,mutations}.ts. Preview uses the same OpenGenerativeUIActivityRenderer from the locked CopilotKit SDK. Save precedes publish, invalid JSON objects block writes, deletion is confirmed, and saved status is read again after every attempted write. HyperSkillsSection now selects admin mode; skills reload after refused as well as successful mutations because upstream writes are not atomic.

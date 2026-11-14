# Settings reuse

Source: OpenBot, pinned f8af37ab73e96784f174a11104505a965e722cab. MIT, Copyright (c) 2026 CopilotKit. See LICENSE.

| Local file | Exact upstream sources | Adaptation |
| --- | --- | --- |
| HyperSettingsApi.ts | app/src/lib/settings/queries.ts, mutations.ts, message-list.ts; app/src/lib/auth/queries.ts, mutations.ts; app/src/lib/edition-guard.ts | Main-owned transport; named response fields; validation; refresh identity after profile save; server-authoritative instructions/preferences; edition failure defaults to team. |
| HyperSettingsSection.tsx | app/src/routes/_authed/settings/index.tsx, route.tsx; app/src/components/settings/profile.tsx, standing-instructions.tsx, message-list-preference.tsx, settings-sidebar.tsx | Native HyperTask card rows and dialogs; loading, retry, error, empty, pending and saved states; character count; explicit clearing; preference preview. No upstream shell, theme, CSS or desktop bridge. |
| index.ts | No upstream equivalent | Public native exports. |
| HyperSettings.test.tsx | No copied tests | Mocked transport contract tests and static native UI states. |

Verified settings and profile mounts in server/src/app.ts, including /api/settings/instructions, /api/settings/preferences and /api/me/profile. Allowlist families are settings and me. Existing capabilities family serves edition discovery. No dependencies added. No telemetry initialized or enabled. All user content renders as text.

## Integration and parity gaps

HyperOpenBotSectionContext has no navigate(sectionId), so the requested cross-area entries are text destinations, with data-section-id markers. The lead must wire section navigation for notifications and approvals (approvals-inbox), vault/passwords/credentials/connected accounts (vault), computer/browsers/this computer (computer-browser), memory/learning (memory), setup (onboarding), gallery (screens), skills (skills), apps (connections). Destination IDs must be checked against final integrated registrations.

Upstream settings/skills.tsx and _personal/skills_.new.tsx, skills_.$slug.tsx redirect to Skills; _personal/plugins.$.tsx redirects to Connections. These are represented by destination entries; native deep-link forwarding and new/edit/slug intent are not implemented because the shared context has no navigation API.

The _personal.tsx personal-edition guard is represented by fail-closed edition discovery, but personal Activity is NOT implemented. Upstream components/manage/audit-page.tsx has extensive audit filters, export, questions and explanation behavior; reuse with the admin governance specialist's audit implementation remains necessary. No broad admin family was added for an incomplete audit screen.

General appearance uses HyperTask's existing application settings. Upstream dark-theme toggle and SkinPicker skin/theme application are NOT ported, because the task forbids upstream theme/global CSS and app-level theme changes are outside this folder. Stored skin is preserved by single-field preference PATCH. Message-list emphasis persists and previews here, but wiring this preference into the shared native conversation list remains for the lead.

Upstream components/settings/ai-connection.tsx and usage-data.tsx are conditional on OpenBot Desktop's bridge. HyperTask has no equivalent bridge and uses the remote backend, so these controls are omitted. Product telemetry is never enabled. The upstream keyboard shortcut registry is not rendered because its web-router listeners are not installed in HyperTask.

Other components/settings controls belong to excluded areas: update-routing and team-bot-consents to approvals/notifications, linked-accounts to vault, devices/browsers/this-computer to computer-browser, learning sharing/review to memory. GitHub source management is not ported here and still requires integration by the lead.

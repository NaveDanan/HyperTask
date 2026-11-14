# Connections source and integration

Adapted from OpenBot at f8af37ab73e96784f174a11104505a965e722cab in /home/naved/HyperTask-OpenBot-baseline. Copyright (c) 2026 CopilotKit. MIT; see ../LICENSE. HyperTask developed by NaveDanan.

HyperConnectionsPanel adapts app/src/routes/_authed/_app/connections.index.tsx and app/src/components/connections/add-server-page.tsx. HyperConnectionsApi adapts app/src/lib/plugins/queries.ts, mutations.ts and app/src/lib/connections/connect-app.ts. Original endpoint names and envelopes are preserved.

Import HyperConnectionsPanel from ./connections and render <HyperConnectionsPanel />. No integration props, router, or provider required. Uses ../transport and window.appflowy.shell.openExternal. All new code is in connections/.

The local design uses token-based cards, native labeled form controls with shadcn Button/Input, and an in-panel detail view. This follows the existing design guide's closest settings and directory patterns. No dependency changes.

Directory reads installed servers and catalogue plus current connection rows. Add app installs the curated entry; its detail then starts consent. Add server submits title/url and opens sign-in when the response requires it. OAuth URLs open only in the system browser, never followed or approved by automation. Focus and Refresh reread actual state. Keys are never collected. Shared accounts are displayed without offering personal authorization. Brokered connections expose the existing check and confirmed disconnect operations. Tool lists are read-only.

Apps that need manual credentials or admin setup show service guidance. Identity-provider linking, broker app browsing, credential configuration and admin policy editing are outside this panel. Backend/Electron live acceptance belongs to the parent. No backend deployment or app relaunch performed.

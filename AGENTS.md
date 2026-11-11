# HyperTask

HyperTask is a self-hostable productivity workspace developed by NaveDanan. Its desktop app uses Electron and React with a Rust core. It is derived from AppFlowy; preserve upstream copyright and license notices. The repository is licensed under AGPL-3.0. Individual dependencies and assets may have their own licenses.

The desktop shell supports local and self-hosted workspaces, navigation, settings, a Jira dashboard and local templates. The Electron port is still in progress: the document editor, database views and AI chat have placeholder bodies. Consult [the desktop status](frontend/appflowy_electron/docs/STATUS.md) for current capabilities and gaps before assuming a feature is complete.

## What matters

- **User data and compatibility.** Protect existing workspaces, preferences and credentials. Keep existing protocol identifiers, data paths and upstream dependency names compatible unless a migration is implemented.
- **Local and self-hosted use.** Consider both modes when changing authentication, storage or networking. The self-hosted deployment uses an AppFlowy-compatible server; see [self-hosting](doc/self-hosted-server.md).
- **Performance and accessibility.** Keep the desktop app responsive, including large trees and lists. Preserve keyboard navigation, focus behavior and accessible controls when changing the UI.
- **A coherent interface.** Follow the existing design system and screen patterns. Read the [UI design specification](frontend/appflowy_electron/docs/design/HYPERTASK_UI.md) for UI work.

## NaveDanan's project conventions

- Prefix new product modules and widgets with `Hyper`, for example `HyperCalendar` or `HyperWhiteboard`.
- For workloads on the MMEMS K3s cluster, follow the `mmems-cluster-images` skill.
- Prefer a small, understandable solution that fits the task. Preserve behavior and compatibility unless the requested change calls for something different.

## UI component priority

**Always try ReUI first for UI work whenever possible. If ReUI does not provide a suitable component, use Base UI**, preferably through the existing `src/renderer/components/ui` wrappers. Use a custom component when neither fits the requirement. Check existing ReUI components in `src/renderer/components/reui` and the `@reui` registry in `components.json` first; ReUI is not a blanket replacement for existing working controls.

Follow the [UI design specification](frontend/appflowy_electron/docs/design/HYPERTASK_UI.md) for component ownership, tokens, styling and accessibility. In particular, Base UI composition uses `render`, not `asChild`. Reuse existing app building blocks and feature patterns, and preserve translations, shortcuts and interaction behavior unless the task changes them.

## Glossary

- **User** means a person using HyperTask.
- **Workspace** means the user's collection of pages and related data, local or connected to a self-hosted server.
- **Renderer** means the React interface running in Electron.
- **Core** means the Rust backend launched as a child process by Electron.

## How it works

The renderer sends typed protobuf events over Electron IPC to the Rust core through an authenticated loopback connection. The core also sends notifications and stream messages, including search, AI and upload progress. Changes across this boundary may need coordinated Rust, generated bindings, Electron and renderer updates. See the [desktop guide](frontend/appflowy_electron/README.md) for setup and generation commands.

## Where code lives

- `frontend/appflowy_electron/src/main` contains Electron lifecycle, platform integrations and the core process bridge.
- `frontend/appflowy_electron/src/preload` exposes the desktop API to the renderer; `src/shared` contains shared types and protobuf bindings.
- `frontend/appflowy_electron/src/renderer` contains the React UI, backend dispatch, features, translations and theme.
- `frontend/rust-lib` contains the Rust workspace, including `electron-core` and the document, database, folder, user and server crates.
- `frontend/resources` and `frontend/appflowy_electron/resources` contain shared and desktop assets.
- `deploy/self-hosted` contains the example self-hosted deployment.

## Development and verification

Run desktop commands from `frontend/appflowy_electron`. The [desktop guide](frontend/appflowy_electron/README.md) describes prerequisites, `npm run build:core`, `npm run gen`, `npm run dev`, build, tests and typechecking. Build the core before regenerating bindings after relevant Rust changes; do not hand-edit generated files as a substitute for generation.

Use `APPFLOWY_SUPPORT_DIR` for isolated development data. Avoid running two applications against the same local data directory. Treat existing workspace data and credentials as real user data, and use disposable test data for changes that write to disk.

Run focused tests for behavior that changed, plus the appropriate typecheck or build when relevant. For UI changes, check the affected interaction in the app when practical, including keyboard and empty or error states. Do not claim a placeholder is implemented merely because its navigation or header exists.

## Documentation and changes

Update the relevant guide or status when a change makes it inaccurate. Keep user instructions focused on tasks and maintainer instructions focused on setup or constraints that are hard to infer from code. Preserve existing unrelated changes in the working tree. Make a pull request only when asked.

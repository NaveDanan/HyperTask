# Windows development

For the Electron client, follow the [Electron development instructions](../frontend/appflowy_electron/README.md). Configure your collaboration server under **Settings → Storage & server**, or use a local workspace.

The original Flutter application is in `frontend/appflowy_flutter`. Follow its [development instructions](../frontend/appflowy_flutter/README.md) and install Flutter, Rust and the Windows build tools before building it.

The Electron and Flutter clients share data directories. Close one before running the other against the same directory.

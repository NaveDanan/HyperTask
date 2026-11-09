# HyperTask

HyperTask is a self-hostable productivity workspace developed by NaveDanan. It is based on [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy), with a new Electron desktop client using the existing Rust core.

## Development

The Electron client is in [`frontend/appflowy_electron`](frontend/appflowy_electron/README.md). Install its dependencies, build the Rust core, then run `npm run dev`. The [port status](frontend/appflowy_electron/docs/STATUS.md) lists implemented features and remaining placeholders. The original Flutter client and Rust core are retained in `frontend/`.

## License and attribution

HyperTask is derived from AppFlowy and retains its contributors' copyright notices and [GNU Affero General Public License v3](LICENSE). Individual dependencies and assets may have their own licenses.

# AppFlowy & AFFiNE — Features, Modules, and How They Are Implemented

> Scope: the open-source repositories `AppFlowy-IO/AppFlowy` (+ AppFlowy-Collab, AppFlowy-Cloud, AppFlowy-LAI) and `toeverything/AFFiNE` (+ BlockSuite, OctoBase).
> Sources: GitHub READMEs, official docs, and DeepWiki code-level maps (paths below come from those sources). Verify exact paths against the commit you deploy — both repos move fast.

---

## Table of Contents
1. [At-a-Glance Comparison](#1-at-a-glance-comparison)
2. [AppFlowy](#2-appflowy)
   - 2.1 Overview & Tech Stack
   - 2.2 Repository Layout
   - 2.3 Layered Architecture
   - 2.4 Feature Modules (what + how)
   - 2.5 AppFlowy Cloud (server)
   - 2.6 AI Subsystem
3. [AFFiNE](#3-affine)
   - 3.1 Overview & Tech Stack
   - 3.2 Repository Layout
   - 3.3 Layered Architecture
   - 3.4 Feature Modules (what + how)
   - 3.5 AFFiNE Server (self-host)
   - 3.6 AI (Copilot) Subsystem
4. [Implementation Comparison Matrix](#4-implementation-comparison-matrix)
5. [Air-Gapped / Local-LLM Notes (vLLM)](#5-air-gapped--local-llm-notes-vllm)

---

## 1. At-a-Glance Comparison

| Dimension | AppFlowy | AFFiNE |
|---|---|---|
| Positioning | Open-source Notion alternative; "AI collaborative workspace" for projects, wikis, teams | "More than Notion and Miro"; knowledge base combining docs + whiteboard |
| License | AGPL-3.0 | MIT (core client parts) + other license for server; check `LICENSE` / `LICENSE-MIT` |
| UI layer | **Flutter / Dart** (desktop, mobile); separate React web app (AppFlowy-Web) | **TypeScript / React + Lit web components** (web, Electron desktop, iOS/Android via Capacitor-style shells) |
| Core logic | **Rust** (business logic, storage, sync) via FFI | TypeScript (editor/stores) + **Rust native modules** (storage, indexing, parsing) |
| Editor | `appflowy_editor` (Flutter, block based) | **BlockSuite** (block + canvas framework) |
| CRDT | **yrs** (Rust port of Yjs) | **Yjs** (JS) + Rust-side y-octo/OctoBase lineage |
| Local storage | RocksDB (`CollabKVDB`) + SQLite (Diesel) | SQLite (native `nbstore`) on desktop; IndexedDB in browser |
| Server | AppFlowy-Cloud: Rust/Actix-Web + GoTrue + Postgres(pgvector) + Redis + MinIO + Python AI service | AFFiNE server: Node.js (NestJS/GraphQL) + Postgres(pgvector) + Redis + blob storage + Rust native addon |
| Signature feature | Multi-view databases (Grid/Board/Calendar…), AI chat over workspace | **Edgeless** infinite canvas sharing the same doc model as Page mode |

---

## 2. AppFlowy

### 2.1 Overview & Tech Stack
- AppFlowy describes itself as the AI collaborative workspace that brings projects, wikis, and teams together while you keep control of your data; built with **Flutter and Rust**; available on macOS, Windows, Linux, iOS, Android, plus self-hosting.
- Core design principle: **hybrid architecture** — Flutter for presentation, Rust for business logic and data, connected through an FFI boundary.

### 2.2 Repository Layout (main repo)
```
AppFlowy/
├── frontend/
│   ├── appflowy_flutter/          # Flutter app (UI, BLoCs, plugins)
│   │   └── lib/
│   │       ├── plugins/
│   │       │   ├── document/      # Document page plugin
│   │       │   ├── database/      # grid/, board/, calendar/, tab_bar/
│   │       │   └── ai_chat/       # AI chat page, blocs, message widgets
│   │       ├── workspace/         # sidebar, settings, workspace menu
│   │       ├── mobile/            # mobile-specific presentation
│   │       └── ai/                # model selection, prompt input
│   ├── rust-lib/                  # Rust workspace
│   │   ├── dart-ffi/              # FFI bridge exported to Dart
│   │   ├── flowy-core/            # App bootstrap, wires managers
│   │   ├── flowy-user/            # Auth, profile, workspaces, data import
│   │   ├── flowy-folder/          # Sidebar tree / views
│   │   ├── flowy-document/        # Document manager
│   │   ├── flowy-database2/       # Database engine (fields/rows/views)
│   │   ├── flowy-ai/              # AI manager, local AI, chat
│   │   ├── flowy-server/          # Cloud abstraction (local vs AF Cloud)
│   │   ├── flowy-sqlite/          # SQLite schema & migrations (Diesel)
│   │   ├── collab-integrate/      # AppFlowyCollabBuilder
│   │   └── event-integration-test/
│   └── resources/translations/    # i18n JSON
├── doc/ , ROADMAP.md , install.sh , codemagic.yaml
```
Related repos: **AppFlowy-Collab** (CRDT data layer), **AppFlowy-Cloud** (server), **AppFlowy-Web** (React web client), **AppFlowy-LAI** (local-AI plugin loader), **AppFlowy-SelfHost-Commercial** (Helm charts).

### 2.3 Layered Architecture
```
┌──────────────────────────────────────────────────────────────┐
│ Presentation (Flutter/Dart)                                  │
│  Widgets: AppFlowyEditorPage, DatabasePage, AIChatPage       │
│  State: BLoC pattern (DocumentBloc, DatabaseBloc,            │
│         UserWorkspaceBloc, ChatBloc …)                       │
│  Services: ViewBackendService, DatabaseBackendService …      │
├──────────────────────────────────────────────────────────────┤
│ FFI Bridge (dart-ffi)                                        │
│  AFPluginDispatcher → event routing                          │
│  Protobuf serialization (ViewPB, RowPB, DatabasePB, DocPB)   │
├──────────────────────────────────────────────────────────────┤
│ Business Logic (Rust)                                        │
│  Event handlers (e.g. get_database_data_handler)             │
│  Managers: UserManager, FolderManager, DatabaseManager,      │
│            DocumentManager, AIManager                        │
├──────────────────────────────────────────────────────────────┤
│ Data Access (Rust)                                           │
│  Collab framework: AppFlowyCollabBuilder → Collab objects    │
│  Cloud abstraction: Database/Folder/DocumentCloudService     │
├──────────────────────────────────────────────────────────────┤
│ Persistence                                                  │
│  Local: CollabKVDB (RocksDB / IndexedDB on web) + SQLite     │
│  Remote: AppFlowy Cloud HTTP API + WebSocket sync            │
└──────────────────────────────────────────────────────────────┘
```

**How a UI action flows (example: edit a cell):**
1. Widget fires an event to a BLoC.
2. BLoC calls a backend service → serializes a Protobuf request → `AFPluginDispatcher` over FFI.
3. Rust event map routes to a handler in `flowy-database2`.
4. Handler calls `DatabaseManager → DatabaseEditor → DatabaseViewEditor`.
5. Change is recorded as a **yrs transaction** on a `Collab` object; plugins persist it (RocksDB) and sync it (WebSocket to cloud).
6. Rust sends async **notifications** back to Flutter, which update BLoC state.

### 2.4 Feature Modules

#### 2.4.1 Workspace, Sidebar & Views (Folder)
| Feature | Details |
|---|---|
| Multiple workspaces | Switch/create workspaces; workspace menu on desktop & mobile |
| Sidebar tree | Nested pages ("views") of type Document, Grid, Board, Calendar, Chat |
| Favorites / Recent / Trash | Standard page lifecycle |
| Icons, covers | Per-view metadata |
| Publish / share | Publish pages to web (cloud) |

**Implementation**
- `flowy-folder` owns a **Folder collab** (a CRDT document containing the view hierarchy).
- Creating a document: `flowy_folder` creates a *view* of type document → `flowy_document` creates a document with that view ID → updates propagate to plugins (local disk plugin persists; sync plugin pushes to server).
- Workspace membership and settings are mirrored in SQLite tables (`workspace_sql.rs`, `member_sql.rs`, `workspace_setting_sql.rs` in `flowy-user-pub`).

#### 2.4.2 Document Editor
| Feature | Details |
|---|---|
| Block-based rich text | Paragraphs, headings, lists (bulleted/numbered/todo), toggle, quote, callout, divider |
| Slash command menu | Insert any block type |
| Code blocks, math (LaTeX), tables | Rich blocks |
| Images, files, link previews, embeds | Media blocks |
| Inline database | Embed grid/board/calendar inside a doc |
| Mentions | @page, @date/reminder, @person |
| Markdown shortcuts & import/export | Markdown, plain text, Notion import |
| Real-time collab | Multi-cursor via awareness |

**Implementation**
- UI: `appflowy_editor` (open-source Flutter rich-text editor package) rendered inside `plugins/document`.
- Data: a **Document collab** — block tree stored in yrs maps/arrays, text in `Y.Text`-equivalent deltas.
- `flowy-document` `DocumentManager` opens/creates documents, applies block-level operations, and emits change notifications.
- Importers (Markdown/Notion/CSV) and exporters (Markdown/plain text) live in **AppFlowy-Collab** as importer/converter modules.

#### 2.4.3 Databases (Grid, Board, Calendar, …)
| Feature | Details |
|---|---|
| Views | **Grid** (table), **Board** (Kanban), **Calendar** (day/week/month); one database → many views, convertible |
| Field types | Text, Number, Date, Single/Multi-select, Checkbox, Checklist, URL, Relation, Created/Last-edited time, Media, Summary/Translate (AI) etc. |
| Filters / Sorts / Groups | Per-view configuration |
| Calculations | Footer aggregations (sum, avg, count…) |
| Row pages | Each row opens as a page with rich-text body |
| Hidden groups, card settings | Board-specific |

**Implementation**
- Data model: `Database` → `Field` (column, with `field_type` + `type_options` map keyed by FieldType) → `Row` → `Cell`. Views share the database but keep their own layout settings.
- **Three-tier engine in `flowy-database2`:**
  - `DatabaseManager` — orchestrates lifecycle of open databases.
  - `DatabaseEditor` — per-database logic (fields, rows, cells).
  - `DatabaseViewEditor` — per-view logic, owning `FilterController`, `SortController`, `GroupController`, `CalculationsController`.
- Events defined in `event_map.rs`, handled in `event_handler.rs`; notifications pushed asynchronously to the Flutter BLoCs (`grid_page.dart`, `calendar_page.dart`, `board_hidden_groups.dart`, `tab_bar_view.dart` for view tabs).
- Rows are separate collab objects (enables lazy loading and per-row docs).

#### 2.4.4 Collaboration & Sync (AppFlowy-Collab)
- `collab` crate built on **yrs**: CRDT primitives, persistence helpers, domain objects for documents, databases, folders, user awareness.
- Flow: client requests domain op → `Collab` records it as a yrs transaction and fires plugin hooks → plugins persist (`RocksdbDiskPlugin`) and optionally sync (WebSocket backend; historically a Supabase plugin) → update fans out to other clients.
- Extension points described in the docs: realtime/P2P plugins, content-indexing plugin for search.
- `AppFlowyCollabBuilder` (in `collab-integrate`) constructs collab objects with the right plugins for the current mode (local-only vs cloud).

#### 2.4.5 Users, Auth & Data Import
- `flowy-user`: sign-in (local / AppFlowy Cloud via GoTrue), profile, sessions, workspace membership, **data import** (`appflowy_data_import.rs` — importing local data into cloud workspace).
- `flowy-server`: `local_server` impl (offline-only mode) and `af_cloud` impl behind the same trait-based cloud service interfaces → the same app runs fully offline or connected.

#### 2.4.6 Local Storage
- **SQLite + Diesel ORM** (`flowy-sqlite`) for relational metadata (users, workspaces, settings), with versioned migrations (`diesel migration generate/run`).
- **CollabKVDB** (RocksDB on native; IndexedDB on web) for CRDT update logs/snapshots.

#### 2.4.7 Search
- Local full-text search over pages; on cloud, a dedicated `appflowy_search` service provides **semantic + keyword** search (embeddings in pgvector).

#### 2.4.8 Settings, Theming, i18n, Mobile
- Themes (light/dark/custom), fonts, date/time formats (`time_format_ext.dart`), shortcuts.
- Translations as JSON in `frontend/resources/translations`, managed with **inlang**.
- Dedicated mobile presentation layer (`lib/mobile/...`) on the same Rust core.

### 2.5 AppFlowy Cloud (Server)
| Service | Purpose | Implementation | Port |
|---|---|---|---|
| `appflowy_cloud` | HTTP API + WebSocket sync | Rust / Actix-Web | 8000 |
| `gotrue` | Auth & user management | GoTrue (Supabase Auth fork) | 9999 |
| `ai` | Chat, embeddings | Python / FastAPI | 5001 |
| `appflowy_worker` | Imports, exports, notifications | Rust / Tokio | – |
| `appflowy_search` | Semantic + keyword search | Rust / Axum | 4002 |
| `nginx` | Reverse proxy | Nginx | 80/443 |
| `postgres` | Primary DB + **pgvector** | PostgreSQL 16 | 5432 |
| `redis` | Message bus, cache, coordination | Redis | 6379 |
| `minio` | S3-compatible blobs | MinIO | 9000/9001 |
| `admin_frontend` | Admin UI | Rust / Axum | 3000 |
| `appflowy_web` | Browser client | Web frontend | 80 |

**How it works**
- Startup: read env config → init `AppState` → Postgres pool, S3 client, GoTrue client, Redis client (stream router, awareness gossip) → **Casbin-based access control** → `sqlx` migrations.
- Realtime: a `CollaborationServer` / realtime server actor manages WebSocket sessions and broadcasts CRDT updates.
- Routing via nginx: `/api` (HTTP), `/ws` (WebSocket), `/gotrue` (auth), `/console` or `/web` (admin).
- Deployment: Docker Compose on one host, or Kubernetes Helm chart (commercial repo) bundling API, auth, web, admin, worker, AI, Postgres(pgvector), Redis, MinIO and optional Prometheus/Grafana.

### 2.6 AI Subsystem
| Feature | Details |
|---|---|
| AI Chat | Chat pages; chat with selected pages/workspace as context |
| AI writers in documents | Ask AI, summarize, fix spelling/grammar, continue writing, improve writing, explain, make longer/shorter |
| AI database fields | e.g., summary/translate cells |
| Model selection | Per-chat model picker (`select_model_menu.dart`) |
| Local AI | Ollama-backed, offline |

**Implementation**
- Rust `flowy-ai`:
  - `AIManager` — entry point; routes requests to cloud or local.
  - `ChatServiceMiddleware` (`middleware/chat_service_mw.rs`) — decides **local vs cloud** per request.
  - `LocalAIController` — manages the **Ollama client** (`ollama-rs` crate), per-workspace enablement, chat sessions, model-type detection (chat vs embedding).
  - `LocalAIResourceController` — validates local resources (server reachable, models present).
  - `SqliteVectorStore` — local embeddings store for RAG over workspace content.
- Flutter side: `plugins/ai_chat` (ChatBloc, streaming message widgets, markdown renderer), settings (`local_ai_setting.dart`, `ollama_setting.dart`).
- Default local models documented: an LLM (e.g., llama3.1 / gemma3) + an embedding model (nomic-embed-text / Qwen3-Embedding).
- **AppFlowy-LAI** repo: Rust plugin loader for local-AI binaries, including an `af-mcp` crate (MCP support).
- Cloud: Python FastAPI `ai` service + pgvector embeddings + `appflowy_search`.

---

## 3. AFFiNE

### 3.1 Overview & Tech Stack
- Tagline: "There can be more than Notion and Miro" — a next-gen knowledge base bringing planning, sorting and creating together; privacy-first, open-source, local-first.
- Hybrid **TypeScript + Rust** monorepo: Yarn workspaces for TS, Cargo workspace for Rust native modules (server addon, desktop native, mobile native).

### 3.2 Repository Layout
```
AFFiNE/
├── blocksuite/                    # Editor framework (in-repo)
│   ├── framework/std/             # Core std: store, view, extension system
│   ├── affine/blocks/             # Block implementations (paragraph, list, code, bookmark, …)
│   ├── affine/inlines/            # Inline formats (bold, link, footnote, …)
│   ├── affine/widgets/            # Slash menu, toolbars, drag handle, linked-doc (import)
│   └── integration-test/
├── packages/
│   ├── frontend/
│   │   ├── core/                  # Main app logic (React), dialogs, settings
│   │   ├── component/             # Shared UI components
│   │   ├── apps/web|electron|ios|android|mobile
│   │   ├── admin/                 # Self-host admin panel
│   │   ├── native/                # Rust (napi) desktop native: nbstore, sqlite_v1, import/onenote, preview
│   │   ├── mobile-native/         # Rust for mobile
│   │   └── routes/
│   ├── backend/
│   │   ├── server/                # Node.js server (GraphQL, Prisma, plugins/copilot, migrations)
│   │   └── native/                # Rust napi addon for server (doc parsing, file_type, safe_fetch, entitlement)
│   └── common/                    # env, infra, graphql (generated ops)
├── tools/cli , scripts/ , tests/ , docs/
├── .docker/ , .devcontainer/ , .render/ (one-click Render blueprint)
└── Cargo.toml , package.json , rust-toolchain.toml
```

### 3.3 Layered Architecture
```
┌──────────────────────────────────────────────────────────────┐
│ Apps: Web | Electron Desktop | iOS | Android | Admin         │
├──────────────────────────────────────────────────────────────┤
│ AFFiNE Core (React, packages/frontend/core)                  │
│  Workspace/doc management, sidebar, settings, AI panel       │
│  Dependency-injection "infra" framework (common/infra)       │
├──────────────────────────────────────────────────────────────┤
│ BlockSuite Editor                                            │
│  Store → Model → View → Action → Store (unidirectional)      │
│  Extensions: Inline | Block | Gfx | Widget | Fragment        │
├──────────────────────────────────────────────────────────────┤
│ Data: Yjs docs (block tree per doc; surface block for canvas)│
│ Storage/sync: nbstore → SQLite (desktop/mobile, Rust) /      │
│               IndexedDB (web) ; remote via server sync       │
├──────────────────────────────────────────────────────────────┤
│ Server: Node.js + GraphQL + Prisma/Postgres + Redis + blobs  │
│         + Rust native addon + Copilot plugin                 │
└──────────────────────────────────────────────────────────────┘
```

### 3.4 Feature Modules

#### 3.4.1 Page Mode (Document Editor)
| Feature | Details |
|---|---|
| Block editing | Paragraphs, headings, lists, todos, quotes, callouts, dividers, code, tables, LaTeX, footnotes |
| Slash menu, toolbars, drag handle | Widgets |
| Bi-directional links | Linked docs, backlinks panel |
| Outline, title, doc info | Fragments around the editor |
| Embeds | Bookmarks/link cards, images, attachments, YouTube/Figma-style embeds |
| Diagrams | Mermaid / Typst rendering (migrated to native Rust code) |

**Implementation (BlockSuite)**
- Documents are a **block tree**: root block on top, leaf blocks at the bottom.
- Data flow: `Store` provides data → creates a `Model` for each block → `View` renders it → `Action`s bound to view update `Store`.
- **Extension system**, one or more extensions per feature, categorized:
  - **Inline** — bold, italic, highlight, links, footnotes.
  - **Block** — paragraph, list, code, bookmark…
  - **Gfx** — canvas elements (shape, brush, frame).
  - **Widget** — slash menu, toolbar, drag handle.
  - **Fragment** — panels outside the editor (title, outline, dual-link panel).
- **Reactive layer on Yjs**: each block property is stored in a `Y.Map` (`prop:foo`), arrays as `Y.Array`, text as `Y.Text` (wrapped as `Text`); each prop is exposed as a **proxy + signal** (`model.props.count`, `model.props.count$`) so updates via proxy, signal or raw Yjs stay in sync.

#### 3.4.2 Edgeless Mode (Whiteboard / Infinite Canvas)
| Feature | Details |
|---|---|
| Infinite canvas | Pan/zoom freeform space |
| Shapes, brush/pen, connectors, text, frames | Drawing tools |
| Notes on canvas | Document blocks placed as "note" cards |
| Mind maps | Structured diagrams |
| Frames & presentation | Frame-based slide-like presenting |
| Page ↔ Edgeless switch | Same doc, two representations |

**Implementation**
- All whiteboard elements live in a **surface block** inside the same doc; each editable unit is an *element* (brush, shape, connector…) implemented as **Gfx extensions**.
- Because page content and canvas share one Yjs document, switching modes is a re-render, not a data conversion — that is what makes the "Notion + Miro in one" model work.

#### 3.4.3 Databases in Docs
| Feature | Details |
|---|---|
| Database block | Table and Kanban views inside documents |
| Column types | Text, number, select, multi-select, date, checkbox, link, progress, etc. |
| Filter/sort/group | Per view |
| Doc properties | Pages themselves carry properties usable in collections/all-docs views |

**Implementation:** a database is a **block** (with its rows as child blocks and column definitions as props) within BlockSuite, so it is CRDT-synced exactly like text.

#### 3.4.4 Organization: Workspace, Collections, Tags, Journals
| Feature | Details |
|---|---|
| Workspaces | Local or cloud/self-hosted; switch between servers |
| All Docs / Collections / Tags | Rule-based collections, tagging |
| Favorites, Trash | Standard |
| Journals | Daily-note style pages |
| Templates | Doc templates |
| Search / Quick search (Cmd+K) | Full-text indexing |

**Implementation:** workspace metadata is itself a Yjs root doc listing sub-docs; indexer on desktop (Rust) and server (indexer service; improved perf in recent commits) powers search.

#### 3.4.5 Import / Export
- Import: Markdown, HTML, **Notion HTML** (`transformers/notion-html.ts`), **OneNote** (Rust `native/src/import/onenote`), zip snapshots.
- Export: Markdown, HTML, PDF, PNG, snapshot.
- Implemented via BlockSuite **transformers/adapters** (block tree ⇄ external format) in `widgets/linked-doc/src/import-doc`.

#### 3.4.6 Local-First Storage & Sync
- **nbstore** (Rust, `packages/frontend/native/nbstore`) — the native storage engine: doc updates, blobs, sync state in SQLite; IndexedDB counterpart in browsers.
- Sync is CRDT update exchange with the server (WebSocket/Socket-based); offline edits merge on reconnect.
- Historical data engine **OctoBase** (Rust): offline collaborative DB with CRDT P2P sync, blob dedup, full-text indexing, fine-grained permissions — the ancestor of the current native Rust (`y-octo` lineage) pieces.

#### 3.4.7 Collaboration & Sharing
- Real-time multi-user editing with awareness (cursors/presence).
- Member invitations, roles/permissions per workspace, doc-level sharing, **public share links** (read-only publish).
- Comments/notifications (server-backed).

#### 3.4.8 Desktop / Mobile / Admin Apps
- **Electron** desktop (`apps/electron`) using Rust napi native modules.
- **iOS / Android** apps (Swift package deps visible in repo) with `mobile-native` Rust.
- **Admin panel** (`packages/frontend/admin`) at `/admin` for self-host: users, settings, AI providers.

### 3.5 AFFiNE Server (Self-Host)
| Component | Purpose |
|---|---|
| AFFiNE server (Node.js) | Web app, GraphQL API, sync, collaboration |
| Migration job | `self-host-predeploy` runs DB migrations before start |
| PostgreSQL (pgvector image) | App data; vectors for AI/RAG |
| Redis | Cache, background tasks, sync infra |
| Blob storage | Uploads (local FS or S3-compatible) |
| Rust native addon | Doc parsing, file-type detection, safe fetch, entitlement |
| Reverse proxy + HTTPS | Publish under a domain |

**How it works**
- Recommended deploy: **Docker Compose** (`affine`, `affine_migration`, `redis`, `postgres`), port 3010; config in `config/config.json` (JSON-schema validated) or the Admin Panel (`/admin/settings`).
- Schema: Prisma (`schema.prisma`) with SQL migrations (e.g., workspace runtime states, entitlement quota states).
- API: GraphQL (`schema.gql`) with generated client ops in `packages/common/graphql`.
- Also: Render one-click blueprint, devcontainer.

### 3.6 AI (Copilot) Subsystem
| Feature | Details |
|---|---|
| AI chat panel | Chat with current doc/workspace context |
| Inline writing actions | Continue, summarize, translate, rewrite, fix, explain |
| Edgeless AI | Generate mind maps, presentations, images on canvas |
| Transcription | Audio/meeting transcription jobs |
| Workflows | Multi-step actions with checkers (e.g., HTML/JSON validation) |
| Tools | e.g., `blob-read` tool for reading attachments |
| BYOK | Workspace owners bring their own provider keys |

**Implementation**
- Server plugin `packages/backend/server/src/plugins/copilot/`:
  - `providers/` — **OpenAI, Anthropic, Gemini (generative + Vertex), Perplexity, fal** behind a common `provider.ts` interface.
  - `prompt/` — prompt registry (`prompts.ts`, `chat-prompt.ts`).
  - `session.ts`, `resolver.ts`, `controller.ts` — chat sessions, GraphQL resolvers, streaming endpoints.
  - `workflow/executor/` — workflow nodes (`check-html.ts`, `check-json.ts`).
  - `transcript/` — transcription service and job claiming.
  - `tools/` — LLM tool calls.
- Jobs stored in Postgres (`copilot-job` model); embeddings in pgvector.
- Enable via `config.json`: `"copilot": { "enabled": true, "byok": { "enabled": true } }`; OpenAI-compatible endpoints configurable with `providers.openai.baseUrl`.
- Recent commit history mentions migrating copilot to a native (Rust) implementation — check the current tree.

---

## 4. Implementation Comparison Matrix

| Concern | AppFlowy | AFFiNE |
|---|---|---|
| UI → logic boundary | Flutter ⇄ Rust via **FFI + Protobuf + event dispatcher** | TS in-process; Rust via **napi** native modules |
| State management | BLoC (Dart) | Signals/proxies over Yjs + DI services |
| Document model | Block tree in yrs Collab | Block tree in Yjs (BlockSuite) |
| Canvas | Not a core primitive | **Surface block + Gfx elements** in same doc |
| Database model | Dedicated engine (Manager/Editor/ViewEditor + Filter/Sort/Group/Calc controllers), rows as separate collabs | Database **block** inside docs |
| Local persistence | RocksDB + SQLite (Diesel) | SQLite via Rust nbstore / IndexedDB |
| Server language | Rust (Actix/Axum) + Python AI | Node.js (GraphQL/Prisma) + Rust addon |
| Auth | GoTrue (JWT), SAML/OIDC in enterprise | Built-in accounts, OAuth, magic link (configurable) |
| Access control | Casbin | Workspace roles/permissions in server |
| Vector search | pgvector + `appflowy_search` + local `SqliteVectorStore` | pgvector (server-side) |
| AI providers | Cloud AI service; **Ollama local AI** on desktop | Pluggable providers incl. **OpenAI-compatible baseUrl**; BYOK |
| K8s | Official Helm chart (commercial repo) | Docker Compose primary; K8s via community |

---

## 5. Air-Gapped / Local-LLM Notes (vLLM)

Relevant to serving a local model with vLLM's OpenAI-compatible API on an air-gapped cluster:

**AppFlowy**
- Desktop Local AI talks to an **Ollama** API (not OpenAI API) — to use vLLM you'd need an Ollama-compatible shim/proxy or use the server-side AI service with a configurable OpenAI-compatible endpoint (check AppFlowy-Cloud AI env vars for your version).
- Needs an **embedding model** too (for RAG/search).
- All images (cloud, worker, gotrue, ai, search, web, admin, postgres-pgvector, redis, minio, nginx) must be mirrored to an internal registry.

**AFFiNE**
- Easiest path: `copilot.providers.openai.baseUrl` → your vLLM endpoint, plus API key. Community reports show defaults sometimes hard-code specific model IDs per action, which may need overriding via admin settings or a rebuild.
- Mirror `ghcr.io/toeverything/affine`, `pgvector/pgvector`, `redis` images; set `externalUrl`, disable any external telemetry/fetches.

> Validate tool-calling / streaming / embedding behaviour against your vLLM build before rollout — both apps assume specific provider semantics.

---
*Generated summary based on public repositories and documentation; module paths reflect what those sources show and may shift between releases.*

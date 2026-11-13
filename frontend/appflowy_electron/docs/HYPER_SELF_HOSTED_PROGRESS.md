# Self-hosted verification

## Current evidence

The local audit on 2026-11-10 found no Docker, Podman, nerdctl or Docker Compose executable, no Docker/Podman socket and no container-runtime environment override. `deploy/self-hosted/.env` does not exist. No existing deployment, account, credentials or running server was used.

Four tests in `tests/HyperSelfHostedConfiguration.test.ts` pass on this machine. They check:

- The default deployment publishes only NGINX, keeps backend services on an internal network, pins runtime images by digest and enables server access control.
- The proxy retains WebSocket upgrade headers, unbuffered API/upload paths and the S3 host required by signed requests.
- Python verification scripts parse and shell scripts pass `bash -n`, without executing authenticated requests.
- The disposable fixture generator creates private configuration, a unique Compose project and loopback binding without reading existing settings or starting services.

The YAML checks use the installed Python `yaml` module. They skip when that module is unavailable. Syntax and configuration checks do not prove Docker Compose schema validity, NGINX runtime validity, current client/server compatibility or working synchronization. Docker Compose and NGINX runtime validation remain open. On 2026-11-11, the five pinned backend binaries were extracted into private scratch and started as ordinary non-root processes on loopback addresses. No existing deployment or user credentials were used.

Native boundary tests cover authenticated, bounded raster downloads, rejected redirects and foreign workspace URLs, streaming size limits, owner cancellation and atomic file publication. Those boundary tests use fake tokens and loopback HTTP services. The separate five-service probe below uses actual GoTrue authentication and two independent native clients.

Dataset copies now initialize their committed root, rows and bodies through the native collab plugins. The duplicate-only path excludes database snapshots from the legacy HTTP batch, including recursive copies. Recovery initializes current objects and preserves later edits instead of replaying captured snapshots. Ten actual-server copy stages pass before creator-side target inspection; see [copied-object publication](#copied-object-publication) and [the runtime evidence](HYPER_DATASET_SYNC.runtime.json).

A two-device core probe against those actual PostgreSQL, Redis, SeaweedFS, GoTrue and Cloud processes passed seven stages: fresh signup/native sign-in, bidirectional Unicode document edits, initial database reads, live cell edits, row-body metadata/text sync, exact-byte native upload/completed download, and restart persistence. Each device used a separate support directory. No explicit `InitRow` was added to make the read/sync checks pass. Both clients stopped cleanly. This is ordinary-process evidence, not container/proxy/TLS validation.

Fresh-client reminder checks exposed an awareness loader that populated a cloned map instead of publishing to the active user manager. The map is now shared, and publication checks the current session, physical database and lifecycle generation. All 89 focused native checks pass. Four real-server checks also pass: a reminder can be created and read immediately after sign-in, a second fresh client reads it without restarting, and switching accounts away and back preserves the correct owner's reminders. This fixes reminder awareness loading; renderer collaborator cursors remain unimplemented.

The pinned Cloud 0.9.51 server also retained a former Member write policy after a Guest downgrade. In the isolated role probe, a fresh owner client read the exact edit sent after the downgrade, with server access control enabled. Complete membership removal blocked the later edit. The [source patch and provenance](../../../deploy/self-hosted/patches/README.md) against the exact public AGPL 0.9.51 revision pass all 17 access-control unit tests, a real-PostgreSQL cancellation test and production compilation. The resulting binary passed three native role stages with a fresh test member: authorized editing, Guest downgrade denial and full revocation denial, each confirmed by a cold owner client. The seven-stage document/database/file baseline also passed against that exact binary. [Runtime evidence](../../../deploy/self-hosted/patches/HyperCloud-0.9.51-workspace-role-policy.runtime.json) records the checked binary and patch hashes without account data. The default deployment image remains the original 0.9.51; using the fix currently requires building the patched source. Container/proxy/TLS validation, fresh Guest workspace navigation and multi-replica policy invalidation remain open.

A clean early follow-up with fresh support directories and one sign-in per client failed its source-grid check after 30 seconds. It used the default workspace and section, with no explicit workspace switch, row initialization or restart. Later read-only checks on the observer and a third fresh client found the correct database/view mapping and the edited row. The three untouched default rows were still missing remotely. The timeout helper retained an earlier database error even after later reads reached the row-count check, so that first error did not establish a permanently missing database root. That run sent no duplicate request. The source-row, visible-reader and copy proofs below supersede its initial-row and copy classification. The broader new-workspace matrix and Guest workspace selection remain open.

The initial-row fix initializes completed native database/row objects and guards their sync-plugin cache cleanup. It passed 101 focused native checks and all 72 database library tests. An immediate two-client control still returned zero rows from the batch snapshot API, while all four exact single-object requests returned valid active row states within 13 seconds. A later cold read found every row durably stored. The pinned server batch handler excludes active realtime groups and its persistence interval is 60 seconds, so the earlier 31-second timeout did not prove missing live row objects. The owner-scoped single-read fallback uses four shared permits. It preserves original CRDT bytes, checks requested row identity/type, and cancels stale work. Together with document history sync, that checkpoint passed 113 focused native checks and the full 78-test database suite. A fresh two-client probe passed 12 stages: all four initial rows read before any InitRow, then the observer followed upstream visible-reader InitRow/metadata/listener activation, followed by bidirectional cell/metadata/body changes, cold readers and restart. Initial availability and live reader activation are separate requirements. The scoped renderer lifecycle below now protects active sets beyond the 50-row idle cache.

Bookmark thumbnails passed actual guarded cloud upload, cross-device protected-reference reads and exact-byte completed download. Removing a thumbnail synchronized, but native Undo restored and persisted it only on the first client. Read-only restarts confirmed the second client retained removal while the shared image blob remained readable. An exact-origin document sync wrapper now fixes that gap. Eight fresh-client stages pass, including native history success and creator-state checks before peer reads, thumbnail remove/Undo/Redo, independent restart and cold reads with exact image bytes, and plain-text Undo/Redo. The original failing report is retained. See [native runtime evidence](HYPER_NATIVE_SYNC.runtime.json).

## Prepare an isolated deployment

`tests/HyperSelfHostedFixture.py` copies only the checked-in Compose and proxy configuration into a new temporary directory. It creates fresh secrets, a unique project name, separate project volumes and a `127.0.0.1` port. It adds an `X-HyperTask-Test-Instance` response header to `/healthz` so future integration tests can verify the target before creating accounts. This marker grants no authentication rights.

From `frontend/appflowy_electron`:

```sh
fixture_dir=$(python3 tests/HyperSelfHostedFixture.py --directory-only)
test -f "$fixture_dir/.hyper-test-instance.json"
docker compose --project-directory "$fixture_dir" config --quiet
```

The fixture's `.env`, `.s3.json` and manifest are mode `0600`; its directory is mode `0700`. The generator prints no credentials. Port selection checks availability while preparing the directory; Docker may report a conflict if another process takes that port before startup. Generate a fresh fixture in that case.

When a container runtime and the pinned images are available, start only this project:

```sh
docker compose --project-directory "$fixture_dir" up -d --no-build --wait --wait-timeout 120 postgres redis minio
docker compose --project-directory "$fixture_dir" exec -T postgres psql -U appflowy -d appflowy -v ON_ERROR_STOP=1 -c 'CREATE SCHEMA IF NOT EXISTS auth;'
docker compose --project-directory "$fixture_dir" up -d --no-build --wait --wait-timeout 180 gotrue appflowy_cloud admin_frontend nginx
```

These commands have not run on this machine. They follow the existing bootstrap service order. The fixture excludes the optional web profile and does not fetch or build source repositories. Each command names the temporary project directory; use that same directory for teardown:

```sh
test -f "$fixture_dir/.hyper-test-instance.json"
docker compose --project-directory "$fixture_dir" down --volumes --remove-orphans
```

Delete the temporary directory only after its project has stopped. Keep the repository's real deployment directory and any other project's volumes separate.

## Remaining integration matrix

Use temporary desktop support directories and new test accounts. Verify the loopback origin and fixture marker before sending account requests. Avoid storing credentials in command arguments, test output or committed files.

| Flow | Client/protocol path | Required checks still open |
| --- | --- | --- |
| Password signup and login | `SignUp`, `SignInWithEmailPassword`, GoTrue `/gotrue` | Fresh signup, token refresh, expired credentials, restart and sign-out cleanup. |
| Workspace membership | `GetAllWorkspace`, `CreateWorkspace`, `OpenWorkspace`, `AddWorkspaceMember`, `UpdateWorkspaceMember`, `RemoveWorkspaceMember` | Two independent clients; owner/member/guest roles; switching workspaces while requests are pending. |
| Invitations and recovery | `InviteWorkspaceMember`, `ListWorkspaceInvitations`, `AcceptWorkspaceInvitation`, GoTrue recovery | The default deployment disables SMTP. Use a separate disposable mail service before claiming email delivery, reset or invitation flows work. |
| Document sync | `OpenDocument`, `ApplyAction`, `/ws/v1` | Independent client support directories, concurrent Unicode and rich-text edits, offline edits followed by reconnect, restart, deletion and restoration. A successful WebSocket handshake alone is insufficient. |
| Database sync | Database events, folder views and document references | Shared rows, typed checklist/relation/media edits, linked inline views, field settings and layout changes across clients; row-document bodies after restart. |
| Permissions | Shared-page events, workspace roles, server access control | Read-only clients cannot write through raw events; permission revocation removes stale data and prevents late writes; private sources do not leak through backlinks, relations, collections or AI context. Local lock tests do not establish server authorization. |
| Attachments | `UploadFile`, `DownloadFile`, file-progress streams, `/minio-api/` | Actual cloud upload and signed download, interrupted/retried transfers, unauthorized reads, shared references and object retention. Managed local-copy tests do not cover this path. |
| Publish/share | `PublishView`, `GetPublishInfo`, shared-page events | Anonymous public reads, private blocks/attachments omitted as appropriate, publish updates, unpublish and access revocation. |
| Search/AI | Search streams, server search/indexer and provider APIs | The example disables the indexer and does not run an AI service. Local provider fixtures do not establish semantic search or server AI behavior. |
| TLS and restore | TLS overlay, certificates, backup/restore tooling | Trusted certificate chain and hostname, WebSocket TLS, restored database and object storage in a separate project, and client reconnect after restore. |

Docker Compose, NGINX and TLS validation remain open. Ordinary-process tests can continue against the isolated five-service fixture. The existing AppFlowy-compatible server remains the implementation target; no AFFiNE server or data format replaces it.

## Visible-row subscriptions

An actual two-client probe passed eight stages with 61 source rows and a second pane covering 41 overlapping rows. All 61 row metadata records became readable without legacy `InitRow` calls. The initial database reply contained row IDs before background loading finished, so the control used bounded metadata reads before testing subscriptions. No creator-side warming or mutation retries were used.

The scoped activity API kept remote updates live on the first and last rows, beyond the 50-row idle cache. Closing one pane preserved the overlapping pane and rejected reactivation of its closed activity. An empty live pane kept its context until terminal disposal; closing the last pane retired the context. Cell and metadata updates worked in both directions, and a core restart rejected the old context while retaining the 61 rows. All probe cores stopped afterward. The final run used core SHA-256 `48d88b4c9cf7bc7d79dec2401cbecfa9be18288f13838a79a895a854ccdc1932` and the role-policy candidate above. Restart here means a client/core restart, not a backend restart. [Runtime evidence](HYPER_DATASET_SYNC.runtime.json) records all eight stages.

The renderer now registers the rows in its grid, board, calendar and detail windows. Focused provider, owner, lifecycle and typed-dispatch checks pass, followed by the complete 1,627-test desktop checkpoint. Concurrent row readers now delay finalization rather than causing an immediate lock error; three deterministic cases cover success, terminal disposal and owner loss. Activities are bounded to 512 rows per pane, 64 live panes and 4,096 unique pinned rows per database editor. Up to 8,192 revision records protect against delayed requests while another pane remains open. Closing all panes of the affected dataset retires its view records. The warning provides that recovery instruction and keeps unfinished cell/form drafts available while the app stays open.

The later local filter-group increment uses core `cfdcdd33ef1af0f2feb655484f7ae421393df0cf9bf156585a0f8d1c8dca1a89`. It fixes native child deletion and passes 71 focused core/database cases, the full 102-case database library suite and public-event/actual-Page restart checks. These sets overlap and are counted separately. The 34 actual-server stages in this document remain evidence for their recorded `48d88b4c…` core. No backend or deployed image was replaced for the local group checks.

## Copied-object publication

Earlier strict observer-first probes exposed two gaps: whole-dataset copies reached the observer without their rows, and individual-row copies lacked their unopened bodies. Those failing reports remain retained. The correction initializes the current committed root, every copied row and each existing copied body before returning. It preserves the atomic local commit and operation ledger; retries neither recreate deleted targets nor replay old snapshots. Observers attach before plugin initialization, avoiding a document-open lock race caught by the actual-server source control. Two deterministic queued-reader regressions cover that ordering.

The final strict probe passes ten stages. Copied dataset and individual-row bodies, cells and independent reminders are remotely readable before any creator target database, metadata or body inspection. Discarding a row-copy reply and recovering the same operation returns the existing target. Creator restart preserves that target and its source, and observer restart reads the remote copy. The final source-body opening needed zero lock retries. Native checks pass 149 focused library cases, five host cases and the full 97-case database library suite, counted separately. See [runtime evidence](HYPER_DATASET_SYNC.runtime.json). Multi-user copy permissions, interrupted synchronization and backend-restart durability remain outside this probe.

## SDK replacement

Same-process reinitialization previously returned success while the old core still held the RocksDB lock. Both the no-activity control and the 61-row lifecycle regression exposed it. The host now retires the old core, local request runner and runtime before reopening storage or changing its environment. It keeps events muted during replacement and fails closed if retirement cannot finish. The Node boundary settles old requests without replaying them and rejects dispatch while initialization is pending.

Both unchanged same-directory local regressions pass. A separate actual-server probe passes eight stages with an active row subscription and an open cloud document. Reinitialization keeps the same process, support directory and workspace without repeating OAuth login. The database is ready afterward, the old context is rejected, a new activity enrolls, and row/metadata/document changes still synchronize in both directions. These checks preserve signup and missing-workspace recovery; they do not require switching to an empty data directory.

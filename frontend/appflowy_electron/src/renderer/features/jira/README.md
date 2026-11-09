# HyperTask Jira data layer

Ported from Flutter Jira sources and tests at commit 5a5db3717. No UI is included.
Import the public API from @/features/jira. Product implementations use Hyper
prefixes; Jira aliases retain the source integration's terminology.

Create a stable user-scoped hook after loadKeyValueStorage has completed:

    const useJira = createHyperJiraStore({ userId: String(user.id) });
    await useJira.getState().load();

In React, keep the hook instance stable for a user and subscribe to individual
fields. Do not create a hook inside every render. An injected repository and
optional database mapper support tests and alternative hosts. Passing
databaseMapper: null disables the mirror action.

## State contract

Every field and action also has a one-line comment in logic/jira-store.ts.

| Field | Meaning |
| --- | --- |
| isLoading | Initial config, credentials and cache are loading. |
| config | Non-secret JiraConfig, or null before setup. |
| hasCredentials | A nonempty secret exists for the exact configured account. |
| credentialsPersist | Platform credentials survive restart. |
| snapshot | Cached issues, scope/JQL, last attempt/success dates and last error. |
| isSyncing | A Jira search is in progress. |
| syncLoaded | Unique issues loaded in the current search. |
| syncTotal | Jira's reported search total. |
| error | Most recent typed action failure, or null. |
| message | Transient success/info banner, or null. |
| categoryFilter | Category filter, or null for all. |
| assigneeFilter | Username filter; empty means unassigned, null means all. |
| query | Case-insensitive key, summary, status and assignee search. |
| isDatabaseSyncing | One-way database mirror is running. |
| isConfigured | URL and project key are present. |
| canSync | Config and credentials permit sync and no sync is running. |
| stats | Aggregates across all cached issues, unaffected by list filters. |
| visibleIssues | Issues matching the current category, assignee and query. |

## Action contract

| Action | Behavior |
| --- | --- |
| load() | Loads cached data first, then syncs incrementally if connected. |
| sync(full = false) | Fetches and merges updates; full=true replaces the JQL result. |
| fullRefresh() | Full sync, including reporting issues removed from the JQL result. |
| saveSettings(config, credentials?) | Saves settings, retains the same-account secret if omitted, then full-syncs if connected. |
| testConnection(config, credentials?) | Read-only myself/project check without persisting settings. |
| forgetCredentials() | Deletes the configured account's secret and updates availability. |
| getCreatableIssueTypes() | Loads live types and excludes subtasks requiring a parent. |
| getIssue(key) | Fetches a fresh issue without changing the cache. |
| createIssue(draft) | Validates, creates, fetches/caches server version and emits a banner. |
| updateIssue(base, draft, { overwrite? }) | Edits supplied fields with remote conflict detection, then caches server version. |
| getTransitions(key) | Fetches live transitions with screen/required-field metadata. |
| transitionIssue(issue, transition, options?) | Applies transition/resolution/comment, caches server version and emits a banner. |
| issueChanged(issue, message?) | Reloads cache after an external repository mutation and updates the banner. |
| updateDatabase() | Mirrors cache to config.databaseViewId and returns a report or null. |
| setFilters({ category?, assignee?, query? }) | Changes provided filters; active category/assignee selections toggle off. |
| setQuery(query) | Changes search without changing other filters. |
| clearFilters() | Clears category, assignee and query together. |
| dismissMessage() | Clears transient banners while retaining snapshot.lastError. |

Dialog/read actions return their result and rethrow JiraException after also
setting state.error. load, sync, fullRefresh and saveSettings resolve with
failures represented in state.error. updateDatabase returns null on failure,
when disabled/unconfigured, or when already running. issueChanged rejects if
cache reload fails. Duplicate load/sync/database actions do not start duplicate
work. Async actions do not accept cancellation signals.

Use JiraIssueDraft with only changed fields. Null/undefined fields are omitted;
an empty assigneeName unassigns. On JiraConflictException, error.local and
error.remote carry both versions. "Use Jira version" resets the editor to remote;
"Overwrite with mine" calls updateIssue(base, draft, { overwrite: true }).
pickCloseTransition chooses a live done transition; the UI should choose a
resolution from transition.resolutionField.allowedValues and supply its ID.
Comments are sent only when hasScreen is true. Unsupported required fields
raise JiraTransitionUnsupportedException before any request.

## Compatibility and behavior

- Config uses appflowy.jira.<userId>.config; cache uses
  appflowy.jira.<userId>.cache via the existing KeyValueStorage. Both are JSON
  strings in the same Flutter shared_preferences.json, with no cloud writes.
- Config keys/auth enum names, cache version 1/metadata, and REST-shaped issue
  JSON match Flutter. Dates use UTC ISO strings; Jira +0300 timestamps normalize
  correctly. JavaScript Date has millisecond precision.
- Dataset scope is baseUrl|projectKey. Credential account ID is exactly
  userId|baseUrl|projectKey|authType|username, including a trailing delimiter
  for an empty username. No hashing/UUID dependency is needed in the renderer.
- HyperJiraCredentialStore delegates to existing window.appflowy.jira APIs.
  The main process reads/writes the Flutter-compatible support directory
  jira_credentials/<UUID-v5-URL-accountId>.json with Windows DPAPI. Other
  platforms use the main process's session credentials. isPersistent and
  repository.credentialsPersist are asynchronous because IPC is asynchronous.
- Secrets never enter config/cache JSON. Credential string/JSON conversion is
  redacted, and API/server/network error messages redact token/header values.
- Full/incremental sync preserves actual-count paging, key deduplication,
  stable numeric issue sorting, a 10,000-issue cap, a five-minute JQL overlap,
  stale-version protection, removal reporting, and failed-sync cache retention.
  sync() on the hook defaults incremental; repository.sync() retains Flutter's
  full default. Full refresh is always available.
- Repository cache changes use a promise queue that recovers after rejection.
  In-flight remote writes use their captured config and do not enter a newly
  selected dataset's cache.
- BackendJiraDatabaseGateway imports generated events from @/backend/events.
  Payloads match GetFields/CreateField/GetDatabase/GetCell/CreateRow/UpdateCell.
  Cells decode as UTF-8; text update uses cellChangeset and rows append at End.
- Database mirroring retains Flutter's idempotence, mapped text columns,
  title summary, changed-cell writes, duplicate/stale reports, and no deletes.
  Jira Key/Jira Updated must be text; other mapped non-text fields are skipped.

## Transport limits and intentionally deferred work

The supplied net.request returns only { status, body }. The client parses JSON
without Content-Type when headers are absent. It maps status codes, field errors,
HTML login responses, network/TLS failures and a 30-second deadline. Optional
response headers on an injected transport support the Flutter CAPTCHA and
Retry-After cases, but production IPC cannot expose those hints; retryAfter is
milliseconds or null. No changes outside this feature are required by this port.

The existing main transport uses redirect: 'error': credentials are not forwarded.
Identifiable redirect errors map to auth; opaque Electron ERR_FAILED failures
map to network because the original redirect status is unavailable. HTTP 3xx
responses map to auth when supplied by an injected transport.

The renderer deadline cannot cancel a main-process request with the current IPC
API. A timed-out write may complete later; the UI should reload its issue before
retrying a write. The port includes no new transport retries.

Flutter widget layout/dialog rendering checks are deferred to the UI task.
Their data behavior is covered by store tests: startup sync/progress/filtering,
live close transition/resolution, authentication errors, first-run settings,
and conflict/overwrite. Jira Cloud/ADF, comments as a standalone feature,
attachments, boards/sprints and custom fields remain outside the original scope.

## Verification

- npm run typecheck: passed.
- npx vitest run src/renderer/features/jira: 7 files, 67 tests passed.
- Flutter API/repository/mapper/stats cases and dashboard action behaviors are
  covered, plus IPC compatibility, generated backend payloads, deadline handling,
  duplicate calls, concurrent cache mutations and account-switch regressions.
- No npm dependencies added; no build/dev command or git mutation performed.

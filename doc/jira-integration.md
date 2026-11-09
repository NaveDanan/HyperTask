# Jira integration (Server / Data Center)

A local Jira dashboard inside AppFlowy: sync issues from a Jira project, view
progress, and create, edit and close issues. Code lives in
`frontend/appflowy_flutter/lib/features/jira/`; tests in
`frontend/appflowy_flutter/test/features/jira/`.

## Entry point

```dart
import 'package:appflowy/features/jira/jira.dart';

JiraDashboardPage(user: userProfile) // UserProfilePB
```

`JiraDashboardPage` is self-contained (it creates its own `JiraBloc`,
repository and local store) and expects an `AppFlowyTheme` ancestor, as every
AppFlowy page has. Optional `repository` and `databaseMapper` parameters are
for tests. The Windows sidebar opens the dashboard as a tab via LocalToolPlugin.

## Configuration

Open the dashboard and press **Connect to Jira** (or the settings icon).

| Setting | Notes |
| --- | --- |
| Jira URL | Base URL including any context path, e.g. `https://jira.example.com` or `https://host/jira`. Pasting a project (`/projects/DEMO/`) or issue (`/browse/DEMO-1`) link works: the path after `projects`/`browse` is stripped and the project key is derived. Defaults to `https://jira.example.com/projects/DEMO/`. |
| Project key | e.g. `DEMO`. |
| Authentication | **Personal access token (Bearer)** – recommended, Jira DC 8.14+. **Basic** – username + password/token, only where the server allows basic auth. |
| Custom JQL | Optional. Replaces `project = "<KEY>"`. A trailing `ORDER BY` is removed; the client always orders by key so paging is stable. |
| Database view id | Optional. Target for the one-way mirror described below. |

**Test connection** calls `GET /rest/api/2/myself` and
`GET /rest/api/2/project/<KEY>` (both read-only).

## Credentials

* Secrets are held by a `JiraCredentialStore`. They are never written to
  shared preferences, never logged (`JiraCredentials.toString()` is redacted,
  errors never echo headers) and only sent as an `Authorization` header to
  the configured Jira host. Redirects are not followed, so the header cannot
  be forwarded to an SSO page.
* A secret is bound to one server + project + auth mode + username. Changing
  any of these requires entering the token again; it is never carried over
  to another host.
* The Windows sidebar supplies WindowsJiraCredentialStore, protecting each token with the current Windows account's DPAPI key and storing only ciphertext in device-local files. Tokens survive restart, remain scoped to the Jira server/project/login, and never enter AppFlowy sync. Other platforms use session-only credentials.


## Sync and cache

* Reads use `POST /rest/api/2/search` with `startAt`/`maxResults` paging.
  The client advances by the number of issues actually returned (servers cap
  `maxResults`), de-duplicates by key and stops at 10,000 issues.
* **Sync** on open and via the button is incremental once a full sync has
  happened: `(<JQL>) AND updated >= -<N>m`, where N is minutes since the last
  success plus a 5-minute overlap. Relative dates avoid timezone mismatches.
  Incremental sync cannot see removals, so **Full refresh** re-reads the
  whole JQL result and reports issues that no longer match (they are dropped
  from the local cache only).
* The cache (issues, JQL, last attempt, last success, last error) is stored in
  shared preferences on this device under `appflowy.jira.<userId>.*`, scoped
  to the AppFlowy user id and to the Jira server + project. It is never
  synced to AppFlowy Cloud. A failed sync keeps the cached issues and shows
  the error with the time of the last good sync.
* Issues are keyed by their Jira key (`DEMO-42`); the numeric id is also
  stored. Keys can change if an issue is moved to another project; a full
  refresh then shows it as removed + added.

## Writes

All writes are single-issue actions started by the user; there are no bulk
updates and no deletes.

* **Create** – issue types come from
  `GET /issue/createmeta/<KEY>/issuetypes` (Jira 8.4+/9), falling back to the
  legacy `createmeta?projectKeys=` and then the project's issue types.
  Sub-task types are hidden (they need a parent). Summary and type are
  required; description and assignee username are optional. Projects with
  additional required fields will return a 400 that is shown in the dialog.
* **Edit** – only changed fields (summary, description, assignee) are sent
  with `PUT /issue/<KEY>`. Before writing, the current issue is fetched; if
  Jira's `updated` is newer than the version the user opened **and** one of
  the edited fields changed remotely, the dialog shows a conflict with
  **Use Jira version** or **Overwrite with mine**. Remote changes to other
  fields (e.g. status) do not block the edit.
* **Close / change status** – transitions are loaded live per issue with
  `GET /issue/<KEY>/transitions?expand=transitions.fields`; no transition ids
  are hard-coded. The dialog preselects the best transition into the *done*
  status category (preferring "Close"/"Done"/"Resolve", avoiding
  "Won't Do"/"Cancel"). Resolution is offered when the transition screen has
  one; a comment field is shown only for transitions with a screen.
  Transitions that require other fields are blocked with a pointer to Jira.

## Errors

`JiraApiClient` maps responses to typed `JiraException`s shown in banners:
401 (auth, with PAT/basic hint), 403 (permission, or CAPTCHA lock-out via
`X-Seraph-LoginReason`), 404, 400 (field errors shown next to fields), 429
(with `Retry-After`), 5xx, 3xx redirects (usually SSO), HTML bodies on 200
(login page instead of REST API), TLS/socket errors and 30 s timeouts.

## Dashboard

Totals per Jira status category (To Do / In Progress / Done, plus "No
category" if present) from the `statusCategory` Jira reports for each status,
a stacked progress bar (done share), per-assignee done/total with progress,
and counts per workflow status. Tiles, assignees and search filter the list.

## AppFlowy database mirror (optional, one-way)

With a database view id configured, **Update database** mirrors the cached
issues into that existing Grid/Board (Jira → AppFlowy only):

* Columns `Jira Key`, `Jira Status`, `Jira Status Category`, `Jira Type`,
  `Jira Assignee`, `Jira Priority`, `Jira Link`, `Jira Updated` are added as
  text fields if missing. The primary (title) field gets the summary if it is
  a text field. Existing fields are never renamed, retyped or deleted; a
  mapped name on a non-text field is skipped and reported.
* Rows are matched by `Jira Key`. A row is written only if Jira's `updated`
  differs from the `Jira Updated` cell, and only cells whose value changed,
  so repeated runs are no-ops and edits in other columns are kept.
* Rows are never deleted. Duplicate keys and rows whose issue no longer
  matches are reported.

Limitations: edits made in the database are **not** pushed to Jira (use the
dashboard dialogs). Status/assignee are text, not select options. The view id
must be entered manually (copy it from the view's link).

## Not included

* Localization of the new screens (strings are English).
* Jira Cloud (`/rest/api/3`, account ids, ADF descriptions) – the client
  targets Server/Data Center REST v2.
* Comments, attachments, sprints/boards, custom fields.

## Live DEMO verification (2026-11-08)

The replacement PAT authenticated as the expected account over validated TLS.
The DEMO project search returned four issues. Create, edit, transition and close
permissions are granted, and an existing issue exposes three transitions.
No issue was created, edited or closed during verification. Supported project
issue types are Epic, Story, Sub-task, Bug and Task; the integration still
requires the workflow's mandatory fields when saving.

The self-hosting network guard now opens a TLS socket for direct HTTPS and a
plain socket only for HTTP or proxy CONNECT transport. Regression tests verify
trusted HTTPS succeeds and an untrusted certificate is rejected. The Jira
connection formerly returned HTTP 400 because the old guard sent plaintext to
the HTTPS port. The replacement credential is protected by Windows DPAPI.

For a company CA, use **Settings → Certificates**. See
[company-certificates.md](company-certificates.md).

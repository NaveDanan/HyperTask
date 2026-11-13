# Organization features

The All docs sidebar entry lists pages from the current Rust folder. It searches page names,
tags and journal dates, filters tags and journals, and sorts by name, creation or edit time.
The core omits trashed pages and other users' private pages. The list renders 100 rows at a
time and refreshes on folder notifications.

Daily journals are ordinary document pages. Open journal reuses the accessible journal for
the selected local calendar date, including a journal whose title has changed. New public
journal IDs derive from workspace ID and date. Private IDs also include the user ID to keep
workspace members' private journals separate. The service coalesces repeated clicks, checks
the workspace and user across awaits, and refuses to recreate trashed or inaccessible IDs.
Restore a trashed journal from Trash before opening it again.

Lists, writes, queues and repeated journal requests also capture the server and storage
context before starting. Each read and write checks that owner again. Account or server
changes close the previous owner's dialogs and reject delayed replies. Collection
notifications trigger fresh view, page-list and Trash reads instead of supplying page data.

Tags and journal dates are stored in the `hyperOrganization` object inside `ViewPB.extra`.
Existing covers, fonts, unknown metadata and future organization fields are preserved. Tag
updates read the current view inside a per-page write queue and reject locked pages and
invalid metadata. The tag dialog uses the existing page access-level store. Folder CRDT
persistence and the configured self-hosted synchronization handle the metadata without a new
storage path or migration.

The Rust CreateView and CreateOrphanView paths now reject existing IDs before creating their
backing data and recheck after I/O while holding the folder write lock. This also protects
trashed and inaccessible records. UpdateView now returns the updated ViewPB promised by its
event declaration; the renderer rereads after updates for compatibility with older cores
that send an empty acknowledgement.

Verification covers metadata preservation, malformed data, calendar validation, journal
reuse, concurrent requests, workspace/user changes, distinct private journal IDs, locked
pages, trash and restart persistence. The real-core test also checks direct duplicate-id
requests preserve document text and page metadata. All disk-writing tests use temporary data.

Saved collections are ordinary document views whose `extra.hyperOrganization.collection`
stores a validated versioned filter. All docs offers New collection, an accessible parent
picker, visibility and saved collection buttons. Collection pages match metadata query/tag
constraints and all/any typed property rules, with name/creation/edit sorting. Rules support
presence, text equality/contains, numeric comparisons, dates and checkboxes. Collection
pages are excluded from collection results to avoid recursive membership.

Page properties are edited from All docs and stored in `extra.hyperOrganization.properties`.
Each stable key carries a display name, type and value. Text, finite numbers, dates and
checkboxes are supported. A key can be reused across pages for collection matching; the type
must match the rule. Property writes, tags and collection edits share one per-page queue and
merge into freshly read metadata. Unknown property types and future collection versions stay
preserved and are not overwritten by these controls. Removal of a supported property asks
for confirmation. Definitions are currently per page; a shared workspace property catalog
and select/multi-select property editors remain open.

Focused organization and collection tests include a real-core test that creates a collection
under a selected parent, stores typed values, refuses locked page writes and checks rule/value
persistence after core restart. They also pass in the completed 1,627-test desktop checkpoint;
see [FEATURE_PARITY.md](FEATURE_PARITY.md) for the current verification and remaining scope. Native Electron tests
cover account/server switches with reused page IDs, closed dialogs, pending write
acknowledgements and stale collection notifications. Other rule-editor interactions and
self-hosted multi-client validation remain open.

Journal templates remain open. Search on this screen is metadata search; the command palette retains the
existing full-text search. Concurrent metadata updates from separate clients still use the
core's whole `extra` value, so this increment does not add field-level conflict resolution.
Self-hosted multi-client synchronization has not yet been exercised for this screen.

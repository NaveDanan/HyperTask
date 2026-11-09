# Local template store

> Historical implementation notes: the previous client has been removed. See the [desktop status](../frontend/appflowy_electron/docs/STATUS.md) for current Electron functionality.

The local template store is a copy of the public template catalog at
https://appflowy.com/templates, bundled with the app so templates can be
browsed and imported with no network access. Each template's published snapshot
is stored exactly as the site serves it, along with every image, file and cover
it references. The importer turns those into typed AppFlowy content: document
blocks, and databases with their fields, views, rows and row pages.

## Coverage

Snapshot of the catalog fetched 2026-11-08 from the template-center API.

| | Count |
| --- | --- |
| Catalog entries (`/api/template-center/template`) | 52 |
| Downloaded payloads | 50 (25 documents, 25 databases) |
| Not downloadable | 2 (listed below) |
| Media assets bundled | 20 files, 21,566,444 bytes: 19 images and 1 PDF |
| Previews | 50: 16 with a bundled image, 34 with a content summary |
| Categories (`/api/template-center/category`) | 15 |

Not downloadable, with the reason recorded in `manifest.json`:

- **Social Media Calendar** (`Social-Media-Calendar-4f3a86ee-…`): the snapshot
  endpoint returns `Invalid request: published database relation is missing`.
  The page is listed on the site but its database relation is not published.
- **Eisenhower Matrix** (`Eisenhower-Matrix-d9085311-…`): marked unpublished in
  the catalog (`unpublished_timestamp` set), so no snapshot is requested. The
  second Eisenhower Matrix (`Eisenhower-Matrix-223f4605`) is downloaded.

Both are honest gaps. They are not in the store, so the app does not offer them.

The site renders its template sections from the same catalog endpoint, so the
52 entries are the full public set.

## Files

```
assets/local_templates/
  manifest.json                 catalog, categories, availability, media list, inventory
  payloads/<publishName>.json   raw published snapshot for each downloaded template (50 files)
  media/<sha256>.<ext>          bundled image, cover and PDF bytes (20 files, ~21 MB)
scripts/local_templates/
  fetch_templates.mjs           refreshes payloads, media, previews and manifest (read-only HTTP GET)
  build_previews.mjs            recomputes previews from the bundled files, offline
  local_template_rules.mjs      checks that media really is an image or PDF; derives previews
  verify_media.mjs              re-hashes every media file, checks its type and each preview
lib/features/local_templates/
  data/                         manifest models, asset repository, converters, media writer, import service
  logic/                        Cubit and state for the store screen
  presentation/                 LocalTemplateStorePage and LocalTemplateCard (the preview card)
  local_templates.dart          barrel for the public entry point
test/features/local_templates/
  *_test.dart                   converter, repository, media, import service, Cubit and preview tests
  native_template_import_test.dart   the native backend import (see *Import fidelity*)
```

`manifest.json` records, for each catalog entry: `viewId`, `name`,
`description`, `viewUrl`, creator name, primary and all category ids and names,
`isFeatured`, `isNew`, the publish namespace and name, `kind`, the payload path,
the payload SHA-256, the entry's `mediaUrls`, and a `blocker` for entries
without a payload. The creator's name and avatar URL are kept as metadata only.
Publisher email addresses are not stored.

Each entry also has a `preview` (see *Previews*). The top-level `media` list records, for each asset: the remote `url` it came
from, the bundled `path`, `sha256`, `bytes`, `contentType`, `kind` (`image` or
`file`), and `referencedBy` (the publish names that use it). Files are named by
their SHA-256, so a changed asset gets a new name.

## Refreshing the store

From `frontend/appflowy_flutter`:

```sh
node --use-system-ca scripts/local_templates/fetch_templates.mjs
node scripts/local_templates/verify_media.mjs
```

`--use-system-ca` makes Node trust the Windows certificate store. Corporate
TLS inspection needs this; certificate checks stay on. The script rewrites
`payloads/` and `media/` from scratch, so templates and assets removed from the
site disappear. Requests are sequential with short delays and retry on 5xx and
429.

Media is strict: if any asset cannot be downloaded, the script fails and does
not write the manifest. A partial media set would leave a template that
reaches for the network, which the store must never do.

Each downloaded file must also be what the server says it is: a JPEG, PNG,
GIF or WebP by its leading bytes, or a PDF. The site answers some file-storage
URLs with its HTML shell and a 200 status, so a status check alone let two such
files in. Both affected files were downloaded again and now have valid signatures.
The importer also checks signatures before copying files into the workspace.

To re-derive previews after a change to their rules, run
`node scripts/local_templates/build_previews.mjs`. It reads the bundled files
and makes no network request.

## Media

Every asset the snapshots reference is downloaded: image blocks, file blocks,
the PDF block, page covers, and row covers. The URL hosts are
`beta.appflowy.cloud/api/file_storage/` (10 assets) and `images.unsplash.com`
(10 assets). Plain web links (link previews and references) are not assets and
stay as links.

At import the converters replace each remote URL with a durable local path:

- The importer reads the bundled bytes through the asset bundle and writes them
  with the editor's own helpers, `saveImageToLocalStorage` for images and covers
  and `saveFileToLocalStorage` for files. Each import gets its own copy under
  the app's data folder, so the user owns the file.
- An image block that became a local path is set to `image_type` 0 (local). A
  file block is set to `url_type` 0 (local). A page cover keeps its
  `CoverType.file` and now holds the local path, which the cover code reads as
  a file rather than a URL.
- The bundled `media/` folder is never referenced at runtime.

The import checks its own output. If any `beta.appflowy.cloud` or
`images.unsplash.com` URL is left in a block, the import stops with an error. A
test runs this check over all 50 payloads.

Checksums: the fetch script records a SHA-256 for each asset and names files by
it, and `verify_media.mjs` re-hashes them. The app itself checks only the byte
length at read time. Verifying the SHA-256 in Dart would need `crypto`, which
is not a declared dependency.

## Previews

Each card shows a preview taken from its own template. The catalog has no
thumbnail: the list endpoint, the single-template endpoint and the public
template page carry no preview image (checked 2026-11-08). The nearest public
images are the covers and images inside each template's snapshot, and those are
already bundled as media. So no new download was needed for previews, and every
image used has its checksum and provenance from the fetch.

Each preview is chosen in this order, by `preview.source` in the manifest:

1. **`cover`**: the page cover, when it is a bundled image. 14 templates.
2. **`image`**: the first image block whose image is bundled. 2 templates.
3. **`content`**: nothing to show. The card draws the template's colour on a
   neutral surface and a summary of its own content: the headings of a document
   (up to three) or the field names of a database (up to four, primary field
   first). 34 templates: 25 databases and 9 documents.

The colour is the cover's colour when the cover is a colour. Otherwise it is
the primary category's colour from the catalog. Some categories have no colour,
and their cards use the neutral surface. Seven documents have neither a heading
nor paragraph text, so their cards show the kind icon. No preview is invented
imagery.

The rules live in `scripts/local_templates/local_template_rules.mjs`, which the
fetch and the offline builder share. An image is used only if its bytes match
its declared type.

In the app, each preview image is read once per URL and decoded at about 640
pixels wide, because the largest bundled cover is 11 MB. If the read or the
decode fails, the card shows the content summary. An image card is labelled
"Preview of <name>". A summary card is labelled with its name and what it
contains, so a screen reader gets the same information as a sighted reader.

## Import fidelity

Verified through the real native library (the Windows DLL, not the fakes):
*API Documentation* and *Bug Tracker* import as typed content, and *Bug Tracker
Board* imports with 7 fields and 8 rows. `native_template_import_test.dart` covers
that path. The rest of this section sets out what the import keeps and what it
does not, from the source and the fake-backed tests.

Imports go through the existing folder APIs. Each template becomes a new
top-level page under the current workspace.

**Documents** (`ViewLayoutPB.Document`, `DocumentDataPB` bytes, through
`ImportBackendService.importPages`). The snapshot's `document.raw.data` already
has the `DocumentDataPB` shape, so the block tree, rich text, children and text
deltas are carried over unchanged. Media is localized as described above.

Not restored:

- **Embedded database blocks.** Three document blocks embed a database view
  that is not part of the document snapshot: a calendar in *Blog Editorial
  Calendar*, and a grid in *Fundraising tracker* and in *User Interview*. Those
  views are not in the store (no payload carries their ids), so they stay
  dangling and may render empty.

**Databases** (`ViewLayoutPB.Grid` / `Board` / `Calendar`, created through
`ViewBackendService.createView` with `initialDataBytes`). The backend's folder
create-view API takes a `DatabaseData` JSON as initial data when the meta is
empty. The converter builds that JSON from the snapshot's raw collab state
(`database.raw`), so it keeps:

- **Fields** with their stored type and type options: select options with
  colours, number formats, date and time formats, checkbox, URL, checklist
  items, and the field's icon and primary flag. Field ids stay, because they
  are only unique inside a database.
- **Views** the page lists, in the page's order. Each keeps its layout (grid,
  board or calendar), name, field order, field settings (visibility and width),
  row order and row heights, and its filters, sorts and group settings. Calendar
  layout settings (date field, week start) are kept. The first listed view
  becomes the folder page's layout.
- **Rows** with their typed cells, creation and edit times, heights and
  visibility. Single-select and multi-select cells keep their option ids, which
  match the field's options.
- **Row pages** for the rows that have content (13 rows across 7 databases).
  Each page is created under the id the backend derives from its row
  (`UUIDv5(rowId, "document_id")`), and its row is flagged as having a page, so
  the row shows the page indicator.

Ids are fresh on every import (database, view and row), so importing the same
template twice gives two independent databases. Relation cells that point at
rows of the same database are remapped to the new row ids.

Not restored, or only partly:

- **Hidden views.** 22 raw views across 20 databases are not listed on the
  published page, and are not imported. Most are unnamed internal views. The
  named ones are *Calendar* (Class Notes), *in progress* and *View of Projects*
  (Projects). The count is reported in `fidelity.hiddenViewCount`.
- **Relations to other databases.** 9 relation fields across 6 databases point
  at 8 distinct databases. None of those databases is in the store, and a
  single template import does not bring in its neighbours. The relation type
  options keep the target id, so the references are dangling. Relation cells
  keep their raw row ids, and `fidelity.unresolvedRelationCellCount` counts
  them.
- **Rollup and formula fields.** 29 fields across 7 databases use field types
  16 (rollup) and 19 (formula). This build's `FieldType` has no entries for
  them. The backend's conversion falls back to a text field and logs an error,
  so they are expected to show as text holding the stored values, not as
  computed columns. The values are kept as stored and counted in
  `fidelity.unsupportedFieldCount`. I read this in the backend source. I have
  not seen it on screen.
- **Row comments.** The snapshots carry no row comments (the store has none),
  so nothing is lost there. `fidelity.droppedCommentCount` counts any that appear.
- **Creator avatars and thumbnails.** The store page does not render them, so
  they are not downloaded. The URLs stay in the manifest as metadata only.
- **Reactions and live state** are not part of the snapshot and are not
  imported.
- **No automatic refresh.** The store is a snapshot from the fetch date in
  `manifest.json` (`source.fetchedAt`). Run the script to update it.

## Integrating

These are the parent's steps. Nothing outside the owned paths has been changed
for this work.

1. **Assets are declared** in `pubspec.yaml`. Flutter does not include
   subfolders recursively, so all three folders are listed. This is already in
   place:

   ```yaml
   flutter:
     assets:
       - assets/local_templates/
       - assets/local_templates/payloads/
       - assets/local_templates/media/
   ```

   Without the last line, `rootBundle` cannot load the media and every image,
   file and cover in the store fails to import with a "could not import" message.

2. **Entry point** (already wired; listed for reference). The page takes the signed-in user's
   `UserProfilePB`:

   ```dart
   import 'package:appflowy/features/local_templates/local_templates.dart';

   LocalTemplateStorePage(user: userProfile)
   ```

   It resolves the parent with `UserBackendService.getCurrentWorkspace()` when
   importing, so it follows workspace switches. Add the route or sidebar entry
   in your own change.

3. **Localization.** The page's strings are plain English for now: "Template
   store", "Search templates", "Import", "Imported \"…\".", "No templates
   match." and the stat line. Move them into `locale_keys` when the feature is
   wired up.

4. **Dependency validation.** The feature imports `bloc`, `flutter_bloc`,
   `equatable`, `appflowy_backend`, `appflowy_result`, `flowy_infra`,
   `flowy_infra_ui` and `path`, which the app already declares. The UUIDv5
   derivation and SHA-1 are written in the converter, so no `uuid` import is
   needed. `uuid` is only listed under `dependency_overrides`, which the
   analyzer does not count as a dependency.

## Verification

```sh
D:/Tools/flutter/bin/flutter.bat analyze --no-pub lib/features/local_templates test/features/local_templates
D:/Tools/flutter/bin/flutter.bat test --no-pub test/features/local_templates
node scripts/local_templates/verify_media.mjs
node scripts/local_templates/build_previews.mjs # offline; rewrites only the previews
```

The preview tests check that every preview names a bundled image of its own
template, that no preview points at a site shell, that every chosen image
decodes, and that a content summary names the template's fields. Widget tests
cover the image, the summary, an image that fails to load, and that import
still works and is disabled for unavailable templates.

The tests read the real bundled manifest, payloads and media, so they catch a
store that drifts from its files. They check that every payload's asset URL is
bundled and attributed, that every bundled asset is referenced, that each file
has its recorded size, that the UUIDv5 derivation reproduces the snapshot's own
row page ids, that the SHA-1 matches the RFC 4122 vector, that typed selects
point at their options, and that no remote asset URL survives an import of any
payload. Most tests use fakes for backend calls. The separate native test exercises
the real Windows DLL with two representative imports. Visual inspection
of every template remains outside this verification.

## Repaired media

An earlier fetch received HTML shells for the Internal Customer Onboarding
Checklist cover and the Effective 1-1 Meeting PDF. Both source URLs now return
valid files. They were downloaded again with certificate checks enabled,
re-hashed, and replaced in the bundle. The cover is 69,948 bytes of WebP; the
attachment is 172,991 bytes of PDF. All 20 media assets pass signature and
checksum verification. The importer rejects invalid media instead of copying
it into the user's workspace.

## Known limitations (summary)

- The native test verifies the API Documentation document and Bug Tracker
  database import. It does not exercise every template or all layouts.
- Layout settings keys are the snapshot's own (layout numbers as strings). They
  are passed through as stored.
- Embedded database blocks, relations to other databases, and hidden views are
  not recoverable from the store. See *Import fidelity*.
- Rollup and formula columns show as text, not computed values.
- Previews are the template's own covers or a summary of its content. The
  catalog has no thumbnails, so the store cannot show the site's card art, and
  the 25 database cards have no image.

// Import panel (menu/sidebar/import/import_panel.dart, import_type.dart). Release builds offer
// "Text & Markdown" and "CSV"; the v0.1.0 history formats are debug-only and not ported.
import { create, toBinary } from '@bufbuild/protobuf';
import { useEffect, useRef, useState } from 'react';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ImportItemPayloadPBSchema, ImportTypePB, type ImportItemPayloadPB } from '@shared/protobuf/flowy-folder/import_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FileText, Table2, type LucideIcon } from 'lucide-react';
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { DocumentEventConvertDataToDocument, FolderEventImportData } from '@/backend/events';
import { useTr } from '@/i18n';
import { MaterialDialog, Spinner, showDialog } from '@/ui';
import { markdownToEditorJson } from './markdown';

interface ImportTypeInfo {
  key: string;
  /** Source format icon. */
  icon: LucideIcon;
  extensions: string[];
}

const IMPORT_TYPES: Record<'markdownOrText' | 'csv', ImportTypeInfo> = {
  markdownOrText: { key: 'importPanel.textAndMarkdown', icon: FileText, extensions: ['md', 'txt'] },
  csv: { key: 'importPanel.csv', icon: Table2, extensions: ['csv'] },
};

const basenameWithoutExtension = (path: string) => {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
};

/** customMarkdownToDocument → DocumentDataPB bytes. */
async function documentBytesFromMarkdown(markdown: string): Promise<Uint8Array | null> {
  const json = JSON.stringify(markdownToEditorJson(markdown));
  const result = await DocumentEventConvertDataToDocument({ convertType: 0, data: new TextEncoder().encode(json) });
  return result.ok ? toBinary(DocumentDataPBSchema, result.value) : null;
}

async function importFiles(parentViewId: string, type: keyof typeof IMPORT_TYPES, paths: string[]) {
  const items: ImportItemPayloadPB[] = [];
  for (const path of paths) {
    const text = await window.appflowy.fs.readText(path);
    if (text === null) continue;
    const name = basenameWithoutExtension(path);
    if (type === 'markdownOrText') {
      const bytes = await documentBytesFromMarkdown(text);
      if (bytes) {
        items.push(
          create(ImportItemPayloadPBSchema, {
            name,
            oneOfData: { case: 'data', value: bytes },
            viewLayout: ViewLayoutPB.Document,
            importType: ImportTypePB.Markdown,
          }),
        );
      }
    } else {
      items.push(
        create(ImportItemPayloadPBSchema, {
          name,
          oneOfData: { case: 'data', value: new TextEncoder().encode(text) },
          viewLayout: ViewLayoutPB.Grid,
          importType: ImportTypePB.CSV,
        }),
      );
    }
  }
  // Errors are not surfaced, as in Flutter.
  if (items.length > 0) await FolderEventImportData({ parentViewId, items });
}

function ImportPanel({ parentViewId, onImported, close }: { parentViewId: string; onImported: () => void; close: () => void }) {
  const { tr } = useTr();
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const width = window.innerWidth * 0.7;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="relative outline-none"
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <div className="grid gap-2" style={{ width }}>
        {(Object.keys(IMPORT_TYPES) as Array<keyof typeof IMPORT_TYPES>).map((type) => {
          const info = IMPORT_TYPES[type];
          return (
            <Item key={type} variant="outline" render={<button type="button" />} className="cursor-default hover:bg-accent"
                onClick={async () => {
                  const paths = await window.appflowy.dialog.pickFiles({
                    filters: [{ name: tr(info.key), extensions: info.extensions }],
                    multiple: true,
                  });
                  if (paths.length === 0) return;
                  setLoading(true);
                  await importFiles(parentViewId, type, paths);
                  setLoading(false);
                  onImported();
                  close();
                }}>
              <ItemMedia variant="icon"><info.icon className="size-5 text-muted-foreground" /></ItemMedia>
              <ItemContent><ItemTitle>{tr(info.key)}</ItemTitle></ItemContent>
            </Item>
          );
        })}
      </div>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </div>
      )}
    </div>
  );
}

/** showImportPanel: a FlowyDialog titled "Import"; `callback` runs after a successful pick and import. */
export function showImportPanel(parentViewId: string, callback: () => void) {
  showDialog((close) => (
    <MaterialDialog radius={12}>
      <div className="px-4 pt-4">
        <ImportTitle />
      </div>
      <div className="p-4">
        <ImportPanel parentViewId={parentViewId} onImported={callback} close={close} />
      </div>
    </MaterialDialog>
  ));
}

function ImportTitle() {
  const { tr } = useTr();
  return (
    <h2 className="text-xl font-semibold">
      {tr('moreAction.import')}
    </h2>
  );
}

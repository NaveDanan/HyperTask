// Import panel (menu/sidebar/import/import_panel.dart, import_type.dart). Release builds offer
// "Text & Markdown" and "CSV"; the v0.1.0 history formats are debug-only and not ported.
import { create, toBinary } from '@bufbuild/protobuf';
import { useEffect, useRef, useState } from 'react';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ImportItemPayloadPBSchema, ImportTypePB, type ImportItemPayloadPB } from '@shared/protobuf/flowy-folder/import_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { DocumentEventConvertDataToDocument, FolderEventImportData } from '@/backend/events';
import { useTr } from '@/i18n';
import { FlowyButton, FlowySvg, FlowyText, MaterialDialog, Spinner, showDialog } from '@/ui';
import { markdownToEditorJson } from './markdown';

interface ImportTypeInfo {
  key: string;
  /** ImportType.icon (the icons look swapped in Dart; kept as is). */
  icon: FlowySvgName;
  extensions: string[];
}

const IMPORT_TYPES: Record<'markdownOrText' | 'csv', ImportTypeInfo> = {
  markdownOrText: { key: 'importPanel.textAndMarkdown', icon: 'text_s', extensions: ['md', 'txt'] },
  csv: { key: 'importPanel.csv', icon: 'board_s', extensions: ['csv'] },
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
      style={{ outline: 'none', position: 'relative' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <div
        style={{
          width,
          height: width * 0.5,
          background: 'var(--cs-surface)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridAutoRows: width / 2 / 5,
          alignContent: 'start',
        }}
      >
        {(Object.keys(IMPORT_TYPES) as Array<keyof typeof IMPORT_TYPES>).map((type) => {
          const info = IMPORT_TYPES[type];
          return (
            <div key={type} style={{ margin: 4, borderRadius: 4, background: 'var(--th-card)', boxShadow: '0 1px 3px #0000001F, 0 1px 1px #00000024' }}>
              <FlowyButton
                height={width / 2 / 5 - 8}
                leftIcon={<FlowySvg svg={info.icon} size={20} color="var(--cs-tertiary)" />}
                leftIconSize={20}
                text={
                  <FlowyText fontWeight={500} fontSize={15} ellipsis color="var(--cs-tertiary)">
                    {tr(info.key)}
                  </FlowyText>
                }
                onTap={async () => {
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
                }}
              />
            </div>
          );
        })}
      </div>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner />
        </div>
      )}
    </div>
  );
}

/** showImportPanel: a FlowyDialog titled "Import"; `callback` runs after a successful pick and import. */
export function showImportPanel(parentViewId: string, callback: () => void) {
  showDialog((close) => (
    <MaterialDialog radius={16} background="var(--cs-surface)" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '20px 20px 0' }}>
        <ImportTitle />
      </div>
      <div style={{ padding: '10px 20px' }}>
        <ImportPanel parentViewId={parentViewId} onImported={callback} close={close} />
      </div>
    </MaterialDialog>
  ));
}

function ImportTitle() {
  const { tr } = useTr();
  return (
    <FlowyText fontWeight={600} fontSize={20} color="var(--cs-tertiary)">
      {tr('moreAction.import')}
    </FlowyText>
  );
}

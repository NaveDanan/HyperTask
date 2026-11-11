// Import panel (menu/sidebar/import/import_panel.dart, import_type.dart), including reviewed
// HTML imports. The v0.1.0 history formats remain unported.
import { useEffect, useRef, useState } from 'react';
import { FileText, Table2, type LucideIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { useTr } from '@/i18n';
import { MaterialDialog, Spinner, showDialog } from '@/ui';
import { HyperDocumentHtmlImport } from '../../document-import/HyperDocumentHtmlImport';
import { HyperDocumentFileImporter, hyperDocumentFileImportStrings, hyperImportFilename, type HyperDocumentFileImportReport } from '../../document-import/HyperDocumentFileImporter';

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

export function ImportPanel({ parentViewId, onImported, close }: { parentViewId: string; onImported: () => void; close: () => void }) {
  const { tr } = useTr();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<HyperDocumentFileImportReport | null>(null), [error, setError] = useState<string | null>(null);
  const [importer] = useState(() => new HyperDocumentFileImporter());
  const operation = useRef<AbortController | null>(null), alive = useRef(true), destination = useRef(parentViewId);
  const text = (key: keyof typeof hyperDocumentFileImportStrings, count = 0) => {
    const id = `hyperDocumentFileImport.${key}`, translated = tr(id, { namedArgs: { count } });
    return (translated === id ? hyperDocumentFileImportStrings[key] : translated).replaceAll('{count}', String(count));
  };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  useEffect(() => {
    alive.current = true;
    if (destination.current !== parentViewId) { destination.current = parentViewId; setLoading(false); setReport(null); setError(null); }
    return () => { alive.current = false; operation.current?.abort(); operation.current = null; };
  }, [parentViewId]);
  const uncertain = report?.failures.some(failure => failure.uncertain) === true;
  const choose = async (type: keyof typeof IMPORT_TYPES) => {
    if (operation.current || uncertain) return;
    const controller = new AbortController(); operation.current = controller;
    const current = () => alive.current && operation.current === controller && !controller.signal.aborted;
    setLoading(true); setReport(null); setError(null);
    try {
      const target = await importer.capture(parentViewId, controller.signal, current);
      const info = IMPORT_TYPES[type];
      const paths = await window.appflowy.dialog.pickFiles({ filters: [{ name: tr(info.key), extensions: info.extensions }], multiple: true });
      if (!current() || !paths.length) return;
      const result = await importer.importFiles(target, type, paths, controller.signal, current);
      if (!current()) return;
      setReport(result);
      if (result.imported.length) onImported();
      if (!result.cancelled && !result.failures.length && result.imported.length) close();
    } catch (error) {
      if (current()) setError((error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error));
    } finally {
      if (operation.current === controller) { operation.current = null; if (alive.current) setLoading(false); }
    }
  };
  const width = window.innerWidth * 0.7;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="relative space-y-3 outline-none"
      aria-busy={loading}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!loading) close(); }
      }}
    >
      <div className="grid gap-2" style={{ width }}>
        <HyperDocumentHtmlImport parentViewId={parentViewId} editable={!loading && !uncertain} onImported={() => onImported()} onClose={close} />
        {(Object.keys(IMPORT_TYPES) as Array<keyof typeof IMPORT_TYPES>).map((type) => {
          const info = IMPORT_TYPES[type];
          return (
            <Item key={type} variant="outline" render={<button type="button" disabled={loading || uncertain} />} className="cursor-default hover:bg-accent"
                onClick={() => void choose(type)}>
              <ItemMedia variant="icon"><info.icon className="size-5 text-muted-foreground" /></ItemMedia>
              <ItemContent><ItemTitle>{tr(info.key)}</ItemTitle></ItemContent>
            </Item>
          );
        })}
      </div>
      {(error || report?.failures.length) ? <Alert variant="destructive"><AlertTitle>{text('failed')}</AlertTitle><AlertDescription>
        {error && <p>{error}</p>}
        {!!report?.imported.length && <p>{text('imported', report.imported.length)} {text('remaining')}</p>}
        {report?.failures.map((failure, index) => <p key={index} className="break-words">{hyperImportFilename(failure.path)}: {failure.message}</p>)}
        {uncertain && <p>{text('uncertain')}</p>}
        <Button variant="outline" size="sm" disabled={loading} onClick={close}>{text('close')}</Button>
      </AlertDescription></Alert> : null}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span role="status" className="flex items-center gap-2 rounded-lg bg-background p-3 text-sm"><Spinner />{text('importing')}</span>
        </div>
      )}
    </div>
  );
}

/** `callback` runs only after the core confirms created pages, including partial imports. */
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

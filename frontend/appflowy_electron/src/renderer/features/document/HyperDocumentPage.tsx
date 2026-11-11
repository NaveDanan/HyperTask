import { HyperDocumentBookmark, HyperDocumentBookmarkBlock, hyperDocumentBookmarkStrings, hyperOpenDocumentBookmark } from '../document-bookmark/HyperDocumentBookmark';
import { hyperBookmarkTypes } from '../document-bookmark/HyperDocumentBookmarkValue';
import { hyperCaptureBookmarkInsertion } from '../document-bookmark/HyperDocumentBookmarkModel';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Bold, ChevronDown, Code, Italic, MoreHorizontal, Plus, Redo2, Strikethrough, Underline, Undo2 } from 'lucide-react';
import type { BlockPB, DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { useTr } from '@/i18n';
import { cn } from '@/lib/utils';
import { nameOrDefault } from '../view/view-ext';
import { isEditable, viewIsLocked } from '../view-header/page-access-level-store';
import { usePageAccessLevel, useViewPluginNotifier, useViewScope } from '../view-header/view-scope';
import { useDocumentFontSize } from '../view-header/document-appearance-store';
import { DocumentBanner, deletePermanently, restorePage } from '../plugins/DocumentBanner';
import type { PluginContext } from '../plugins/registry';
import {
  hyperBlockData, hyperBlockText, hyperCanEditDocumentText, hyperChildren, hyperDeleteBlock, hyperDocumentPlainText, hyperEditText, hyperFormatText,
  hyperInsertBlock, hyperMarkdownShortcut, hyperMergeWithPrevious, hyperMoveBlock, hyperPlainText, hyperSliceText, hyperSplitBlock, hyperTextTypes, hyperUpdateBlock,
  type HyperDocumentChange, type HyperTextRun,
} from './HyperDocumentModel';
import { acquireHyperDocument, HyperDocumentSession } from './HyperDocumentSession';
import { HyperDocumentRecovery } from './HyperDocumentRecovery';
import { hyperDocumentOwnerKey, useHyperDocumentOwner } from './HyperDocumentOwner';
import { hyperExportDocument, hyperSafeUrl } from './HyperDocumentExport';
import { hyperGetSelection, hyperReadText, hyperSetSelection, hyperWriteText, type HyperTextSelection } from './HyperDocumentDom';
import { hyperAddTableColumn, hyperAddTableRow, hyperDeleteTableColumn, hyperDeleteTableRow, hyperInsertTable, hyperSetTableColumnWidth, hyperTableCellLocation } from './HyperDocumentTable';
import { HyperWhiteboard } from '../whiteboard/HyperWhiteboard';
import { HyperDocumentAI } from '../document-ai/HyperDocumentAI';
import { HyperDocumentLinks } from '../document-links/HyperDocumentLinks';
import { HyperDocumentFormat } from '../document-format/HyperDocumentFormat';
import { hyperApplyDocumentFormat, hyperCaptureDocumentFormat } from '../document-format/HyperDocumentFormatModel';
import { HyperDocumentDatabaseBlock, HyperDocumentDatabaseInsert } from '../document-database/HyperDocumentDatabase';
import { HyperDocumentMediaBlock, HyperDocumentMediaInsert } from '../document-media/HyperDocumentMedia';
import { hyperCaptureDocumentMediaAnchor, hyperInsertDocumentMedia, hyperIsDocumentMedia, type HyperDocumentMediaAnchor } from '../document-media/HyperDocumentMediaModel';
import { hyperCaptureDocumentDatabaseAnchor, hyperInsertDocumentDatabase, hyperIsDocumentDatabase, type HyperDocumentDatabaseAnchor } from '../document-database/HyperDocumentDatabaseModel';
import { HyperDocumentOutline } from '../document-outline/HyperDocumentOutline';
import { hyperDocumentOutline, type HyperDocumentHeading } from '../document-outline/HyperDocumentOutlineModel';
import { hyperCaptureMentionSelection, hyperDocumentMentionStrings, HyperDocumentMentionResolver, hyperInsertMentionAtSelection, type HyperMentionSelection } from './HyperDocumentMentions';
import { HyperDocumentSlash } from '../document-slash/HyperDocumentSlash';
import { HyperDocumentBlockControls } from '../document-block-controls/HyperDocumentBlockControls';
import { hyperCanControlDocumentBlock } from '../document-block-controls/HyperDocumentBlockControlsModel';
import { hyperApplyDocumentSlash, hyperCaptureDocumentSlash, hyperDocumentSlashMatches, hyperUpdateDocumentSlashQuery, type HyperDocumentSlashCommand, type HyperDocumentSlashTarget } from '../document-slash/HyperDocumentSlashModel';
import { HyperDocumentColumnWidths, HyperDocumentColumnsMenuItems, hyperDocumentColumnsStrings } from '../document-columns/HyperDocumentColumns';
import { hyperCaptureDocumentColumnsInsertion, hyperDocumentColumnsInsertionMatches, hyperInsertDocumentColumns, hyperReadDocumentColumns, type HyperDocumentColumnCount, type HyperDocumentColumnsInsertion } from '../document-columns/HyperDocumentColumnsModel';
import { HyperDocumentDate, hyperDocumentDateStrings, hyperOpenDocumentDatePicker } from '../document-date/HyperDocumentDate';
import { HyperDocumentReminderRecovery } from '../document-date/HyperDocumentReminderRecovery';
import { HyperDocumentEquation, HyperDocumentEquationBlock, hyperDocumentEquationStrings, hyperOpenDocumentEquation } from '../document-equation/HyperDocumentEquation';
import { HyperDocumentFootnote, HyperDocumentFootnoteList, hyperOpenDocumentFootnote } from '../document-footnote/HyperDocumentFootnote';
import { hyperCaptureFootnoteInsertion } from '../document-footnote/HyperDocumentFootnoteModel';
import { hyperDocumentFootnoteStrings } from '../document-footnote/HyperDocumentFootnoteStrings';
import { HyperInlineMath } from '../document-inline-math/HyperInlineMath';
import { hyperCaptureInlineMath, hyperCaptureInlineMathInsertion } from '../document-inline-math/HyperInlineMathModel';
import { hyperInlineMathTextEditable } from '../document-inline-math/HyperInlineMathDom';
import { hyperInlineMathStrings, useHyperInlineMathText } from '../document-inline-math/HyperInlineMathStrings';
import { hyperInlineMathWithinAtomLimit } from '../document-inline-math/HyperInlineMathValue';
import { hyperCaptureEquationInsertion, hyperReadDocumentEquation } from '../document-equation/HyperDocumentEquationModel';
import { HyperDocumentCodeControls } from '../document-code/HyperDocumentCode';
import { hyperCaptureDocumentCode, hyperIndentDocumentCode } from '../document-code/HyperDocumentCodeModel';
import { HyperDocumentCodeSyntax } from '../document-code/HyperDocumentCodeSyntax';

const blockKinds = [
  ['paragraph', 'text'], ['heading', 'heading1', 1], ['heading', 'heading2', 2], ['heading', 'heading3', 3],
  ['bulleted_list', 'bulletedList'], ['numbered_list', 'numberedList'], ['todo_list', 'todoList'],
  ['toggle_list', 'toggleList'], ['quote', 'quote'], ['callout', 'callout'], ['code', 'code'], ['divider', 'divider'], ['simple_table', 'table'],
] as const;
type HyperActiveBlock = { id: string; selection: HyperTextSelection };
interface HyperOutlineRequest { heading: HyperDocumentHeading }

export function HyperDocumentPage({ view, context, renderHeader }: { view: ViewPB; context: PluginContext; renderHeader?(session: HyperDocumentSession, view: ViewPB, editable: boolean): React.ReactNode }) {
  const { tr } = useTr();
  const [mode, setMode] = useState<'page' | 'canvas'>('page');
  const [session, setSession] = useState<HyperDocumentSession | null>(null);
  const owner = useHyperDocumentOwner();
  const ownerKey = hyperDocumentOwnerKey(owner);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const notifier = useViewPluginNotifier(), scope = useViewScope();
  const access = usePageAccessLevel();
  const [bannerHidden, setBannerHidden] = useState(false);
  const deleted = notifier?.isDeleted;
  const current = notifier?.view ?? view;
  useEffect(() => {
    if (!owner) return;
    let cancelled = false, release: (() => void) | undefined;
    setLoadError(null);
    void acquireHyperDocument(view.id, owner).then(lease => {
      if (cancelled) lease.release();
      else { release = lease.release; setSession(lease.session); }
    }).catch(error => {
      if (!cancelled && owner.isCurrent()) setLoadError({ key: `${ownerKey}:${view.id}`, message: (error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error) });
    });
    return () => { cancelled = true; release?.(); };
  }, [view.id, owner, ownerKey]);
  useEffect(() => setBannerHidden(false), [deleted]);
  const editable = !deleted && (access ? !access.isLoadingLockStatus && isEditable(access) : !viewIsLocked(current));
  return <div className="flex h-full flex-col">
    {deleted && !bannerHidden && <DocumentBanner viewName={nameOrDefault(current)} onRestore={() => {
      void restorePage(current).then(ok => { if (ok) { setBannerHidden(true); scope?.notifier.setState({ isDeleted: null }); } });
    }} onDelete={() => {
      void deletePermanently(current).then(ok => { if (ok) context.onDeleted?.(current, deleted.oneOfIndex.case === 'index' ? deleted.oneOfIndex.value : undefined); });
    }} />}
    {owner && session?.id === view.id && session.belongsTo(owner) ? <>
      <div className="flex shrink-0 gap-1 border-b px-8 py-1" role="group" aria-label={tr('hyperDocument.mode')}>
        <Button size="sm" variant={mode === 'page' ? 'secondary' : 'ghost'} aria-pressed={mode === 'page'} onClick={() => setMode('page')}>{tr('hyperDocument.pageMode')}</Button>
        <Button size="sm" variant={mode === 'canvas' ? 'secondary' : 'ghost'} aria-pressed={mode === 'canvas'} onClick={() => setMode('canvas')}>{tr('hyperDocument.canvasMode')}</Button>
      </div>
      {mode === 'page' ? <HyperDocumentEditor key={`${ownerKey}:${view.id}`} session={session} title={nameOrDefault(current)} editable={editable} header={renderHeader?.(session, current, editable)} /> : <>
        <HyperDocumentReminderRecovery session={session} canWrite={() => editable} />
        <HyperWhiteboard key={`${ownerKey}:${view.id}`} session={session} editable={editable} />
      </>}
    </> : loadError?.key === `${ownerKey}:${view.id}` ? <Alert variant="destructive" className="m-4 w-auto"><AlertDescription>{loadError.message}</AlertDescription></Alert> : <div className="flex justify-center p-8"><Spinner /></div>}
  </div>;
}

export function HyperDocumentEditor({ session, title, editable, rowScope, header }: { session: HyperDocumentSession; title: string; editable: boolean; rowScope?: { viewId: string; rowId: string }; header?: React.ReactNode }) {
  const { tr } = useTr();
  const state = useStore(session.store);
  const { fontSize } = useDocumentFontSize();
  const host = useRef<HTMLDivElement>(null);
  const active = useRef<HyperActiveBlock | null>(null);
  const [aiSelection, setAISelection] = useState<HyperActiveBlock | null>(null);
  const [slash, setSlash] = useState<HyperDocumentSlashTarget | null>(null);
  const slashTarget = useRef<HyperDocumentSlashTarget | null>(null), dismissedSlash = useRef<string | null>(null);
  const [slashAnchor, setSlashAnchor] = useState({ left: 0, top: 0 });
  const [actionError, setActionError] = useState<string | null>(null);
  const previousStatus = useRef(state.status);
  useLayoutEffect(() => {
    if (previousStatus.current === 'error' && state.status === 'ready') setActionError(null);
    previousStatus.current = state.status;
  }, [state.status]);
  const [outlineRequest, setOutlineRequest] = useState<HyperOutlineRequest | null>(null);
  const [blockComposing, setBlockComposing] = useState(false);
  const canEdit = editable && !state.historyPending && state.status !== 'error' && state.status !== 'loading';
  const editableNow = useRef(canEdit); editableNow.current = canEdit;
  const blockEditableNow = useRef(canEdit && !blockComposing); blockEditableNow.current = canEdit && !blockComposing;
  const closeSlash = () => { slashTarget.current = null; setSlash(null); };
  const dismissSlash = (restoreFocus: boolean) => {
    const target = slashTarget.current;
    dismissedSlash.current = target?.blockId ?? null; closeSlash();
    if (restoreFocus && target) requestAnimationFrame(() => {
      const doc = session.store.getState().document, block = doc?.blocks[target.blockId];
      const element = Array.from(host.current?.querySelectorAll<HTMLElement>('[data-hyper-text]') ?? []).find(element => element.dataset.hyperText === target.blockId);
      if (block && doc && element) {
        const offset = hyperPlainText(hyperBlockText(doc, block)).length;
        element.focus(); hyperSetSelection(element, { start: offset, end: offset });
        active.current = { id: target.blockId, selection: { start: offset, end: offset } };
      }
    });
  };
  useEffect(() => { closeSlash(); dismissedSlash.current = null; }, [session]);
  useEffect(() => {
    if (slash && (!canEdit || !state.document || !hyperDocumentSlashMatches(state.document, slash))) dismissSlash(false);
  }, [slash, canEdit, state.document]);
  const mentionTarget = useRef<HyperMentionSelection | null>(null);
  const databaseTarget = useRef<HyperDocumentDatabaseAnchor | null>(null);
  const mediaTarget = useRef<HyperDocumentMediaAnchor | null>(null);
  const columnsTarget = useRef<HyperDocumentColumnsInsertion | null>(null);
  const mentionTargetError = useRef<string | null>(null);
  const mentions = useMemo(() => new HyperDocumentMentionResolver(), [session]);
  useEffect(() => () => mentions.dispose(), [mentions]);
  const mentionLabels = Object.fromEntries(Object.entries(hyperDocumentMentionStrings).map(([name, fallback]) => {
    const key = `hyperDocumentMentions.${name}`, translated = tr(key);
    return [name, translated === key ? fallback : translated];
  })) as { [K in keyof typeof hyperDocumentMentionStrings]: string };
  useEffect(() => mentions.setLabels(mentionLabels), [mentions, mentionLabels.loading, mentionLabels.unavailable, mentionLabels.untitled, mentionLabels.open]);
  const captureLinkTarget = () => {
    const doc = session.store.getState().document;
    mentionTargetError.current = null;
    try { mentionTarget.current = doc ? hyperCaptureMentionSelection(doc, active.current) : null; }
    catch (error) { mentionTargetError.current = error instanceof Error ? error.message : String(error); setActionError(mentionTargetError.current); }
  };
  const selectionSource = (doc: DocumentDataPB | null) => {
    const block = aiSelection && doc?.blocks[aiSelection.id];
    if (!block || !aiSelection || !doc) return { text: '', key: '' };
    const runs = hyperBlockText(doc, block), { start, end } = aiSelection.selection;
    return { text: hyperPlainText(hyperSliceText(runs, start, end)), key: `${block.id}:${start}:${end}:${JSON.stringify(runs)}` };
  };
  const selectedSource = selectionSource(state.document);
  let documentText = '';
  try { if (state.document) documentText = hyperDocumentPlainText(state.document); }
  catch { /* Invalid trees remain visible as errors; do not send partial context to AI. */ }
  const change = (build: (doc: DocumentDataPB) => HyperDocumentChange) => {
    if (!canEdit) return;
    try {
      const result = session.change(build);
      if (result?.focus) requestAnimationFrame(() => {
        const element = host.current?.querySelector<HTMLElement>(`[data-hyper-text="${result.focus!.id}"]`);
        if (element) { element.focus(); hyperSetSelection(element, { start: result.focus!.offset, end: result.focus!.offset }); }
      });
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
  };
  const insert = (type: string, level?: number) => change(doc => {
    const block = active.current && doc.blocks[active.current.id];
    const root = doc.blocks[doc.pageId];
    const parent = block?.parentId ?? doc.pageId, previous = block?.id ?? hyperChildren(doc, root).at(-1) ?? '';
    return type === 'simple_table' ? hyperInsertTable(doc, parent, previous) : hyperInsertBlock(doc, parent, previous, type, level ? { level } : {});
  });
  const captureColumnsTarget = () => {
    columnsTarget.current = null;
    try {
      const doc = session.store.getState().document;
      if (!doc || !editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
      const block = active.current ? doc.blocks[active.current.id] : undefined;
      if (active.current && !block) throw new Error(tr('hyperDocument.staleSelection'));
      columnsTarget.current = hyperCaptureDocumentColumnsInsertion(doc, block?.parentId ?? doc.pageId, block?.id ?? hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? '');
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
  };
  const insertColumns = (count: HyperDocumentColumnCount) => change(doc => {
    const target = columnsTarget.current;
    if (!editableNow.current || !target || !hyperDocumentColumnsInsertionMatches(doc, target)) throw new Error(tr('hyperDocument.staleSelection'));
    return hyperInsertDocumentColumns(doc, target.parentId, target.previousId, count);
  });
  const convert = (id: string, type: string, level?: number) => {
    if (type === 'simple_table') { insert(type); return; }
    change(doc => {
      const formula = doc.blocks[id]?.ty === 'math_equation' && hyperTextTypes.has(type) ? hyperReadDocumentEquation(doc, id) : null;
      const converted = hyperUpdateBlock(doc, id, level ? { level } : {}, type);
      if (formula === null) return converted;
      const text = hyperEditText(converted.document, id, [{ insert: formula }]);
      return { document: text.document, actions: [...converted.actions, ...text.actions], focus: { id, offset: formula.length } };
    });
    requestAnimationFrame(() => host.current?.querySelector<HTMLElement>(`[data-hyper-text="${id}"]`)?.focus());
  };
  const format = (attribute: string) => {
    const selected = active.current;
    if (!selected || selected.selection.start === selected.selection.end) return;
    change(doc => {
      const runs = hyperBlockText(doc, doc.blocks[selected.id]);
      if (!hyperInlineMathTextEditable(runs)) throw new Error(hyperInlineMathStrings.unsupportedText);
      const from = selected.selection.start, to = selected.selection.end;
      if (attribute === 'code' && hyperSliceText(runs, from, to).some(run => Object.hasOwn(run.attributes ?? {}, 'formula'))) {
        const key = 'hyperInlineMath.codeConflict', translated = tr(key); throw new Error(translated === key ? hyperInlineMathStrings.codeConflict : translated);
      }
      const same = hyperSliceText(runs, from, to).every(run => run.attributes?.[attribute] === true);
      return hyperEditText(doc, selected.id, hyperFormatText(runs, from, to, attribute, same ? null : true));
    });
    const element = host.current?.querySelector<HTMLElement>(`[data-hyper-text="${selected.id}"]`);
    if (element) { element.focus(); hyperSetSelection(element, selected.selection); }
  };
  const kinds = (onSelect: (type: string, level?: number) => void) => blockKinds.map(([type, key, level]) => <DropdownMenuItem key={`${type}-${level ?? ''}`} onClick={() => onSelect(type, level)}>{tr(`document.slashMenu.name.${key}`)}</DropdownMenuItem>);
  const slashCommands: HyperDocumentSlashCommand[] = [
    ...blockKinds.map(([type, key, level]) => ({ id: `${type}-${level ?? ''}`, type, level, label: tr(`document.slashMenu.name.${key}`) })),
    ...([2, 3, 4] as const).map(columns => {
      const key = ({ 2: 'twoColumns', 3: 'threeColumns', 4: 'fourColumns' } as const)[columns], id = `hyperDocumentColumns.${key}`, translated = tr(id);
      return { id: `simple_columns-${columns}`, type: 'simple_columns', columns, label: translated === id ? hyperDocumentColumnsStrings[key] : translated, keywords: [String(columns), `${columns}columns`] };
    }),
    { id: 'hyper_date_mention', type: 'hyper_date_mention', label: tr('hyperDocumentDate.insert') === 'hyperDocumentDate.insert' ? hyperDocumentDateStrings.insert : tr('hyperDocumentDate.insert') },
    { id: 'hyper_footnote', type: 'hyper_footnote', label: tr('hyperDocumentFootnote.insert') === 'hyperDocumentFootnote.insert' ? hyperDocumentFootnoteStrings.insert : tr('hyperDocumentFootnote.insert'), keywords: ['citation', 'reference', 'note'] },
    { id: 'link_preview', type: 'link_preview', label: tr('hyperDocumentBookmark.insert') === 'hyperDocumentBookmark.insert' ? hyperDocumentBookmarkStrings.insert : tr('hyperDocumentBookmark.insert'), keywords: ['bookmark', 'embed', 'youtube'] },
    { id: 'math_equation', type: 'math_equation', label: tr('hyperDocumentEquation.insert') === 'hyperDocumentEquation.insert' ? hyperDocumentEquationStrings.insert : tr('hyperDocumentEquation.insert') },
  ];
  const updateSlashQuery = (query: string) => {
    const target = slashTarget.current;
    if (!target || !editableNow.current || active.current?.id !== target.blockId) { dismissSlash(false); return; }
    try {
      const updated = session.change(doc => {
        if (!editableNow.current || active.current?.id !== target.blockId) throw new Error(tr('hyperDocument.readOnly'));
        return hyperUpdateDocumentSlashQuery(doc, target, query);
      });
      const next = updated && hyperCaptureDocumentSlash(updated.document, target.blockId);
      if (!next) { dismissSlash(true); return; }
      slashTarget.current = next; setSlash(next);
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); dismissSlash(false); }
  };
  const applySlash = (command: HyperDocumentSlashCommand) => {
    const target = slashTarget.current;
    if (!target || !editableNow.current || active.current?.id !== target.blockId) { dismissSlash(false); return; }
    if (command.type === 'link_preview') {
      const doc = session.store.getState().document;
      if (!doc || !hyperDocumentSlashMatches(doc, target)) { dismissSlash(false); return; }
      const insertion = hyperCaptureBookmarkInsertion(doc, target.blockId, target);
      dismissedSlash.current = target.blockId; closeSlash();
      requestAnimationFrame(() => { if (host.current && editableNow.current) hyperOpenDocumentBookmark(host.current, { insertion }); });
      return;
    }
    if (command.type === 'math_equation') {
      const doc = session.store.getState().document;
      if (!doc || !hyperDocumentSlashMatches(doc, target)) { dismissSlash(false); return; }
      const insertion = hyperCaptureEquationInsertion(doc, target.blockId, target);
      dismissedSlash.current = target.blockId; closeSlash();
      requestAnimationFrame(() => { if (host.current && editableNow.current) hyperOpenDocumentEquation(host.current, { insertion }); });
      return;
    }
    if (command.type === 'hyper_footnote') {
      const doc = session.store.getState().document;
      if (!doc || !hyperDocumentSlashMatches(doc, target)) { dismissSlash(false); return; }
      const length = hyperPlainText(hyperBlockText(doc, doc.blocks[target.blockId])).length;
      const selection = hyperCaptureMentionSelection(doc, { id: target.blockId, selection: { start: 0, end: length } });
      const insertion = hyperCaptureFootnoteInsertion(doc, selection, true);
      dismissedSlash.current = target.blockId; closeSlash();
      requestAnimationFrame(() => { if (host.current && editableNow.current) hyperOpenDocumentFootnote(host.current, { insertion }); });
      return;
    }
    if (command.type === 'hyper_date_mention') {
      const doc = session.store.getState().document;
      if (!doc || !hyperDocumentSlashMatches(doc, target)) { dismissSlash(false); return; }
      const length = hyperPlainText(hyperBlockText(doc, doc.blocks[target.blockId])).length;
      active.current = { id: target.blockId, selection: { start: 0, end: length } };
      dismissedSlash.current = target.blockId; closeSlash();
      requestAnimationFrame(() => { if (host.current && editableNow.current) hyperOpenDocumentDatePicker(host.current); });
      return;
    }
    change(doc => {
      if (!editableNow.current || active.current?.id !== target.blockId) throw new Error(tr('hyperDocument.readOnly'));
      return hyperApplyDocumentSlash(doc, target, command);
    });
    dismissedSlash.current = null; closeSlash();
  };
  const renderBlock = (id: string, ancestors: Set<string>): React.ReactNode => {
    const content = renderBlockContent(id, ancestors), doc = state.document;
    return doc && !ancestors.has(id) && hyperCanControlDocumentBlock(doc, id) ? <HyperDocumentBlockControls key={id} session={session} document={doc} blockId={id} editorHost={host} editable={canEdit && !blockComposing} isEditable={() => blockEditableNow.current} onError={setActionError}>{content}</HyperDocumentBlockControls> : content;
  };
  const renderBlockContent = (id: string, ancestors: Set<string>): React.ReactNode => {
    const doc = state.document!;
    if (ancestors.has(id) || !doc.blocks[id]) return <Alert variant="destructive" key={id}><AlertDescription>{tr('hyperDocument.invalidBlock')}</AlertDescription></Alert>;
    const block = doc.blocks[id];
    let data: Record<string, unknown>, runs: HyperTextRun[];
    try { data = hyperBlockData(block); runs = hyperBlockText(doc, block); }
    catch { return <Alert variant="destructive" key={id}><AlertDescription>{tr('hyperDocument.invalidBlock')}</AlertDescription></Alert>; }
    if (block.ty === 'hyper_canvas' && data.version === 1) return null;
    if (hyperIsDocumentDatabase(block.ty)) return <HyperDocumentDatabaseBlock key={id} document={doc} block={block} editable={canEdit} />;
    if (hyperIsDocumentMedia(block.ty)) return <HyperDocumentMediaBlock key={id} document={doc} block={block} documentId={session.id} rowScope={rowScope} editable={canEdit} onRemove={() => change(doc => hyperDeleteBlock(doc, id))} />;
    const next = new Set(ancestors).add(id);
    const children = hyperChildren(doc, block).map(child => renderBlock(child, next));
    if (hyperBookmarkTypes.has(block.ty)) return <HyperDocumentBookmarkBlock key={id} document={doc} blockId={id} documentId={session.id} editable={canEdit} onEdit={() => { if (host.current && editableNow.current) hyperOpenDocumentBookmark(host.current, { blockId: id }); }}>{children}</HyperDocumentBookmarkBlock>;
    if (block.ty === 'math_equation') return <HyperDocumentEquationBlock key={id} document={doc} blockId={id} editable={canEdit} onEdit={() => {
      active.current = { id, selection: { start: 0, end: 0 } }; setAISelection(active.current);
      if (host.current && editableNow.current) hyperOpenDocumentEquation(host.current, { blockId: id });
    }}>{children}</HyperDocumentEquationBlock>;
    if (block.ty === 'simple_table') {
      const selected = active.current && hyperTableCellLocation(doc, active.current.id);
      const location = selected?.tableId === id ? selected : null;
      const widths = data.column_widths as Record<string, unknown> | undefined;
      const width = location && typeof widths?.[location.column] === 'number' ? Number(widths[location.column]) : 160;
      return <div key={id} className="my-4 overflow-x-auto rounded-lg border">
        <Table><TableBody>{children}</TableBody></Table>
        {canEdit && <div className="flex flex-wrap items-center gap-1 border-t p-1">
          <Button variant="ghost" size="sm" onClick={() => change(doc => hyperAddTableRow(doc, id))}>{tr('hyperDocument.addRow')}</Button>
          <Button variant="ghost" size="sm" onClick={() => change(doc => hyperAddTableColumn(doc, id))}>{tr('hyperDocument.addColumn')}</Button>
          {location && <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">{tr('hyperDocument.columnWidth')}<Input key={`${id}:${location.column}:${width}`} className="w-24" type="number" min={80} max={1200} step={10} defaultValue={width} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} onBlur={event => {
            const nextWidth = Number(event.currentTarget.value);
            if (nextWidth !== width) change(doc => hyperSetTableColumnWidth(doc, id, location.column, nextWidth));
          }} /></label>}
          <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={tr('hyperDocument.tableOptions')} />}><MoreHorizontal /></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => change(doc => hyperUpdateBlock(doc, id, { enable_header_row: !data.enable_header_row }))}>{tr(data.enable_header_row ? 'hyperDocument.hideHeaderRow' : 'hyperDocument.showHeaderRow')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => change(doc => hyperUpdateBlock(doc, id, { enable_header_column: !data.enable_header_column }))}>{tr(data.enable_header_column ? 'hyperDocument.hideHeaderColumn' : 'hyperDocument.showHeaderColumn')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!location || hyperChildren(doc, block).length <= 1} variant="destructive" onClick={() => { if (location) change(doc => hyperDeleteTableRow(doc, location.rowId)); }}>{tr('hyperDocument.deleteRow')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!location || hyperChildren(doc, doc.blocks[location.rowId]).length <= 1} variant="destructive" onClick={() => { if (location) change(doc => hyperDeleteTableColumn(doc, id, location.column)); }}>{tr('hyperDocument.deleteColumn')}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => change(doc => hyperDeleteBlock(doc, id))}>{tr('hyperDocument.deleteTable')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>}
      </div>;
    }
    if (block.ty === 'simple_table_row') return <TableRow key={id}>{children}</TableRow>;
    if (block.ty === 'simple_table_cell') {
      const row = doc.blocks[block.parentId], table = row && doc.blocks[row.parentId];
      const settings = table ? hyperBlockData(table) : {};
      const headerRow = table && settings.enable_header_row === true && hyperChildren(doc, table)[0] === row.id;
      const header = headerRow || (settings.enable_header_column === true && hyperChildren(doc, row)[0] === id);
      const column = row ? hyperChildren(doc, row).indexOf(id) : -1;
      const width = (settings.column_widths as Record<string, unknown> | undefined)?.[column];
      const style = settings.distribute_column_widths_evenly === false && typeof width === 'number' && Number.isFinite(width) && width >= 80 && width <= 1200 ? { width, minWidth: width } : undefined;
      return header ? <TableHead key={id} style={style} scope={headerRow ? 'col' : 'row'} className="min-w-32 border-r align-top whitespace-normal">{children}</TableHead> : <TableCell key={id} style={style} className="min-w-32 border-r align-top whitespace-normal">{children}</TableCell>;
    }
    if (block.ty === 'simple_columns') {
      const layout = hyperReadDocumentColumns(doc, id);
      return <div key={id} data-hyper-columns={id} className="my-2">
        {(canEdit || !layout.supported) && <HyperDocumentColumnWidths session={session} document={doc} columnsId={id} editable={canEdit} isEditable={() => editableNow.current} onError={setActionError} />}
        <div className="grid gap-4 overflow-x-auto" style={{ gridTemplateColumns: layout.columns.length ? layout.columns.map(column => `minmax(0, ${column.ratio}fr)`).join(' ') : undefined }}>{children}</div>
      </div>;
    }
    if (block.ty === 'simple_column') return <div key={id} className="min-w-0">{children}</div>;
    const siblings = doc.blocks[block.parentId] ? hyperChildren(doc, doc.blocks[block.parentId]) : [];
    let ordinal = 1;
    for (let at = siblings.indexOf(id) - 1; at >= 0 && doc.blocks[siblings[at]]?.ty === 'numbered_list'; at--) ordinal++;
    if (hyperTextTypes.has(block.ty)) {
      const textEditable = hyperCanEditDocumentText(doc, block);
      const inlineEditable = block.ty === 'code' || hyperInlineMathTextEditable(runs), inlineReadOnlyName = hyperInlineMathWithinAtomLimit(runs) ? 'unsupportedText' : 'overflow', inlineReadOnlyKey = `hyperInlineMath.${inlineReadOnlyName}`, inlineReadOnly = tr(inlineReadOnlyKey);
      return <HyperTextBlock key={id} block={block} runs={runs} data={data} editable={canEdit && textEditable && inlineEditable} readOnlyReason={!textEditable ? tr('hyperDocument.unsupportedEmbeddedReadOnly') : !inlineEditable ? inlineReadOnly === inlineReadOnlyKey ? hyperInlineMathStrings[inlineReadOnlyName] : inlineReadOnly : undefined} ordinal={ordinal} mentions={mentions}
      header={block.ty === 'code' ? <HyperDocumentCodeControls session={session} document={doc} blockId={id} editable={canEdit && textEditable} isEditable={() => editableNow.current} editorHost={host} rowScope={rowScope} /> : undefined}
      onCodeIndent={(selection, outdent) => {
        if (!editableNow.current) return;
        try {
          const fresh = session.store.getState().document;
          if (!fresh) return;
          const target = hyperCaptureDocumentCode(fresh, id);
          const result = session.change(current => {
            if (!editableNow.current) throw Error(tr('hyperDocument.readOnly'));
            return hyperIndentDocumentCode(current, target, selection, outdent);
          });
          if (result && 'selection' in result) return result.selection as HyperTextSelection;
        } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
      }}
      outlineRequest={outlineRequest} onOutlineFocused={() => setOutlineRequest(previous => previous === outlineRequest ? null : previous)}
      onSelect={selection => {
        active.current = { id, selection };
        setAISelection(previous => previous?.id === id && previous.selection.start === selection.start && previous.selection.end === selection.end ? previous : { id, selection });
      }}
      onText={text => {
        change(doc => {
          const edited = hyperEditText(doc, id, text), shortcut = hyperMarkdownShortcut(edited.document, id);
          return shortcut ? { document: shortcut.document, actions: [...edited.actions, ...shortcut.actions], focus: shortcut.focus } : edited;
        });
        try {
          const doc = session.store.getState().document, target = doc && editableNow.current ? hyperCaptureDocumentSlash(doc, id) : null;
          if (!target) {
            if (dismissedSlash.current === id) dismissedSlash.current = null;
            if (slashTarget.current?.blockId === id) closeSlash();
          } else if (dismissedSlash.current !== id) {
            const element = Array.from(host.current?.querySelectorAll<HTMLElement>('[data-hyper-text]') ?? []).find(element => element.dataset.hyperText === id);
            const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : null;
            const rectangle = range && element?.contains(range.commonAncestorContainer) ? range.getBoundingClientRect() : element?.getBoundingClientRect();
            if (rectangle) setSlashAnchor({ left: rectangle.left, top: rectangle.bottom });
            slashTarget.current = target; setSlash(target);
          }
        } catch { closeSlash(); }
      }}
      onSplit={selection => {
        if (!hyperPlainText(runs) && ['bulleted_list', 'numbered_list', 'todo_list', 'toggle_list'].includes(block.ty)) convert(id, 'paragraph');
        else change(doc => hyperSplitBlock(doc, id, selection.start, selection.end));
      }}
      onMerge={() => change(doc => hyperMergeWithPrevious(doc, id))}
      onIndent={outdent => change(doc => {
        const parent = doc.blocks[block.parentId];
        if (outdent) return parent.id === doc.pageId ? { document: doc, actions: [] } : hyperMoveBlock(doc, id, parent.parentId, parent.id);
        const siblings = hyperChildren(doc, parent), previousId = siblings[siblings.indexOf(id) - 1];
        if (!previousId || !hyperTextTypes.has(doc.blocks[previousId].ty)) return { document: doc, actions: [] };
        return hyperMoveBlock(doc, id, previousId, hyperChildren(doc, doc.blocks[previousId]).at(-1) ?? '');
      })}
      onEmptyBackspace={() => {
        if (block.ty !== 'paragraph') convert(id, 'paragraph');
        else if (!children.length) {
          const siblings = hyperChildren(doc, doc.blocks[block.parentId]), at = siblings.indexOf(id);
          if (siblings.length > 1) {
            change(doc => hyperDeleteBlock(doc, id));
            requestAnimationFrame(() => host.current?.querySelector<HTMLElement>(`[data-hyper-text="${siblings[Math.max(0, at - 1)]}"]`)?.focus());
          }
        }
      }}
      onChecked={checked => change(doc => hyperUpdateBlock(doc, id, { checked }))}
      onFormat={format} onHistory={redo => { if (canEdit) void session.history(redo); }}
    >{children}</HyperTextBlock>;
    }
    if (block.ty === 'divider') return <hr key={id} className="my-4 border-border" />;
    const url = hyperSafeUrl(data.url, block.ty === 'image' || block.ty === 'file');
    return <div key={id} className="my-2 rounded-lg border bg-muted/30 p-4">
      {block.ty === 'image' && url ? <img src={url} alt={String(data.caption ?? '')} className="max-h-96 max-w-full rounded-md object-contain" /> : <>
        <p className="text-sm font-medium">{String(data.name ?? block.ty)}</p>
        <p className="text-xs text-muted-foreground">{tr('hyperDocument.unsupportedBlock')}</p>
        {url && <a href={url} onClick={e => { e.preventDefault(); void window.appflowy.shell.openExternal(url); }} className="break-all text-sm underline">{String(data.url)}</a>}
        {!url && typeof data.url === 'string' && <p className="break-all text-xs text-muted-foreground">{data.url}</p>}
      </>}
      {children}
    </div>;
  };
  return <div ref={host} className="flex min-h-0 flex-1 flex-col" onCompositionStartCapture={event => { if (event.target instanceof HTMLElement && event.target.closest('[data-hyper-text]')) setBlockComposing(true); }} onCompositionEndCapture={event => { if (event.target instanceof HTMLElement && event.target.closest('[data-hyper-text]')) setBlockComposing(false); }}>
    <div role="toolbar" aria-label={tr('hyperDocument.toolbar')} className="flex flex-wrap items-center gap-1 border-b px-8 py-2">
      <HyperDocumentFormat editable={canEdit} onPrepare={() => {
        const doc = session.store.getState().document;
        if (!doc || !editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        if (active.current && !hyperInlineMathTextEditable(hyperBlockText(doc, doc.blocks[active.current.id]))) throw new Error(hyperInlineMathStrings.unsupportedText);
        return hyperCaptureDocumentFormat(doc, active.current);
      }} onApply={async (target, patch) => {
        if (!editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        const applied = session.change(doc => hyperApplyDocumentFormat(doc, target, patch, editableNow.current));
        if (!applied) throw new Error(tr('hyperDocument.error'));
        await session.flush();
      }} onRestoreSelection={target => {
        const element = [...host.current?.querySelectorAll<HTMLElement>('[data-hyper-text]') ?? []].find(element => element.dataset.hyperText === target.id);
        if (element) { element.focus(); hyperSetSelection(element, { start: target.start, end: target.end }); }
        return element ?? null;
      }} />
      <HyperDocumentMediaInsert documentId={session.id} rowScope={rowScope} editable={canEdit} onPrepareInsert={() => {
        const doc = session.store.getState().document;
        if (!doc || !editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        mediaTarget.current = hyperCaptureDocumentMediaAnchor(doc, active.current?.id);
      }} onInsert={async media => {
        if (!editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        const applied = session.change(doc => {
          if (!editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
          return hyperInsertDocumentMedia(doc, mediaTarget.current, media);
        });
        if (!applied) throw new Error(tr('hyperDocument.error'));
        await session.flush();
      }} />
      <HyperDocumentDatabaseInsert documentId={session.id} rowScope={rowScope} editable={canEdit} onPrepareInsert={() => {
        const doc = session.store.getState().document;
        if (!doc || !editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        databaseTarget.current = hyperCaptureDocumentDatabaseAnchor(doc, active.current?.id);
      }} onInsert={async reference => {
        if (!editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        const applied = session.change(doc => {
          if (!editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
          return hyperInsertDocumentDatabase(doc, databaseTarget.current, reference);
        });
        if (!applied) throw new Error(tr('hyperDocument.error'));
        await session.flush();
      }} />
      <HyperDocumentOutline document={state.document} onSelect={heading => {
        const current = hyperDocumentOutline(session.store.getState().document).headings.find(candidate => candidate.id === heading.id);
        if (current) setOutlineRequest({ heading: current });
      }} />
      <HyperDocumentBookmark session={session} editable={canEdit} isEditable={() => editableNow.current} editorHost={host} rowScope={rowScope} onPrepareInsert={() => {
        const doc = session.store.getState().document;
        if (!doc || !editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        return hyperCaptureBookmarkInsertion(doc, active.current?.id ?? hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? '');
      }} onApplied={focus => {
        active.current = { id: focus.id, selection: { start: 0, end: 0 } }; setAISelection(active.current);
        requestAnimationFrame(() => { const element = host.current?.querySelector<HTMLElement>(`[data-hyper-bookmark-edit="${focus.id}"]`); element?.focus(); element?.scrollIntoView({ block: 'nearest' }); });
      }} />
      <HyperDocumentEquation session={session} editable={canEdit} isEditable={() => editableNow.current} editorHost={host} rowScope={rowScope} onPrepareInsert={() => {
        const doc = session.store.getState().document;
        if (!doc || !editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        return hyperCaptureEquationInsertion(doc, active.current?.id ?? hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? '');
      }} onApplied={focus => {
        active.current = { id: focus.id, selection: { start: 0, end: 0 } }; setAISelection(active.current);
        requestAnimationFrame(() => { const element = host.current?.querySelector<HTMLElement>(`[data-hyper-equation-edit="${focus.id}"]`); element?.focus(); element?.scrollIntoView({ block: 'nearest' }); });
      }} />
      <HyperInlineMath session={session} editable={canEdit && !blockComposing} isEditable={() => blockEditableNow.current} composing={blockComposing} editorHost={host} rowScope={rowScope} onPrepare={() => {
        const doc = session.store.getState().document, selected = active.current;
        if (!doc || !selected || !blockEditableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        const runs = hyperBlockText(doc, doc.blocks[selected.id]);
        if (!hyperInlineMathTextEditable(runs)) throw new Error(hyperInlineMathStrings.unsupportedText);
        if (selected.selection.end === selected.selection.start + 1) {
          try { return hyperCaptureInlineMath(doc, selected.id, selected.selection.start); } catch { /* An ordinary character is an insertion selection. */ }
        }
        return hyperCaptureInlineMathInsertion(doc, selected);
      }} onApplied={focus => {
        active.current = { id: focus.id, selection: { start: focus.offset, end: focus.offset } }; setAISelection(active.current);
        requestAnimationFrame(() => {
          if (!blockEditableNow.current) return;
          const element = [...host.current?.querySelectorAll<HTMLElement>('[data-hyper-text]') ?? []].find(node => node.dataset.hyperText === focus.id);
          if (element) { element.focus(); hyperSetSelection(element, { start: focus.offset, end: focus.offset }); }
        });
      }} />
      <HyperDocumentFootnote session={session} editable={canEdit} isEditable={() => editableNow.current} editorHost={host} rowScope={rowScope} onPrepareInsert={() => {
        const doc = session.store.getState().document;
        if (!doc || !editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        return hyperCaptureFootnoteInsertion(doc, hyperCaptureMentionSelection(doc, active.current));
      }} onApplied={focus => {
        active.current = { id: focus.id, selection: { start: focus.offset, end: focus.offset } }; setAISelection(active.current);
        requestAnimationFrame(() => {
          const element = [...host.current?.querySelectorAll<HTMLElement>('[data-hyper-text]') ?? []].find(element => element.dataset.hyperText === focus.id);
          if (element) { element.focus(); hyperSetSelection(element, { start: focus.offset, end: focus.offset }); }
        });
      }} />
      <HyperDocumentDate session={session} editable={canEdit} isEditable={() => editableNow.current} canWrite={() => editable} editorHost={host} rowScope={rowScope} onPrepareInsert={() => {
        const doc = session.store.getState().document;
        if (!doc || !editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
        return hyperCaptureMentionSelection(doc, active.current);
      }} onApplied={focus => {
        active.current = { id: focus.id, selection: { start: focus.offset, end: focus.offset } }; setAISelection(active.current);
        requestAnimationFrame(() => {
          const element = [...host.current?.querySelectorAll<HTMLElement>('[data-hyper-text]') ?? []].find(element => element.dataset.hyperText === focus.id);
          if (element) { element.focus(); hyperSetSelection(element, { start: focus.offset, end: focus.offset }); }
        });
      }} />
        <HyperDocumentLinks documentId={session.id} editable={canEdit} onPrepareInsert={captureLinkTarget} onInsert={async runs => {
          if (!editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
          if (mentionTargetError.current) throw new Error(mentionTargetError.current);
          const applied = session.change(doc => {
            if (!editableNow.current) throw new Error(tr('hyperDocument.readOnly'));
            return hyperInsertMentionAtSelection(doc, mentionTarget.current, runs);
          });
          if (!applied) throw new Error(tr('hyperDocument.error'));
          await session.flush();
          if (applied.focus) {
            active.current = { id: applied.focus.id, selection: { start: applied.focus.offset, end: applied.focus.offset } };
            setAISelection(active.current);
            requestAnimationFrame(() => {
              const element = host.current?.querySelector<HTMLElement>(`[data-hyper-text="${applied.focus!.id}"]`);
              if (element) { element.focus(); hyperSetSelection(element, active.current!.selection); }
            });
          }
        }} />
      <HyperDocumentAI documentId={session.id} selectionText={selectedSource.text} selectionKey={selectedSource.key} documentText={documentText} editable={canEdit} onApply={async (result, mode, source) => {
        if (!canEdit) throw new Error(tr('hyperDocument.readOnly'));
        const applied = session.change(doc => {
          if (mode === 'replace') {
            const current = selectionSource(doc);
            if (!aiSelection || current.key !== source.selectionKey || current.text !== source.sourceText) throw new Error(tr('hyperDocument.staleSelection'));
            const runs = hyperBlockText(doc, doc.blocks[aiSelection.id]);
            return hyperEditText(doc, aiSelection.id, [...hyperSliceText(runs, 0, aiSelection.selection.start), { insert: result }, ...hyperSliceText(runs, aiSelection.selection.end)]);
          }
          const block = active.current && doc.blocks[active.current.id];
          const inserted = hyperInsertBlock(doc, block?.parentId ?? doc.pageId, block?.id ?? hyperChildren(doc, doc.blocks[doc.pageId]).at(-1) ?? '', 'paragraph');
          const written = hyperEditText(inserted.document, inserted.focus!.id, [{ insert: result }]);
          return { document: written.document, actions: [...inserted.actions, ...written.actions], focus: inserted.focus };
        });
        if (!applied) throw new Error(tr('hyperDocument.error'));
        await session.flush();
      }} />
      <DropdownMenu onOpenChange={open => { if (open) captureColumnsTarget(); }}><DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!canEdit} />}><Plus />{tr('hyperDocument.insert')}</DropdownMenuTrigger><DropdownMenuContent>{kinds(insert)}<HyperDocumentColumnsMenuItems disabled={!canEdit} onSelect={insertColumns} /></DropdownMenuContent></DropdownMenu>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!canEdit} />}>{tr('hyperDocument.blockType')}<ChevronDown /></DropdownMenuTrigger><DropdownMenuContent>{kinds((type, level) => { if (active.current) convert(active.current.id, type, level); })}</DropdownMenuContent></DropdownMenu>
      {([['bold', Bold], ['italic', Italic], ['underline', Underline], ['strikethrough', Strikethrough], ['code', Code]] as const).map(([attribute, Icon]) => <Button key={attribute} variant="ghost" size="icon-sm" disabled={!canEdit} aria-label={attribute === 'code' ? tr('document.slashMenu.name.code') : tr(`editor.${attribute}`)} title={attribute === 'code' ? tr('document.slashMenu.name.code') : tr(`editor.${attribute}`)} onMouseDown={e => e.preventDefault()} onClick={() => format(attribute)}><Icon /></Button>)}
      <Button variant="ghost" size="icon-sm" disabled={!canEdit || state.status === 'saving'} aria-label={tr('toolbar.undo')} onClick={() => void session.history(false)}><Undo2 /></Button>
      <Button variant="ghost" size="icon-sm" disabled={!canEdit || state.status === 'saving'} aria-label={tr('toolbar.redo')} onClick={() => void session.history(true)}><Redo2 /></Button>
      <span className="ml-auto text-xs text-muted-foreground" role="status" aria-live="polite">{tr(`hyperDocument.${state.status}`)}</span>
    </div>
    <HyperDocumentReminderRecovery session={session} canWrite={() => editable} rowScope={rowScope} />
    <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {(state.error || actionError) && <Alert variant="destructive"><AlertTitle>{tr('hyperDocument.error')}</AlertTitle><AlertDescription>{state.error ?? actionError}</AlertDescription>
          {state.document && <Button variant="outline" size="sm" onClick={() => {
            try { window.appflowy.clipboard.writeText(hyperExportDocument(state.document!, 'markdown', title)); }
            catch { window.appflowy.clipboard.writeText(JSON.stringify(state.document, null, 2)); }
          }}>{tr('hyperDocument.copyUnsaved')}</Button>}
          {state.status === 'error' && <HyperDocumentRecovery session={session} disabled={state.historyPending} onRecovered={() => setActionError(null)} onError={setActionError} />}
        </Alert>}
        {header}
        <HyperDocumentCodeSyntax session={session} editorHost={host} revision={state.document} />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {!editable && <p className="text-xs text-muted-foreground">{tr('hyperDocument.readOnly')}</p>}
        {state.status === 'loading' && <Spinner />}
        {state.document && <div className="pb-24 leading-relaxed text-foreground" style={{ fontSize }}>
          {state.document.blocks[state.document.pageId] ? hyperChildren(state.document, state.document.blocks[state.document.pageId]).map(id => renderBlock(id, new Set([state.document!.pageId]))) : <Alert variant="destructive"><AlertDescription>{tr('hyperDocument.invalidBlock')}</AlertDescription></Alert>}
          <HyperDocumentFootnoteList document={state.document} onInspect={detail => { if (host.current) hyperOpenDocumentFootnote(host.current, detail); }} />
          {canEdit && <Button data-hyper-block-add variant="ghost" size="sm" className="mt-4 text-muted-foreground" onClick={() => insert('paragraph')}><Plus />{tr('hyperDocument.insert')}</Button>}
        </div>}
      </div>
    </div>
    {slash && <HyperDocumentSlash key={`${session.id}:${slash.blockId}`} target={slash} commands={slashCommands} anchor={slashAnchor} onQuery={updateSlashQuery} onSelect={applySlash} onDismiss={dismissSlash} />}
  </div>;
}

interface HyperTextBlockProps {
  block: BlockPB; runs: HyperTextRun[]; data: Record<string, unknown>; editable: boolean; ordinal: number; children: React.ReactNode;
  readOnlyReason?: string;
  header?: React.ReactNode;
  onCodeIndent(selection: HyperTextSelection, outdent: boolean): HyperTextSelection | undefined;
  mentions: HyperDocumentMentionResolver;
  outlineRequest: HyperOutlineRequest | null; onOutlineFocused(): void;
  onSelect(selection: HyperTextSelection): void; onText(runs: HyperTextRun[]): void;
  onSplit(selection: HyperTextSelection): void; onMerge(): void; onIndent(outdent: boolean): void; onEmptyBackspace(): void; onChecked(checked: boolean): void;
  onFormat(attribute: string): void; onHistory(redo: boolean): void;
}
function HyperTextBlock({ block, runs, data, editable, readOnlyReason, header, onCodeIndent, ordinal, children, mentions, outlineRequest, onOutlineFocused, onSelect, onText, onSplit, onMerge, onIndent, onEmptyBackspace, onChecked, onFormat, onHistory }: HyperTextBlockProps) {
  const { tr } = useTr();
  const inlineText = useHyperInlineMathText(), inlineLabels = { equation: inlineText('insert'), empty: inlineText('empty'), unsupported: inlineText('unsupported'), overflow: inlineText('overflow') };
  const ref = useRef<HTMLDivElement>(null), composing = useRef(false), selectionRevision = useRef(0), paintKind = useRef('');
  const [collapsed, setCollapsed] = useState(false);
  const runsJson = JSON.stringify(runs);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || composing.current) return;
    const kind = JSON.stringify([block.ty, inlineLabels]);
    if (JSON.stringify(hyperReadText(element)) === runsJson && paintKind.current === kind) return;
    const selection = hyperGetSelection(element);
    hyperWriteText(element, runs, { blockType: block.ty, inlineMathLabels: inlineLabels });
    paintKind.current = kind;
    if (selection) hyperSetSelection(element, selection);
  }, [runsJson, block.ty, inlineLabels.equation, inlineLabels.empty, inlineLabels.unsupported, inlineLabels.overflow]);
  useLayoutEffect(() => ref.current ? mentions.watch(ref.current) : undefined, [mentions]);
  useLayoutEffect(() => {
    if (!outlineRequest) return;
    if (outlineRequest.heading.ancestorIds.includes(block.id)) setCollapsed(false);
    if (outlineRequest.heading.id !== block.id) return;
    const frame = requestAnimationFrame(() => {
      const element = ref.current;
      if (!element || composing.current) return;
      element.focus(); hyperSetSelection(element, { start: 0, end: 0 });
      onSelect({ start: 0, end: 0 }); element.scrollIntoView({ block: 'center' }); onOutlineFocused();
    });
    return () => cancelAnimationFrame(frame);
  }, [outlineRequest, block.id]);
  const remember = () => { const selection = ref.current && hyperGetSelection(ref.current); if (selection) onSelect(selection); };
  const input = () => {
    if (!editable) return;
    if (ref.current && !composing.current) { onText(hyperReadText(ref.current)); remember(); }
  };
  return <div className={cn('my-1', block.ty === 'quote' && 'border-l-2 border-border pl-4', block.ty === 'callout' && 'rounded-lg bg-muted p-4')}>
    {header}
    <div className="flex items-start gap-2">
      {block.ty === 'todo_list' && <Checkbox className="mt-1.5" checked={data.checked === true} disabled={!editable} aria-label={tr('hyperDocument.taskCompleted')} onCheckedChange={checked => onChecked(checked === true)} />}
      {block.ty === 'bulleted_list' && <span aria-hidden className="pt-0.5">•</span>}
      {block.ty === 'numbered_list' && <span aria-hidden className="pt-0.5 text-muted-foreground">{ordinal}.</span>}
      {block.ty === 'toggle_list' && <Button variant="ghost" size="icon-xs" aria-label={tr('hyperDocument.toggle')} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><ChevronDown className={cn(collapsed && '-rotate-90')} /></Button>}
      <div ref={ref} data-hyper-text={block.id} role="textbox" aria-label={tr('hyperDocument.blockLabel', { namedArgs: { type: block.ty } })} aria-description={readOnlyReason} aria-multiline="true" aria-readonly={!editable} tabIndex={0}
        contentEditable={editable} suppressContentEditableWarning spellCheck={block.ty !== 'code'}
        className={cn('min-h-7 min-w-0 flex-1 whitespace-pre-wrap break-words rounded-md px-1 outline-none focus-visible:ring-1 focus-visible:ring-ring', block.ty === 'heading' && 'font-semibold', block.ty === 'heading' && (Number(data.level) === 1 ? 'text-2xl' : Number(data.level) === 2 ? 'text-xl' : 'text-lg'), block.ty === 'code' && 'hyper-code-syntax rounded-lg bg-muted p-4 font-mono text-sm', block.ty === 'todo_list' && data.checked === true && 'text-muted-foreground line-through')}
        onFocus={remember} onMouseUp={() => { selectionRevision.current++; remember(); }} onBlur={() => { selectionRevision.current++; }} onKeyUp={remember} onInput={input}
        onCompositionStart={() => { selectionRevision.current++; composing.current = true; }} onCompositionEnd={() => { composing.current = false; input(); }}
        onPaste={event => {
          if (!editable) return;
          event.preventDefault();
          const element = ref.current!, selection = hyperGetSelection(element);
          if (!selection) return;
          hyperSetSelection(element, selection);
          const range = window.getSelection()!.getRangeAt(0);
          range.deleteContents();
          const text = document.createTextNode(event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'));
          range.insertNode(text); range.setStartAfter(text); range.collapse(true);
          window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
          input();
        }}
        onKeyDown={event => {
          const revision = ++selectionRevision.current;
          if (!editable || composing.current || event.nativeEvent.isComposing) return;
          if (event.ctrlKey || event.metaKey) {
            const attribute = ({ b: 'bold', i: 'italic', u: 'underline' } as Record<string, string>)[event.key.toLowerCase()];
            if (attribute) { event.preventDefault(); remember(); onFormat(attribute); return; }
            if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') { event.preventDefault(); onHistory(event.shiftKey || event.key.toLowerCase() === 'y'); return; }
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            const selection = hyperGetSelection(ref.current!);
            if (selection) {
              if (event.shiftKey || block.ty === 'code') {
                hyperSetSelection(ref.current!, selection);
                const range = window.getSelection()!.getRangeAt(0);
                range.deleteContents(); const newline = document.createTextNode('\n'); range.insertNode(newline); range.setStartAfter(newline); range.collapse(true);
                window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); input();
              } else onSplit(selection);
            }
          } else if (event.key === 'Backspace') {
            const selection = hyperGetSelection(ref.current!);
            if (!hyperPlainText(runs)) { event.preventDefault(); onEmptyBackspace(); }
            else if (selection?.start === 0 && selection.end === 0) { event.preventDefault(); onMerge(); }
          } else if (event.key === 'Tab' && block.ty === 'code' && !event.altKey && !event.ctrlKey && !event.metaKey) {
            const element = ref.current!, selection = hyperGetSelection(element);
            if (!selection) return;
            event.preventDefault();
            const next = onCodeIndent(selection, event.shiftKey);
            if (next) { onSelect(next); requestAnimationFrame(() => { if (revision === selectionRevision.current && document.activeElement === element && !composing.current) hyperSetSelection(element, next); }); }
          } else if (event.key === 'Tab' && ['bulleted_list', 'numbered_list', 'todo_list', 'toggle_list'].includes(block.ty)) {
            event.preventDefault(); onIndent(event.shiftKey);
          }
        }}
      />
    </div>
    {readOnlyReason && <p className="px-1 text-xs text-muted-foreground">{readOnlyReason}</p>}
    {!collapsed && <div className="ml-6">{children}</div>}
  </div>;
}

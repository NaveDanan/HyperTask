import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Copy, RefreshCw, Sparkles, Square } from 'lucide-react';
import { FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { HyperChatMessageContent } from '../ai-chat/HyperChatMessageContent';
import { hyperChatModelKey } from '../ai-chat/HyperChatStore';
import { useHyperDatabaseText } from './HyperDatabaseI18n';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';
import { createHyperDatabaseAIStore, type HyperDatabaseAIContext } from './HyperDatabaseAIStore';
import { hyperDatabaseAIBackend, hyperDatabaseAIRowDocument } from './HyperDatabaseAIBackend';

interface HyperDatabaseAICellProps {
  repository: HyperDatabaseRepository; viewId: string; rowId: string; field: FieldPB;
  value: string; editable: boolean; saving: boolean; save(operation: () => Promise<void>): Promise<boolean>;
}
export function HyperDatabaseAICell(props: HyperDatabaseAICellProps) {
  const text = useHyperDatabaseText(), [open, setOpen] = useState(false);
  const workspace = useWorkspaceStore(state => state.currentWorkspace), user = useWorkspaceStore(state => state.userProfile);
  const context: HyperDatabaseAIContext | null = workspace && user ? { viewId: props.viewId, rowId: props.rowId, fieldId: props.field.id, fieldType: props.field.fieldType, workspaceId: workspace.workspaceId, actorId: String(user.id) } : null;
  const contextId = context ? JSON.stringify(context) : '';
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="ghost" className="min-h-8 w-full justify-start px-2 font-normal" aria-label={`${text('aiReview')}: ${props.field.name}`} disabled={props.saving || props.editable && !context} />}>
      <Sparkles className="size-3.5 shrink-0" /><span className="max-w-80 truncate">{props.value || text('aiGenerate')}</span>
    </DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{props.field.name}</DialogTitle><DialogDescription>{text(props.editable ? 'aiDescription' : 'aiReadOnlyDescription')}</DialogDescription></DialogHeader>
      {open && (props.editable && context ? <HyperDatabaseAIContent key={contextId} {...props} context={context} /> : <div className="flex flex-col gap-4"><p className="max-h-96 overflow-y-auto whitespace-pre-wrap text-sm" aria-label={text('aiSavedValue')}>{props.value || text('noValue')}</p><Button variant="ghost" className="self-end" disabled={!props.value} onClick={() => window.appflowy.clipboard.writeText(props.value)}><Copy />{text('aiCopy')}</Button></div>)}
    </DialogContent>
  </Dialog>;
}
function HyperDatabaseAIContent({ repository, context, editable, saving, save }: HyperDatabaseAICellProps & { context: HyperDatabaseAIContext }) {
  const text = useHyperDatabaseText();
  const editableNow = useRef(editable); editableNow.current = editable;
  const [store] = useState(() => createHyperDatabaseAIStore(context, hyperDatabaseAIBackend(repository), () => {
    const current = useWorkspaceStore.getState();
    return editableNow.current && current.currentWorkspace?.workspaceId === context.workspaceId && String(current.userProfile?.id) === context.actorId;
  }));
  const state = useStore(store), completion = useStore(store.completion);
  const [language, setLanguage] = useState(''), languageInitialized = useRef(false);
  useEffect(() => store.start(), [store]);
  useEffect(() => {
    if (state.snapshot && !languageInitialized.current) { setLanguage(state.snapshot.target.language); languageInitialized.current = true; }
  }, [state.snapshot]);
  useEffect(() => { if (!editable) { store.invalidate(); void store.completion.stop(); } }, [editable, store]);
  const busy = state.preparing || state.applying || saving || completion.status === 'generating' || completion.status === 'stopping';
  const selectedText = useMemo(() => state.snapshot?.sources.filter(source => state.selectedIds.includes(source.id)).map(source => `${source.id === hyperDatabaseAIRowDocument ? text('aiRowDocument') : source.name}:\n${source.text}`).join('\n\n') ?? '', [state.snapshot, state.selectedIds, text]);
  return <div className="flex flex-col gap-4">
    {(state.error || completion.error || completion.modelError) && <Alert variant="destructive"><AlertDescription>{state.error || completion.error || completion.modelError}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-sm font-medium">{text('aiSources')}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => void store.refresh()}><RefreshCw />{text('aiRefresh')}</Button>
      {completion.models.length > 0 && <Select value={completion.selectedModel ? hyperChatModelKey(completion.selectedModel) : null} disabled={busy || completion.changingModel || !editable} items={completion.models.map(model => ({ value: hyperChatModelKey(model), label: model.name }))} onValueChange={value => {
        const model = completion.models.find(model => hyperChatModelKey(model) === value); if (model) { store.invalidate(); void store.completion.selectModel(model); }
      }}><SelectTrigger aria-label={text('aiModel')} className="max-w-64"><SelectValue placeholder={text('aiModel')} /></SelectTrigger><SelectContent>{completion.models.map(model => <SelectItem key={hyperChatModelKey(model)} value={hyperChatModelKey(model)}>{model.name}</SelectItem>)}</SelectContent></Select>}
    </div>
    {state.preparing && !state.snapshot ? <Spinner /> : <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border p-2">{state.snapshot?.sources.map(source => <label key={source.id} className="flex items-center gap-2 rounded-md p-1 text-sm hover:bg-accent"><Checkbox aria-label={source.id === hyperDatabaseAIRowDocument ? text('aiRowDocument') : source.name} disabled={busy || !editable} checked={state.selectedIds.includes(source.id)} onCheckedChange={checked => store.select(checked ? [...state.selectedIds, source.id] : state.selectedIds.filter(id => id !== source.id))} /><span className="truncate">{source.id === hyperDatabaseAIRowDocument ? text('aiRowDocument') : source.name}</span></label>)}{!state.snapshot?.sources.length && <p className="text-xs text-muted-foreground">{text('aiNoSources')}</p>}</div>}
    {selectedText && <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/30 p-3 text-xs" aria-label={text('aiSourcePreview')}>{selectedText}</pre>}
    {context.fieldType === FieldType.Translate && <label className="flex flex-col gap-2 text-sm">{text('aiLanguage')}<Input aria-label={text('aiLanguage')} value={language} disabled={busy || !editable} onChange={event => { setLanguage(event.target.value); store.invalidate(); }} /><span className="text-xs text-muted-foreground">{text('aiLanguageHint')}</span></label>}
    <div className="flex flex-wrap items-center gap-2"><Button disabled={!editable || busy || completion.changingModel || !state.selectedIds.length || context.fieldType === FieldType.Translate && !language.trim()} onClick={() => void store.generate(language)}>{busy ? <Spinner /> : <Sparkles />}{busy ? text('aiGenerating') : text('aiGenerate')}</Button>
      {(completion.status === 'generating' || completion.status === 'stopping') && <Button variant="outline" disabled={completion.status === 'stopping'} onClick={() => void store.completion.stop()}><Square />{text('aiStop')}</Button>}
      {completion.status === 'cancelled' && <Badge size="sm" variant="secondary">{text('aiStopped')}</Badge>}{state.applied && <Badge size="sm" variant="success-light">{text('aiApplied')}</Badge>}
    </div>
    {state.snapshot?.target.text && <div className="flex flex-col gap-1"><span className="text-xs font-medium text-muted-foreground">{text('aiSavedValue')}</span><p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm">{state.snapshot.target.text}</p></div>}
    {completion.result && <div className="max-h-72 overflow-y-auto rounded-lg border p-4" aria-label={text('aiResult')} aria-busy={completion.status === 'generating'}><HyperChatMessageContent text={completion.result} /></div>}
    <DialogFooter className="m-0 flex-wrap rounded-none border-0 bg-transparent p-0"><Button variant="ghost" disabled={!completion.result} onClick={() => window.appflowy.clipboard.writeText(completion.result)}><Copy />{text('aiCopy')}</Button><Button disabled={!editable || busy || !state.canApply || state.applied || completion.status !== 'ready' || !completion.result.trim()} onClick={() => { void save(() => store.apply()); }}>{text('aiApply')}</Button></DialogFooter>
  </div>;
}

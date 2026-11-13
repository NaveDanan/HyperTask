import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { Copy, Sparkles, Square } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useTr } from '@/i18n';
import { HyperChatMessageContent } from '../ai-chat/HyperChatMessageContent';
import { hyperChatModelKey } from '../ai-chat/HyperChatStore';
import { createHyperDocumentAIStore, hyperCanReplaceDocumentAI, type HyperDocumentAIAction, type HyperDocumentAISource } from './HyperDocumentAIStore';

export const hyperDocumentAIStrings = {
  ask: 'Ask AI', description: 'Review the generated text before inserting it or replacing your selection.',
  summarize: 'Summarize', rewrite: 'Rewrite', grammar: 'Fix spelling and grammar', continue: 'Continue writing', explain: 'Explain', translate: 'Translate',
  language: 'Target language', languagePlaceholder: 'For example, English', generate: 'Generate', generating: 'Generating…', stop: 'Stop generating',
  insert: 'Insert result', replace: 'Replace selection', copy: 'Copy result', selection: 'Selected text', page: 'Page text', model: 'Model',
  stale: 'The selection changed. You can insert this result or select the original text again.',
  applied: 'Result applied', cancelled: 'Stopped',
} as const;
export interface HyperDocumentAIProps {
  documentId: string;
  selectionText: string;
  documentText: string;
  selectionKey?: string;
  editable: boolean;
  onApply(result: string, mode: 'insert' | 'replace', context: { sourceText: string; selectionKey?: string }): void | Promise<void>;
}
export function HyperDocumentAI(props: HyperDocumentAIProps) {
  const { tr } = useTr(), [open, setOpen] = useState(false);
  const t = (name: keyof typeof hyperDocumentAIStrings) => { const key = `hyperDocumentAI.${name}`, translated = tr(key); return translated === key ? hyperDocumentAIStrings[name] : translated; };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="ghost" size="sm" disabled={!props.editable} />}><Sparkles />{t('ask')}</DialogTrigger>
    <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{t('ask')}</DialogTitle><DialogDescription>{t('description')}</DialogDescription></DialogHeader>
      {open && <HyperDocumentAIContent key={props.documentId} {...props} />}
    </DialogContent>
  </Dialog>;
}
function HyperDocumentAIContent({ documentId, selectionText, documentText, selectionKey, editable, onApply }: HyperDocumentAIProps) {
  const { tr } = useTr();
  const t = (name: keyof typeof hyperDocumentAIStrings) => { const key = `hyperDocumentAI.${name}`, translated = tr(key); return translated === key ? hyperDocumentAIStrings[name] : translated; };
  const [store] = useState(() => createHyperDocumentAIStore(documentId));
  const state = useStore(store);
  const [action, setAction] = useState<HyperDocumentAIAction>('summarize'), [language, setLanguage] = useState('');
  const [applyError, setApplyError] = useState<string | null>(null), [applied, setApplied] = useState(false), [applying, setApplying] = useState(false);
  const source: HyperDocumentAISource = { sourceText: selectionText.trim() ? selectionText : documentText, selectionKey, usedSelection: !!selectionText.trim() };
  useEffect(() => store.start(), [store]);
  const busy = state.status === 'generating' || state.status === 'stopping';
  const canReplace = hyperCanReplaceDocumentAI(state.source, selectionText, selectionKey);
  const canApply = editable && !busy && !applying && !applied && !!state.result;
  const apply = async (mode: 'insert' | 'replace') => {
    if (!canApply || !state.source || mode === 'replace' && !canReplace) return;
    setApplying(true); setApplyError(null);
    try { await onApply(state.result, mode, { sourceText: state.source.sourceText, selectionKey: state.source.selectionKey }); setApplied(true); }
    catch (error) { setApplyError(error instanceof Error ? error.message : String(error)); }
    finally { setApplying(false); }
  };
  return <div className="flex min-h-0 flex-col gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <Select value={action} disabled={busy || applying} onValueChange={value => { if (value) setAction(value as HyperDocumentAIAction); }} items={(Object.keys(hyperDocumentAIStrings).filter(key => ['summarize', 'rewrite', 'grammar', 'continue', 'explain', 'translate'].includes(key)) as HyperDocumentAIAction[]).map(value => ({ value, label: t(value) }))}>
        <SelectTrigger aria-label={t('ask')}><SelectValue /></SelectTrigger><SelectContent>{(['summarize', 'rewrite', 'grammar', 'continue', 'explain', 'translate'] as const).map(value => <SelectItem key={value} value={value}>{t(value)}</SelectItem>)}</SelectContent>
      </Select>
      {state.models.length > 0 && <Select value={state.selectedModel ? hyperChatModelKey(state.selectedModel) : null} disabled={busy || applying || state.changingModel} onValueChange={value => { const model = state.models.find(model => hyperChatModelKey(model) === value); if (model) void store.selectModel(model); }} items={state.models.map(model => ({ value: hyperChatModelKey(model), label: model.name }))}>
        <SelectTrigger aria-label={t('model')} className="max-w-64"><SelectValue placeholder={t('model')} /></SelectTrigger><SelectContent>{state.models.map(model => <SelectItem key={hyperChatModelKey(model)} value={hyperChatModelKey(model)}>{model.name}</SelectItem>)}</SelectContent>
      </Select>}
      <Badge variant="secondary" size="sm">{source.usedSelection ? t('selection') : t('page')}</Badge>
    </div>
    {action === 'translate' && <Input aria-label={t('language')} placeholder={t('languagePlaceholder')} value={language} disabled={busy || applying} onChange={event => setLanguage(event.target.value)} />}
    {(state.error || state.modelError || applyError) && <Alert variant="destructive"><AlertDescription>{state.error || applyError || state.modelError}</AlertDescription></Alert>}
    <div className="flex items-center gap-2">
      <Button disabled={!editable || busy || applying || state.changingModel || !source.sourceText.trim() || action === 'translate' && !language.trim()} onClick={() => {
        setApplied(false); setApplyError(null); void store.run(action, source, language);
      }}>{busy ? <Spinner /> : <Sparkles />}{busy ? t('generating') : t('generate')}</Button>
      {busy && <Button variant="outline" disabled={state.status === 'stopping'} onClick={() => void store.stop()}><Square />{t('stop')}</Button>}
      {state.status === 'cancelled' && <Badge variant="secondary" size="sm">{t('cancelled')}</Badge>}
      {applied && <Badge variant="success-light" size="sm">{t('applied')}</Badge>}
    </div>
    {state.result && <div className="max-h-80 overflow-y-auto rounded-lg border bg-muted/20 p-4" aria-busy={busy}><HyperChatMessageContent text={state.result} /></div>}
    {state.source?.usedSelection && !canReplace && <Alert variant="warning"><AlertDescription>{t('stale')}</AlertDescription></Alert>}
    <DialogFooter className="m-0 flex-wrap rounded-none border-0 bg-transparent p-0">
      <Button variant="ghost" disabled={!state.result} onClick={() => window.appflowy.clipboard.writeText(state.result)}><Copy />{t('copy')}</Button>
      <Button variant="outline" disabled={!canApply} onClick={() => void apply('insert')}>{t('insert')}</Button>
      <Button disabled={!canApply || !canReplace} onClick={() => void apply('replace')}>{t('replace')}</Button>
    </DialogFooter>
  </div>;
}

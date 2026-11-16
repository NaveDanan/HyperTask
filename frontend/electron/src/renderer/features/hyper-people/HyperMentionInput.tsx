import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type FocusEventHandler, type KeyboardEventHandler } from 'react';
import { createPortal } from 'react-dom';
import { HyperPersonCard } from './HyperPersonCard';
import type { HyperPerson } from '@shared/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { floatingSurfaceClass } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';
import { HyperMentionChipClass } from './HyperMentionText';
import { hyperMentionDeletion, hyperMentionQuery, hyperParseMentions, hyperSerializeMention } from './hyperMentions';
import { useHyperPeople } from './useHyperPeople';
import { HyperPeopleResults } from './HyperPeopleResults';
export type HyperMentionHandle = HTMLDivElement & { select(): void };
export interface HyperMentionInputProps {
  value: string; onChange: (event: { target: { value: string } }) => void;
  onBlur?: FocusEventHandler<HTMLDivElement>; onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  className?: string; placeholder?: string; id?: string; disabled?: boolean; autoFocus?: boolean;
  'aria-label'?: string; 'aria-invalid'?: boolean; 'data-hyper-grid-editor'?: boolean;
  inputMode?: 'decimal' | 'text'; multiline?: boolean;
}
function read(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.hyperMention) return node.dataset.hyperMention;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeName === 'BR') return '\n';
  return Array.from(node.childNodes).map((child, i) => (i && ['DIV', 'P'].includes(child.nodeName) ? '\n' : '') + read(child)).join('');
}
function selection(root: HTMLElement) {
  const selected = window.getSelection();
  if (!selected?.rangeCount || !root.contains(selected.anchorNode) || !root.contains(selected.focusNode)) return { start: read(root).length, end: read(root).length };
  const range = selected.getRangeAt(0), before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  return { start: read(before.cloneContents()).length, end: read(before.cloneContents()).length + read(range.cloneContents()).length };
}
function draw(root: HTMLElement, value: string, caret?: number) {
  const chips: Array<{ node: HTMLElement; person: { name: string; email: string } }> = [];
  const fragment = document.createDocumentFragment(); let at: { node: Node; offset: number } | undefined;
  for (const part of hyperParseMentions(value)) {
    if (part.kind === 'text') {
      const node = document.createTextNode(part.text); fragment.append(node);
      if (caret !== undefined && caret >= part.start && caret <= part.end) at = { node, offset: caret - part.start };
    } else {
      const chip = document.createElement('span'); chip.contentEditable = 'false'; chip.dir = 'auto'; chip.className = HyperMentionChipClass; chip.dataset.hyperMention = value.slice(part.start, part.end); chips.push({ node: chip, person: part.person }); fragment.append(chip);
      if (caret !== undefined && caret > part.start && caret <= part.end) { const tail = document.createTextNode(''); fragment.append(tail); at = { node: tail, offset: 0 }; }
    }
  }
  root.replaceChildren(fragment);
  if (caret !== undefined) { const range = document.createRange(); if (at) range.setStart(at.node, at.offset); else { range.selectNodeContents(root); range.collapse(caret === 0); } range.collapse(true); const selected = window.getSelection(); selected?.removeAllRanges(); selected?.addRange(range); }
  return chips;
}
export const HyperMentionInput = forwardRef<HyperMentionHandle, HyperMentionInputProps>(function HyperMentionInput({ value, onChange, onBlur, onKeyDown, className, placeholder, id, disabled, autoFocus, multiline = false, ...props }, ref) {
  const editor = useRef<HTMLDivElement>(null), composing = useRef(false), saved = useRef(value);
  const [query, setQuery] = useState<ReturnType<typeof hyperMentionQuery>>(null), [active, setActive] = useState(0);
  const [chips, setChips] = useState<Array<{ node: HTMLElement; person: { name: string; email: string } }>>([]);
  const listId = useId(); const results = useHyperPeople(query?.query ?? '');
  const open = Boolean(query && !disabled);
  useImperativeHandle(ref, () => Object.assign(editor.current!, { select() { const range = document.createRange(); range.selectNodeContents(editor.current!); const selected = window.getSelection(); selected?.removeAllRanges(); selected?.addRange(range); } }), []);
  useLayoutEffect(() => { if (editor.current && read(editor.current) !== value) setChips(draw(editor.current, value)); saved.current = value; }, [value]);
  useEffect(() => { if (autoFocus) editor.current?.focus(); }, [autoFocus]);
  useEffect(() => { setActive(0); }, [results.people]);
  const publish = (next: string, caret: number, normalize = false) => {
    saved.current = next; if (normalize && editor.current) setChips(draw(editor.current, next, caret));
    onChange({ target: { value: next } }); setQuery(hyperMentionQuery(next, caret));
  };
  const choose = (person: HyperPerson) => {
    if (!query || !editor.current) return;
    const token = hyperSerializeMention(person) + ' ', next = saved.current.slice(0, query.start) + token + saved.current.slice(query.end);
    editor.current.focus(); publish(next, query.start + token.length, true); setQuery(null);
  };
  return <Popover open={open} onOpenChange={next => { if (!next) setQuery(null); }}><div className={cn('relative min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50', multiline ? 'min-h-20' : 'h-9', disabled && 'opacity-50', className)}>
    <PopoverTrigger nativeButton={false} tabIndex={-1} render={<span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px" />} />
    <div {...props} id={id} ref={editor} dir="auto" role="textbox" aria-multiline={multiline} aria-disabled={disabled} aria-autocomplete="list" aria-controls={open ? listId : undefined} aria-expanded={open} aria-activedescendant={open && results.people[active] ? listId + '-' + active : undefined} aria-placeholder={placeholder} data-placeholder={placeholder} data-hyper-mention-editor contentEditable={!disabled} suppressContentEditableWarning tabIndex={disabled ? -1 : 0} className={cn('min-h-full w-full outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]', multiline ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto whitespace-pre [scrollbar-width:none]')}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; const root = editor.current!; publish(read(root), selection(root).end); }}
      onInput={() => { if (!composing.current && editor.current) publish(read(editor.current), selection(editor.current).end); }}
      onPaste={event => { event.preventDefault(); const root = editor.current!, range = selection(root), paste = event.clipboardData.getData('text/plain').replace(multiline ? /\r/g : /[\r\n]/g, multiline ? '' : ' '); publish(saved.current.slice(0, range.start) + paste + saved.current.slice(range.end), range.start + paste.length, true); }}
      onBlur={event => { setQuery(null); onBlur?.(event); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing.current) return;
        if (open && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setQuery(null); return; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, results.people.length)) % Math.max(1, results.people.length)); return; }
          if (results.people[active]) { event.preventDefault(); event.stopPropagation(); choose(results.people[active]); return; }
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); return; }
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          const range = selection(editor.current!); const hit = hyperParseMentions(saved.current).some(part => part.kind === 'mention' && (range.start === range.end ? event.key === 'Backspace' ? range.start > part.start && range.start <= part.end : range.start >= part.start && range.start < part.end : range.start < part.end && range.end > part.start));
          if (hit) { event.preventDefault(); const next = hyperMentionDeletion(saved.current, range.start, range.end, event.key === 'Backspace'); publish(next.value, next.caret, true); return; }
        }
        onKeyDown?.(event);
        if (!event.defaultPrevented && !multiline && event.key === 'Enter') event.preventDefault();
      }} />
    {chips.map(({ node, person }, index) => createPortal(<HyperPersonCard person={person}><span dir="auto">@{person.name}</span></HyperPersonCard>, node, String(index)))}
  </div><PopoverContent align="start" initialFocus={false} finalFocus={false} className={cn(floatingSurfaceClass, 'w-80 max-w-[calc(100vw-2rem)] gap-0 p-0')} onMouseDown={event => event.preventDefault()}><HyperPeopleResults {...results} id={listId} active={active} onActive={setActive} onSelect={choose} /></PopoverContent></Popover>;
});
export const HyperMentionTextarea = forwardRef<HyperMentionHandle, HyperMentionInputProps>(function HyperMentionTextarea(props, ref) { return <HyperMentionInput {...props} ref={ref} multiline />; });

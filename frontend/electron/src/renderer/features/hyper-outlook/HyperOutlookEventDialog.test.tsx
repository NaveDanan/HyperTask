import { Textarea } from '@/components/ui/textarea';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { HyperOutlookFixture as item } from './test/HyperOutlookFixture';
import { hyperOutlookDraft } from './HyperOutlookData';
const harness = vi.hoisted(() => ({ active: false, index: 0, values: [] as any[], client: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), respond: vi.fn(), open: vi.fn() }, toast: vi.fn() }));
vi.mock('./hyper-outlook-client', () => ({ hyperOutlookClient: harness.client }));
vi.mock('@/ui', () => ({ showToast: harness.toast }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react, useId: () => harness.active ? 'test' : react.useId(), useState: (initial: any) => {
    if (!harness.active) return react.useState(initial);
    const index = harness.index++; if (!(index in harness.values)) harness.values[index] = typeof initial === 'function' ? initial() : initial;
    return [harness.values[index], (next: any) => { harness.values[index] = typeof next === 'function' ? next(harness.values[index]) : next; }];
  } };
});
import { HyperOutlookEventDialog } from './HyperOutlookEventDialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
const visit = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(visit)];
function tree(props: Partial<Parameters<typeof HyperOutlookEventDialog>[0]> = {}) {
  harness.active = true; harness.index = 0;
  try { return HyperOutlookEventDialog({ initial: hyperOutlookDraft(item, 'UTC'), timeZone: 'UTC', onClose: vi.fn(), onSaved: vi.fn(), confirmSend: vi.fn(async () => true), ...props }); }
  finally { harness.active = false; }
}
const save = (node: ReactElement) => visit(node).find(element => element.type === 'form').props.onSubmit({ preventDefault() {} });
const click = async (node: ReactElement, label: string) => {
  const button = visit(node).find(element => element.type === Button && [element.props.children].flat().includes(label)); expect(button).toBeDefined(); button.props.onClick();
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
beforeEach(() => { vi.clearAllMocks(); harness.values = []; for (const fn of Object.values(harness.client)) fn.mockResolvedValue(null); });
it('aborts attendee-bearing creates before IPC when the send confirmation is cancelled', async () => {
  const confirm = vi.fn(async () => false); let node = tree({ confirmSend: confirm });
  visit(node).find(element => element.props?.placeholder === 'Separate with commas').props.onChange({ target: { value: 'preview@example.invalid' } });
  node = tree({ confirmSend: confirm }); save(node); for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(confirm).toHaveBeenCalledWith(1, 'invite'); expect(harness.client.create).not.toHaveBeenCalled();
});
it('requires fresh send confirmation for an own meeting edit and leaves its unchanged body untouched', async () => {
  const own = { ...item, attendeeCount: 2, attendees: [] }, confirm = vi.fn(async () => true); let node = tree({ item: own, confirmSend: confirm });
  visit(node).find(element => element.props?.placeholder === 'Untitled').props.onChange({ target: { value: 'Changed' } });
  node = tree({ item: own, confirmSend: confirm }); save(node); for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(confirm).toHaveBeenCalledWith(2, 'update'); expect(harness.client.update).toHaveBeenCalledWith({ id: item.id, expectedLastModified: item.lastModified, patch: { subject: 'Changed' }, send: true });
});
it('confirms a sent invite response and aborts on Cancel without updating the invite fields', async () => {
  const invite = { ...item, isOrganizer: false, attendeeCount: 3 }, confirm = vi.fn(async () => false);
  await click(tree({ item: invite, confirmSend: confirm }), 'Accept'); expect(confirm).toHaveBeenCalledWith(1, 'response'); expect(harness.client.respond).not.toHaveBeenCalled(); expect(harness.client.update).not.toHaveBeenCalled();
});
it('records an unsent invite response without a send confirmation', async () => {
  const invite = { ...item, isOrganizer: false, attendeeCount: 3 }, confirm = vi.fn(async () => true); let node = tree({ item: invite, confirmSend: confirm });
  const switches = visit(node).filter(element => element.type === Switch); switches.at(-1).props.onCheckedChange(false);
  node = tree({ item: invite, confirmSend: confirm }); await click(node, 'Accept'); expect(confirm).not.toHaveBeenCalled(); expect(harness.client.respond).toHaveBeenCalledWith({ id: item.id, response: 'accept', send: false });
});
it('reloads a conflicted edit through the exact toast and closes the stale editor', async () => {
  const onSaved = vi.fn(), onClose = vi.fn(); let node = tree({ item, onSaved, onClose });
  visit(node).find(element => element.props?.placeholder === 'Untitled').props.onChange({ target: { value: 'Changed' } });
  harness.client.update.mockRejectedValueOnce(new Error('Changed in Outlook — reloaded'));
  node = tree({ item, onSaved, onClose }); save(node); for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(harness.toast).toHaveBeenCalledWith({ type: 'error', message: 'Changed in Outlook — reloaded' }); expect(onSaved).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
});
it('does not send an update when an existing meeting has no edits', async () => {
  const confirm = vi.fn(async () => true), onClose = vi.fn(); save(tree({ item: { ...item, attendeeCount: 2 }, confirmSend: confirm, onClose }));
  for (let i = 0; i < 15; i++) await Promise.resolve(); expect(confirm).not.toHaveBeenCalled(); expect(harness.client.update).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledOnce();
});

it('keeps a truncated long description read-only so an edit cannot discard unseen text', () => {
  const node = tree({ item: { ...item, body: 'x'.repeat(8192) } });
  expect(visit(node).find(element => element.type === Textarea).props.readOnly).toBe(true);
});

const swatch = (node: any, label: string) => visit(node).find(element => element.props?.['aria-label'] === label);
const settleAll = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
it('applies a colour to an existing event at once, without re-sending the meeting or asking to confirm', async () => {
  const own = { ...item, attendeeCount: 2 }, saved = { ...own, categories: ['HyperTask Blue'], lastModified: '2026-11-16T07:30:00Z' }, confirm = vi.fn(async () => true), onItemChange = vi.fn();
  harness.client.update.mockResolvedValueOnce(saved);
  const node = tree({ item: own, confirmSend: confirm, onItemChange }); swatch(node, 'Blue').props.onClick(); await settleAll();
  expect(harness.client.update).toHaveBeenCalledWith({ id: item.id, expectedLastModified: item.lastModified, patch: { color: 'blue' }, send: false });
  expect(confirm).not.toHaveBeenCalled(); expect(onItemChange).toHaveBeenNthCalledWith(1, expect.objectContaining({ categories: ['HyperTask Blue'] })); expect(onItemChange).toHaveBeenLastCalledWith(saved);
});
it('saves later edits with the lastModified returned by the colour write, so the save is not refused as a conflict', async () => {
  const saved = { ...item, categories: ['HyperTask Blue'], lastModified: '2026-11-16T07:30:00Z' };
  harness.client.update.mockResolvedValueOnce(saved);
  let node = tree({ item }); swatch(node, 'Blue').props.onClick(); await settleAll();
  node = tree({ item }); visit(node).find(element => element.props?.placeholder === 'Untitled').props.onChange({ target: { value: 'Changed' } });
  node = tree({ item }); save(node); await settleAll();
  expect(harness.client.update).toHaveBeenLastCalledWith({ id: item.id, expectedLastModified: saved.lastModified, patch: { subject: 'Changed' }, send: false });
});
it('puts a colour picked on a new event into the create request', async () => {
  let node = tree({ item: undefined }); swatch(node, 'Green').props.onClick();
  node = tree({ item: undefined }); save(node); await settleAll();
  expect(harness.client.create).toHaveBeenCalledWith(expect.objectContaining({ color: 'green', attendees: [], send: false }));
});
it('bounds the dialog by the viewport with a scrolling body and pinned header and footer', () => {
  const node = tree();
  const content = visit(node).find(element => String(element.props?.className).includes('max-h-[calc(100dvh_-_2rem)]'));
  expect(content.props.className).toContain('overflow-hidden');
  expect(visit(node).some(element => element.type === 'div' && String(element.props?.className).includes('overflow-y-auto'))).toBe(true);
  expect(visit(node).find(element => element.props?.['data-slot'] === 'dialog-footer' || String(element.props?.className).includes('shrink-0 rounded-none'))).toBeDefined();
});
it('words the send confirmation for each Outlook action', async () => {
  const { hyperOutlookSendCopy } = await import('./HyperOutlookSendConfirm');
  expect(hyperOutlookSendCopy('invite', 1).title).toBe('Send invitation to 1 attendee?');
  expect(hyperOutlookSendCopy('update', 3).title).toBe('Send update to 3 attendees?');
  expect(hyperOutlookSendCopy('cancel', 2)).toMatchObject({ title: 'Cancel meeting for 2 attendees?', action: 'Send cancellation' });
  expect(hyperOutlookSendCopy('response', 1).title).toBe('Send response to the organizer?');
});
it('colours an invitation, since the colour is the user\'s own category', async () => {
  const invite = { ...item, isOrganizer: false, responseStatus: 3 }, saved = { ...invite, categories: ['HyperTask Red'] };
  harness.client.update.mockResolvedValueOnce(saved);
  swatch(tree({ item: invite }), 'Red').props.onClick(); await settleAll();
  expect(harness.client.update).toHaveBeenCalledWith({ id: item.id, expectedLastModified: item.lastModified, patch: { color: 'red' }, send: false });
});
it('does not colour a series master', () => { expect(swatch(tree({ item: { ...item, recurrenceState: 1 } }), 'Red').props.disabled).toBe(true); });

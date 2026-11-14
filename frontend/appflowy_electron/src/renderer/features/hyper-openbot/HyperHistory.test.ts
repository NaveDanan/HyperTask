import { expect, it, vi } from 'vitest';
import { readableTurns } from './HyperThreadMessages';
import { mergeStoredMessages } from './HyperHistoryMerge';
import { hyperMessageContent } from './HyperMessageContent';
import { hyperLoadAllChannels } from './HyperChannelPaging';
it('normalizes actual persisted tool dialect and counts corrupt history', () => {
  const result = readableTurns([{ id: 'call', role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'lookup', args: { q: 'test' } }] }, { id: 'bad', role: 'user', content: null }]);
  expect(result.unreadable).toBe(1);
  expect(result.messages[0]).toMatchObject({ toolCalls: [{ function: { name: 'lookup', arguments: '{"q":"test"}' } }] });
});
it('restores missing turns without replacing longer streamed text with lagging persisted text', () => {
  const live = [{ id: 'a', role: 'assistant' as const, content: 'complete live answer' }];
  const result = mergeStoredMessages(live, [{ id: 'u', role: 'user', content: 'question' }, { id: 'a', role: 'assistant', content: 'complete' }]);
  expect(result.map(message => message.id)).toEqual(['u', 'a']);
  expect(result[1].content).toBe('complete live answer');
});
it('replaces a waiting tool placeholder with its durable result and never regresses a final result', () => {
  const waiting = { id: 'tool', role: 'tool' as const, toolCallId: 'call', content: '{"waiting":true}' };
  for (const content of ['{"ok":true,"text":"done"}', '{"ok":false,"refused":true}', '{"ok":false,"error":"failed"}']) {
    const final = { ...waiting, content };
    expect(mergeStoredMessages([waiting], [final])).toEqual([final]);
    expect(mergeStoredMessages([final], [waiting])).toEqual([final]);
  }
  const otherCall = { ...waiting, toolCallId: 'different', content: '{"ok":true}' };
  expect(mergeStoredMessages([waiting], [otherCall])).toEqual([waiting]);
});
it('renders compound text and attachment identity without serializing metadata', () => {
  expect(hyperMessageContent([{ type: 'text', text: 'Caption' }, { type: 'document', source: { type: 'url', value: '/api/attachments/a' }, metadata: { attachmentId: 'a', filename: 'notes.txt' } }])).toEqual({ text: 'Caption', attachments: [{ id: 'a', name: 'notes.txt', image: false, mimeType: undefined }] });
});
it('loads pages after the first fifty and deduplicates channel IDs', async () => {
  const read = vi.fn().mockResolvedValueOnce({ channels: [{ id: 'one' }], nextCursor: 'next value' }).mockResolvedValueOnce({ channels: [{ id: 'two' }, { id: 'one' }], nextCursor: null });
  const result = await hyperLoadAllChannels(read);
  expect(result.channels.map(channel => channel.id)).toEqual(['one', 'two']);
  expect(read).toHaveBeenLastCalledWith('/api/channels?cursor=next%20value');
});

import { expect, it, vi } from 'vitest';
vi.mock('./HyperGalleryRuntime', () => ({ useHyperGalleryCall: () => undefined, hyperAnswerGalleryCall: vi.fn() }));
vi.mock('./HyperGalleryRegistry', () => ({ hyperGalleryComponent: () => undefined }));
vi.mock('./HyperGenerativeActivity', () => ({ HyperGenerativeActivity: () => null }));
vi.mock('./HyperInteractiveResult', () => ({ HyperInteractiveResult: () => null }));
vi.mock('../routines/HyperRoutineNavigation', async original => ({ ...await original<typeof import('../routines/HyperRoutineNavigation')>(), useHyperRoutineNavigation: () => undefined }));
import { HyperConversationResult } from './HyperConversationResult';
import { HyperAppAccessAction } from '../connections';
const tool = { id: 'call', label: 'show_app_access', status: 'complete' as const, result: '[connect-app]{"serverId":"mail","title":"Mail","agentId":"bot-1","reason":"access"}' };
it('mounts access using verified calling Bot and app, without inventing an identity', () => {
  const node = HyperConversationResult({ tool, callingBotId: 'bot-1' });
  expect(node?.props.children.type).toBe(HyperAppAccessAction);
  expect(node?.props.children.props).toMatchObject({ agentId: 'bot-1', app: 'mail' });
  expect(HyperConversationResult({ tool })?.props.children).toBeUndefined();
  expect(HyperConversationResult({ tool, callingBotId: 'other-bot' })?.props.children).toBeUndefined();
});
it('preserves refusal even when the app access read may later say ready', () => {
  const node = HyperConversationResult({ tool: { ...tool, status: 'refused', result: tool.result.replace('access', 'reconnect') }, callingBotId: 'bot-1' });
  expect(node?.props.children.props.refusal).toBe('reconnect');
});

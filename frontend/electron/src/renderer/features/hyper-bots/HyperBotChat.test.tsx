import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { HYPER_BOTS_DEFAULT_SETTINGS, type HyperBotsSnapshot } from '@shared/HyperBots';
import { HyperBotsOutbox } from './HyperBotsController';
import { HyperBotsView } from './HyperBotScreen';

vi.mock('./HyperBotComposer', () => ({
  HyperBotsComposerBox: ({ bots }: { bots: readonly { id: string }[] }) => (
    <div data-composer-bots={bots.map(({ id }) => id).join(',')} />
  ),
}));

it.each([
  { kind: 'group' as const, memberId: 'scout' },
  { kind: 'direct' as const, memberId: 'scribe' },
])('supplies only current $kind room members to the composer', ({ kind, memberId }) => {
  const roomId = 'test-room';
  const settings = {
    ...HYPER_BOTS_DEFAULT_SETTINGS,
    rooms: [{ id: roomId, name: 'Test room', kind, botIds: [memberId] }],
  };
  const snapshot: HyperBotsSnapshot = {
    settings,
    roomId,
    messages: [],
    runs: [],
    approvals: [],
    connections: {
      model: { ready: true, detail: 'test', defaultModel: 'test' },
      outlook: { ready: false, problem: '' },
      jira: { ready: false, problem: '' },
    },
  };
  const html = renderToStaticMarkup(
    <HyperBotsView
      state={{ phase: 'ready', snapshot, models: [], deciding: [], sending: false, saving: false }}
      outbox={new HyperBotsOutbox()}
      actions={{ select: vi.fn(), reload: vi.fn(), send: vi.fn(), decide: vi.fn(), saveSettings: vi.fn() }}
    />,
  );
  expect(html).toContain('data-composer-bots="' + memberId + '"');
});

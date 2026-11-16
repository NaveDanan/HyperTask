import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { HyperTriggerRow } from './HyperRoutineTriggers';
import type { TriggerRecord } from './HyperRoutineTypes';

it('offers native trigger-key delivery without a renderer secret output or copy handler', () => {
  const trigger = { id: 'trigger', kind: 'webhook', enabled: true, path: '/api/events/trigger', config: {} } as TriggerRecord;
  const html = renderToStaticMarkup(<HyperTriggerRow trigger={trigger} refresh={vi.fn()} completed={false} publicOrigin="" />);
  expect(html).toContain('Reveal key'); expect(html).toContain('Rotate key');
  expect(html).not.toContain('<output'); expect(html).not.toContain('Copy authorization header');
});

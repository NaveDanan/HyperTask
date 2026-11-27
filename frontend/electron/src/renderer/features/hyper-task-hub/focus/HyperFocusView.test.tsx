import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HyperHubSnapshot } from '@shared/HyperTaskHub';
import { HyperHubM2Fixture, HyperHubM2NoAvailabilityFixture } from '@shared/HyperTaskHub.fixtures';
import { HyperTaskHubView } from '../HyperTaskHubView';
import { hyperFocusToday } from './hyperFocusToday';

const noop = () => {};
const render = (snapshot: HyperHubSnapshot) => renderToStaticMarkup(<HyperTaskHubView snapshot={snapshot} loading={false} error={null} refreshing={false}
  nowMs={Date.parse(snapshot.asOf.iso)} view="focus" onViewChange={noop} onRefresh={noop} onRetry={noop} onFeedback={noop} onOpenSource={noop} onSetup={noop} />);

describe('Focus', () => {
  it('leads with a feasible recommendation and its sentence when availability is covered', () => {
    const today = hyperFocusToday(HyperHubM2Fixture, undefined, 'en');
    expect(today.recommendation).not.toBeNull();
    expect(today.recommendation!.text.length).toBeGreaterThan(10);
    const html = render(HyperHubM2Fixture);
    expect(html).toContain('data-hyper-do-first');
    expect(html).toContain(today.recommendation!.task.title);
    expect(html).toContain('data-hyper-day-plan');
    expect(html).toContain(today.capacity.text);
  });

  it('never shows a private agenda title', () => {
    const hidden = (HyperHubM2Fixture.agenda ?? []).filter(item => item.private);
    expect(hidden.length).toBeGreaterThan(0);
    const today = hyperFocusToday(HyperHubM2Fixture, undefined, 'en');
    for (const item of today.agenda.filter(entry => entry.private)) expect('title' in item && item.title).toBeFalsy();
  });

  it('asks for a free window instead of inventing time when there is no availability', () => {
    const today = hyperFocusToday(HyperHubM2NoAvailabilityFixture, undefined, 'en');
    expect(today.needsOwnerWindow).toBe(true);
    expect(today.blocks).toHaveLength(0);
    const html = render(HyperHubM2NoAvailabilityFixture);
    expect(html).toContain('When are you free today?');
    expect(html).not.toContain('data-hyper-day-plan');
  });

  it('formats the recommendation in Hebrew', () => {
    const today = hyperFocusToday(HyperHubM2Fixture, undefined, 'he');
    expect(today.recommendation?.text).toMatch(/[֐-׿]/);
  });
});

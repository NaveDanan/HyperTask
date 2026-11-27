import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HyperHubSnapshot } from '@shared/HyperTaskHub';
import { HyperHubEmptyFixture, HyperHubM1Fixture, HyperHubNothingConnectedFixture } from '@shared/HyperTaskHub.fixtures';
import { hyperHubBoardColumns, HyperTaskHubView, type HyperTaskHubViewProps } from './HyperTaskHubView';

const noop = () => {};
function render(snapshot: HyperHubSnapshot | null, props: Partial<HyperTaskHubViewProps> = {}) {
  return renderToStaticMarkup(<HyperTaskHubView snapshot={snapshot} loading={false} error={null} refreshing={false}
    nowMs={Date.parse(HyperHubM1Fixture.asOf.iso)} view="board" onViewChange={noop}
    onRefresh={noop} onRetry={noop} onFeedback={noop} onOpenSource={noop} onSetup={noop} {...props} />);
}

describe('hyperHubBoardColumns', () => {
  it('orders Next by the ranked Focus order, pinned first, and keeps ranks under a text search', () => {
    const { columns, ranks } = hyperHubBoardColumns(HyperHubM1Fixture, undefined, '');
    const next = columns.find(column => column.id === 'ready')!;
    expect(next.taskIds[0]).toBe(HyperHubM1Fixture.tasks.find(task => task.pinned)!.id);
    expect(next.taskIds.map(id => ranks.get(id))).toEqual(next.taskIds.map((_, index) => index + 1));
    const searched = hyperHubBoardColumns(HyperHubM1Fixture, undefined, 'staging');
    const only = searched.columns.find(column => column.id === 'ready')!.taskIds;
    expect(only).toHaveLength(1);
    expect(searched.ranks.get(only[0])).toBe(ranks.get(only[0]));
  });
});

describe('HyperTaskHubView', () => {
  it('renders the five Board columns with every non-dismissed fixture task', () => {
    const html = render(HyperHubM1Fixture);
    for (const id of ['review', 'ready', 'doing', 'waiting', 'done']) expect(html).toContain(`data-hyper-hub-column="${id}"`);
    for (const task of HyperHubM1Fixture.tasks.filter(task => task.state !== 'dismissed')) expect(html).toContain(task.title);
    expect(html).not.toContain('Retire the old screenshot checklist');
  });

  it('shows a merged Jira issue and its mirror as one card with both sources', () => {
    const html = render(HyperHubM1Fixture);
    expect(html.match(/>אישור migration של טבלת הלקוחות<\/p>/g)).toHaveLength(1);
    expect(html).toContain('ENG-317');
    expect(html).toContain('+1');
    expect(html).toContain('Jira: <bdi>In Progress</bdi>');
  });

  it('marks user content for bidirectional text and labels estimates and overdue dates', () => {
    const html = render(HyperHubM1Fixture);
    expect(html).toContain('dir="auto"');
    expect(html).toContain('~45 min');
    expect(html).toContain('Overdue');
  });

  it('offers a "Why?" score on ranked cards outside Triage', () => {
    const html = render(HyperHubM1Fixture);
    const migration = HyperHubM1Fixture.ranking.find(ranked => ranked.taskId === HyperHubM1Fixture.tasks[0].id)!;
    expect(html).toContain(`Score ${(migration.scoreCents / 100).toFixed(2)}`);
    expect(html).not.toContain('Why is Confirm RTL examples with Design ranked here');
  });

  it('shows each source status chip, including partial, stale and failed sources', () => {
    const html = render(HyperHubM1Fixture);
    expect(html).toContain('Jira · Engineering');
    expect(html).toContain('partial');
    expect(html).toContain('stale');
    expect(html).toContain('failed');
  });

  it('asks for setup when nothing is connected', () => {
    const html = render(HyperHubNothingConnectedFixture);
    expect(html).toContain('Set up Task Hub');
    expect(html).not.toContain('data-hyper-hub-board');
  });

  it('keeps empty columns when a connected source has no tasks', () => {
    const html = render(HyperHubEmptyFixture);
    expect(html).toContain('data-hyper-hub-board');
    expect(html).toContain('Nothing to triage');
  });

  it('shows loading and load errors before the first snapshot', () => {
    expect(render(null, { loading: true })).toContain('aria-busy="true"');
    const failed = render(null, { error: 'Main process unavailable' });
    expect(failed).toContain('Task Hub could not be loaded');
    expect(failed).toContain('Main process unavailable');
  });
});

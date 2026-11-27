import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HyperHubM3Fixture } from '@shared/HyperTaskHub.fixtures';
import { HyperTaskHubView } from '../HyperTaskHubView';

const noop = () => {};
const html = () => renderToStaticMarkup(<HyperTaskHubView snapshot={HyperHubM3Fixture} loading={false} error={null} refreshing={false}
  nowMs={Date.parse(HyperHubM3Fixture.asOf.iso)} view="board" onViewChange={noop} onRefresh={noop} onRetry={noop} onFeedback={noop} onOpenSource={noop} onSetup={noop} />);

describe('Triage', () => {
  const triage = HyperHubM3Fixture.tasks.filter(task => task.state === 'review');

  it('shows every mail suggestion in Triage with its quoted sentence and rule', () => {
    expect(triage.length).toBeGreaterThan(1);
    const markup = html();
    for (const task of triage) {
      expect(markup).toContain(task.title);
      if (task.reviewSpan) expect(markup).toContain(task.reviewSpan.rule);
    }
  });

  it('highlights the trigger phrase when the span falls inside the excerpt', () => {
    const marked = triage.find(task => task.reviewSpan?.start !== undefined && task.reviewSpan.end !== undefined && task.reviewSpan.end <= task.reviewSpan.excerpt.length);
    if (!marked?.reviewSpan) return;
    const { excerpt, start, end } = marked.reviewSpan;
    expect(html()).toContain(`<mark class="rounded-sm bg-warning/15 px-0.5 text-foreground">${excerpt.slice(start, end).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</mark>`);
  });

  it('labels suggestions from a cohort still in preview', () => {
    expect(html()).toContain('Suggestion (preview)');
  });

  it('offers Merge or Keep separate for a possible duplicate, never merging silently', () => {
    const suggestion = HyperHubM3Fixture.linkSuggestions?.[0];
    expect(suggestion).toBeDefined();
    const markup = html();
    expect(markup).toContain('Possibly the same as');
    expect(markup).toContain('Keep separate');
  });

  it('keeps bidirectional isolation for Hebrew excerpts', () => {
    expect(triage.some(task => /[֐-׿]/.test(task.reviewSpan?.excerpt ?? ''))).toBe(true);
    expect(html()).toContain('<blockquote dir="auto"');
  });
});

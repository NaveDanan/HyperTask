import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HyperHubM5Fixture } from '@shared/HyperTaskHub.fixtures';
import type { HyperHubCardActions } from '../board/HyperHubCard';
import { HyperMatrixView } from '../matrix/HyperMatrixView';
import { HyperTimelineView } from '../timeline/HyperTimelineView';
import { HyperMeetingsView } from './HyperMeetingsView';

const nowMs = Date.parse(HyperHubM5Fixture.asOf.iso);
const actions: HyperHubCardActions = { feedback: () => {}, openSource: () => {}, changeStatus: () => {}, releaseHold: () => {}, addToKanban: () => {} };

describe('Meetings view', () => {
  const html = renderToStaticMarkup(<HyperMeetingsView snapshot={HyperHubM5Fixture} nowMs={nowMs} query="" onOpenBrief={() => {}} />);
  it('lists the next seven days with today first', () => {
    expect(html).toContain('Next 7 days');
    expect(html).toContain('>Today<');
    expect(html).toContain('>Tomorrow<');
  });
  it('shows private items only as Busy and keeps empty days', () => {
    expect(html).toContain('Busy');
    expect(html).toContain('No meetings');
  });
  it('shows readiness and the Needs prep count', () => {
    expect(html).toContain('Prep planned');
    expect(html).toContain('Not prepared');
    expect(html).toMatch(/Needs prep<span[^>]*>\d+</);
  });
  it('marks partly read days', () => {
    expect(html).toContain('Calendar only partly read for this day');
  });
});

describe('Matrix view', () => {
  const html = renderToStaticMarkup(<HyperMatrixView snapshot={HyperHubM5Fixture} query="" nowMs={nowMs} actions={actions} onQuadrant={() => {}} />);
  it('renders the four quadrants with descriptive labels and no "Do first"', () => {
    for (const label of ['Urgent and important', 'Important', 'Schedule', 'Urgent', 'Fit in', 'Neither', 'Later']) expect(html).toContain(label);
    expect(html).not.toContain('Do first');
  });
  it('keeps unknown axes in Needs details and marks the owner override', () => {
    expect(html).toContain('Needs details');
    expect(html).toContain('Moved by you');
  });
  it('keeps Waiting cards in their quadrant with the blocker', () => {
    expect(html).toContain('Waiting');
  });
});

describe('Timeline view', () => {
  it('renders without editing controls and lists undated work', () => {
    const html = renderToStaticMarkup(<HyperTimelineView snapshot={HyperHubM5Fixture} query="" nowMs={nowMs} actions={actions} />);
    expect(html).toContain('4 weeks');
    expect(html).toContain('No dates (');
    expect(html).not.toContain('Click to schedule');
  });
});

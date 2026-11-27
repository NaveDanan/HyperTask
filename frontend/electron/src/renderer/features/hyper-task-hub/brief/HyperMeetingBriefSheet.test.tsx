import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HyperMeetingBriefRow, HyperMeetingBriefSections, HyperReadinessBadge } from './HyperMeetingBriefSheet';
import { HyperMeetingBriefSample } from './HyperMeetingBrief.sample';

const nowMs = Date.parse('2026-11-29T11:35:00+02:00');
const render = () => renderToStaticMarkup(<HyperMeetingBriefSections brief={HyperMeetingBriefSample}
  row={(item, extra) => <HyperMeetingBriefRow key={item.id} item={item} nowMs={nowMs} extra={extra} />} />);

describe('Meeting brief sheet', () => {
  it('shows cited sections with why each item matched', () => {
    const html = render();
    const sections = ['My open actions', 'Blockers', 'Recent threads', 'Linked documents'];
    const brief = HyperMeetingBriefSample;
    const present = { 'My open actions': brief.openActions.length, Blockers: brief.blockers.length, 'Recent threads': brief.threads.length, 'Linked documents': 1 };
    for (const title of sections) if (present[title as keyof typeof present]) expect(html).toContain(title);
    expect(html).toContain('ENG-317');
  });

  it('groups a thread under its best message and mentions the rest', () => {
    const thread = HyperMeetingBriefSample.threads[0];
    if (!thread) return;
    const html = render();
    expect(html).toContain(thread.messages[0].subject.replace(/&/g, '&amp;'));
    if (thread.messages.length > 1) expect(html).toContain(`+${thread.messages.length - 1} more in this thread`);
  });

  it('isolates bidirectional text in subjects and excerpts', () => {
    expect(render()).toContain('dir="auto"');
  });

  it('states readiness from the brief, with planned prep when a block is scheduled', () => {
    expect(HyperMeetingBriefSample.readiness).toBe('planned');
    expect(renderToStaticMarkup(<HyperReadinessBadge readiness={HyperMeetingBriefSample.readiness} />)).toContain('Prep planned');
  });

  it('says so when there are no linked documents', () => {
    const html = renderToStaticMarkup(<HyperMeetingBriefSections brief={{ ...HyperMeetingBriefSample, linkedDocuments: [] }}
      row={item => <HyperMeetingBriefRow key={item.id} item={item} nowMs={nowMs} />} />);
    expect(html).toContain('No linked documents.');
  });
});

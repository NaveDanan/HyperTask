import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HyperApproval, HyperCommandOutput, HyperDecisionCard, HyperToolActivity, hyperPartsAnswer } from './index';

describe('Hyper activity ports', () => {
  it('keeps handoff choices separate from standing permissions', () => {
    const html = renderToStaticMarkup(<HyperApproval request={{ id: 'a', title: 'Save file', handOff: true, offersStandingRule: true }} onDecide={() => {}} />);
    expect(html).toContain('I did it myself');
    expect(html).toContain('Don&#x27;t do it');
    expect(html).not.toContain('Always allow here');
  });
  it('collapses answered choices', () => {
    const html = renderToStaticMarkup(<HyperDecisionCard title="Save?" options={[{ value: 'yes', label: 'Allow once' }]} answer={{ label: 'Allowed once' }} onSubmit={() => {}} />);
    expect(html).toContain('Allowed once');
    expect(html).not.toContain('type="radio"');
  });
  it('preserves command outcome notices without inventing output', () => {
    const html = renderToStaticMarkup(<HyperCommandOutput output="" exitCode={2} timedOut truncated />);
    expect(html).toContain('It printed nothing.');
    expect(html).toContain('Exit code 2.');
    expect(html).toContain('It ran too long');
  });
  it('places approval outside the collapsed tool group', () => {
    const html = renderToStaticMarkup(<HyperToolActivity steps={[{ id: 'step', label: 'Save', status: 'waiting', approval: <p>Approve this action</p> }]} />);
    expect(html.indexOf('Approve this action')).toBeGreaterThan(html.lastIndexOf('</details>'));
  });
  it('serializes multipart answers in upstream format', () => {
    expect(hyperPartsAnswer([{ header: 'Scope', question: 'Where?' }, { header: 'Time', question: 'When?' }], ['Here', 'Now'])).toBe('Scope: Here\nTime: Now');
  });
});

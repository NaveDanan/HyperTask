import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HyperGovernanceReport } from './HyperGovernanceReports';
import { HyperBoundaryReplay } from './HyperBoundaryReplay';
import { HyperEvidence } from './HyperEvidence';
import { hyperGovernanceFailure } from './HyperGovernanceUi';
vi.stubGlobal('React', React);
describe('native governance presentation', () => {
  it('distinguishes all evaluated members from those whose permissions change', () => {
    const value = { check: { ok: true }, warning: null, counts: { people: 20, losing: 1, gaining: 0, keeping: 0, unchanged: 19 }, activity: { days: 30, unmapped: [] }, people: [{ id: 'p', name: 'Person', email: 'p@example.test', role: 'user', groups: [], capabilities: [{ capability: 'useBots', title: 'Use Bots', before: { allowed: true, decidedBy: 'default', scopeId: '' }, after: { allowed: false, decidedBy: 'organization', scopeId: '' } }] }] };
    const html = renderToStaticMarkup(<HyperGovernanceReport kind="permissions" value={value} />);
    expect(html).toContain('20 people evaluated'); expect(html).toContain('1 losing access'); expect(html).toContain('Use Bots'); expect(html).toContain('Refused');
  });
  it('presents replay rows in a table with validation and warnings', () => {
    const html = renderToStaticMarkup(<HyperEvidence value={{ check: { ok: false, error: 'Unknown tool', problems: [] }, warning: 'Covers every action', report: { scanned: 20, changes: [{ bot: 'Bot', was: 'allowed', would: 'refused' }] } }} />);
    expect(html).toContain('<table'); expect(html).toContain('Unknown tool'); expect(html).toContain('Covers every action'); expect(html).toContain('scanned');
  });
  it('shows only actions attributed to this boundary in each replay view', () => {
    const value = { report: { scanned: 10, wouldRefuse: 1, wouldAllow: 1, unchanged: 8, changes: [{ id: 'stopped', would: 'refused', action: 'Click' }, { id: 'released', would: 'allowed', action: 'Read' }] } };
    const preview = renderToStaticMarkup(<HyperBoundaryReplay value={value} />);
    const saved = renderToStaticMarkup(<HyperBoundaryReplay value={value} saved />);
    expect(preview).toContain('Click'); expect(preview).not.toContain('released');
    expect(saved).toContain('Read'); expect(saved).not.toContain('stopped</span>');
  });
  it('keeps remote labels, model readings and audit content inert', () => {
    const html = renderToStaticMarkup(<HyperEvidence value={{ explanation: '<script>alert(1)</script>', rows: [{ reason: '<img src=x onerror=alert(1)>' }] }} />);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;script&gt;');
  });
  it('shows refusals and configuration failures without echoing remote secrets', () => {
    expect(hyperGovernanceFailure(new Error('OpenBot request failed (403): synthetic-secret'))).toContain('refused');
    expect(hyperGovernanceFailure(new Error('OpenBot request failed (503): synthetic-secret'))).toContain('configured');
    expect(hyperGovernanceFailure(new Error('synthetic-secret'))).not.toContain('synthetic-secret');
  });
});

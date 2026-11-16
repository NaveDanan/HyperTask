import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HyperTemplateCard } from './TemplateCard';
import { entryNamed, manifest } from './test-support';

describe('template card', () => {
  it('renders the template’s own summary with an accessible description', () => {
    const entry = entryNamed('Bug-Tracker-13a84186');
    const markup = renderToStaticMarkup(createElement(HyperTemplateCard, { entry, importing: false, onImport: vi.fn() }));
    for (const text of entry.preview!.highlights) expect(markup).toContain(text);
    expect(markup).toContain('No image in the published template. Contains:'); expect(markup).toContain('Use template'); expect(markup).not.toContain('<img');
  });
  it('shows the summary while image bytes load or when no loader is available', () => {
    const entry = entryNamed('Business-Overview-One-Pager');
    const markup = renderToStaticMarkup(createElement(HyperTemplateCard, { entry, importing: false, onImport: vi.fn() }));
    expect(markup).toContain(`Preview of ${entry.name}`); expect(markup).not.toContain('<img');
  });
  it('disables unavailable templates and in-flight imports', () => {
    const unavailable = renderToStaticMarkup(createElement(HyperTemplateCard, { entry: manifest.templates.find(t => !t.isAvailable)!, importing: false, onImport: vi.fn() }));
    expect(unavailable).toContain('Unavailable'); expect(unavailable).toContain('disabled');
    const importing = renderToStaticMarkup(createElement(HyperTemplateCard, { entry: entryNamed('Bug-Tracker-13a84186'), importing: true, onImport: vi.fn() }));
    expect(importing).toContain('Importing…'); expect(importing).toContain('disabled'); expect(importing).toContain('role="status"');
  });
});
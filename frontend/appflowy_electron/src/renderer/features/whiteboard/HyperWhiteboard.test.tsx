import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStore } from 'zustand';
import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import type { HyperDocumentSession, HyperDocumentState } from '../document/HyperDocumentSession';
import { hyperInsertCanvasElement } from './HyperWhiteboardModel';
import { HyperWhiteboard } from './HyperWhiteboard';

vi.mock('@/i18n', () => ({ useTr: () => ({ tr: (key: string) => key }) }));
function session(text: string): HyperDocumentSession {
  const document = create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' } }, meta: { childrenMap: { children: { children: [] } } } });
  const note = hyperInsertCanvasElement(document, 'note', { x: 0, y: 0, width: 200, height: 100 }, { text });
  return { store: createStore<HyperDocumentState>(() => ({ document: note.document, status: 'ready', error: null, historyPending: false })), change: vi.fn(), history: vi.fn() } as unknown as HyperDocumentSession;
}
describe('Hyper whiteboard markup', () => {
  it('offers keyboard-focusable canvas elements and escapes stored note text', () => {
    const markup = renderToStaticMarkup(createElement(HyperWhiteboard, { session: session('<script>bad()</script>'), editable: true }));
    expect(markup).toContain('role="application"');
    expect(markup).toContain('role="button" tabindex="0"');
    expect(markup).toContain('aria-label="Note"');
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).not.toContain('<script>');
  });
  it('keeps navigation available while disabling modifications for read-only documents', () => {
    const markup = renderToStaticMarkup(createElement(HyperWhiteboard, { session: session('read only'), editable: false }));
    expect(markup).toContain('This canvas is read-only.');
    const button = (name: string) => markup.match(new RegExp(`<button(?=[^>]*aria-label="${name}")[^>]*>`))?.[0] ?? '';
    expect(button('Rectangle')).toMatch(/\sdisabled="/);
    expect(button('Note')).toMatch(/\sdisabled="/);
    expect(button('Zoom in')).not.toMatch(/\sdisabled="/);
  });
  it('renders generated-image placeholders with descriptions and no direct local file URLs', () => {
    const base = session('A note');
    const document = base.store.getState().document!;
    const image = hyperInsertCanvasElement(document, 'image', { x: 0, y: 0, width: 120, height: 180 }, { imagePath: '/private/workspace/images/generated.png', alt: 'A <generated> drawing' });
    const imageSession = { ...base, store: createStore<HyperDocumentState>(() => ({ ...base.store.getState(), document: image.document })) } as unknown as HyperDocumentSession;
    const markup = renderToStaticMarkup(createElement(HyperWhiteboard, { session: imageSession, editable: false }));
    expect(markup).toContain('data-image-state="loading"');
    expect(markup).toContain('A &lt;generated&gt; drawing');
    expect(markup).toContain('Loading image');
    expect(markup).not.toContain('/private/workspace'); expect(markup).not.toContain('file://');
    const lostSession = { ...base, store: createStore<HyperDocumentState>(() => ({ ...imageSession.store.getState(), status: 'error', error: 'The workspace changed.' })) } as unknown as HyperDocumentSession;
    const lostOwner = renderToStaticMarkup(createElement(HyperWhiteboard, { session: lostSession, editable: false }));
    expect(lostOwner).toContain('data-image-state="error"'); expect(lostOwner).toContain('Image unavailable');
  });
});

import { Children, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('desktop caption controls', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64)', true],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X)', false],
  ])('uses custom chrome for %s: %s', async (userAgent, expected) => {
    vi.stubGlobal('navigator', { userAgent });
    const chrome = await import('./window-controls');
    expect(chrome.customWindowChrome).toBe(expected);
    const markup = renderToStaticMarkup(<chrome.WindowControls />);
    for (const label of ['Minimize', 'Maximize', 'Close']) {
      expect(markup.includes(`aria-label="${label}"`)).toBe(expected);
      expect(markup.includes(`title="${label}"`)).toBe(expected);
    }
    expect(markup.includes('no-drag')).toBe(expected);
  });
  it('dispatches caption actions to the window API', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Linux' });
    const api = { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() };
    vi.stubGlobal('window', { appflowy: { window: api } });
    // Inspect the rendered button handlers through an SSR-compatible hook seam.
    vi.doMock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: () => [true, vi.fn()], useEffect: vi.fn() }));
    const { WindowControls } = await import('./window-controls');
    const controls = WindowControls({})!;
    const captions = Children.toArray(controls.props.children) as ReactElement<{ label: string; onClick: () => void }>[];
    expect(captions.map(button => button.props.label)).toEqual(['Minimize', 'Restore', 'Close']);
    captions.forEach(button => button.props.onClick());
    expect(api.minimize).toHaveBeenCalledOnce();
    expect(api.toggleMaximize).toHaveBeenCalledOnce();
    expect(api.close).toHaveBeenCalledOnce();
    vi.doUnmock('react');
  });
});

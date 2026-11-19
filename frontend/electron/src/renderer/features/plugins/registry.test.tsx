import { create } from '@bufbuild/protobuf';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/hyper-folder/view_pb';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { PluginType, viewPlugin } from '../tabs/plugin';

it('opens a saved Chat page as a retirement notice without accessing Electron IPC', async () => {
  const view = create(ViewPBSchema, { id: 'saved-chat', name: 'Saved Chat', layout: ViewLayoutPB.Chat });
  const ipcAccess = vi.fn(() => { throw new Error('A retired Chat page accessed Electron IPC'); });
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }));
  try {
    const { pluginBuilders, pluginWidgets } = await import('./registry');
    Object.defineProperty(window, 'hypertask', { get: ipcAccess });
    const plugin = viewPlugin(view);
    expect(plugin.type).toBe(PluginType.chat);
    const html = renderToStaticMarkup(pluginWidgets(plugin).buildWidget({}));
    expect(html).toContain('Saved Chat');
    expect(html).toContain('OpenBot Chat has been retired.');
    expect(ipcAccess).not.toHaveBeenCalled();
    expect(pluginBuilders().map(builder => builder.layout)).not.toContain(ViewLayoutPB.Chat);
  } finally {
    vi.unstubAllGlobals();
  }
});

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HyperDesktopSettingsView } from './HyperDesktopSettingsSection';

vi.mock('@/i18n', () => ({
  useTr: () => ({ tr: (key: string) => key }),
}));
vi.mock('@/ui/toast', () => ({
  showToast: vi.fn(),
}));

describe('HyperDesktopSettingsView', () => {
  it('renders OS auto-start default ON, close-to-tray, and active global hotkey badge', () => {
    const markup = renderToStaticMarkup(
      <HyperDesktopSettingsView
        settings={{
          autoStart: true,
          closeToTray: true,
          autoStartSupported: true,
          autoStartApplied: true,
          hotkey: 'Ctrl+Alt+Space',
          hotkeyRegistered: true,
        }}
        onUpdate={vi.fn()}
      />,
    );

    expect(markup).toContain('Startup &amp; Background');
    expect(markup).toContain('Start HyperTask with your OS');
    expect(markup).toContain('Keep running in system tray when closed');
    expect(markup).toContain('Global Hyper-Bot Voice Shortcut');
    expect(markup).toContain('Ctrl');
    expect(markup).toContain('Alt');
    expect(markup).toContain('Space');
    expect(markup).toContain('Active');
    expect(markup).not.toContain('OS login registration applies in the packaged desktop app');
  });

  it('shows dev/packaged notice and hotkey conflict hint when not applied or not registered', () => {
    const markup = renderToStaticMarkup(
      <HyperDesktopSettingsView
        settings={{
          autoStart: true,
          closeToTray: true,
          autoStartSupported: true,
          autoStartApplied: false,
          hotkey: 'Ctrl+Alt+Space',
          hotkeyRegistered: false,
          hotkeyError: 'Shortcut conflict detected',
        }}
        onUpdate={vi.fn()}
      />,
    );

    expect(markup).toContain('OS login registration applies in the packaged desktop app');
    expect(markup).toContain('Unavailable');
    expect(markup).toContain('Shortcut conflict detected');
  });
});

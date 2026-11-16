import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { showDialog } from '@/ui';
import { showChangePasswordDialog, showSetupPasswordDialog } from './PasswordDialogs';

vi.mock('@/ui', () => ({ showDialog: vi.fn(), showToast: vi.fn(), Tooltip: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/i18n', () => ({ tr: (key: string) => key, useTr: () => ({ tr: (key: string) => key }) }));
vi.mock('./password-store', () => ({ passwordActions: { changePassword: vi.fn(), setupPassword: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

describe('settings password dialogs', () => {
  it.each([
    [showChangePasswordDialog, 3],
    [showSetupPasswordDialog, 2],
  ])('keeps the non-dismissible host and all obscured fields', (open, count) => {
    open();
    expect(showDialog).toHaveBeenCalledWith(expect.any(Function), { barrierDismissible: false });
    const render = vi.mocked(showDialog).mock.calls[0][0];
    const markup = renderToStaticMarkup(render(vi.fn()));
    expect(markup.match(/type="password"/g)).toHaveLength(count);
    expect(markup.match(/autoComplete="current-password"/g)).toHaveLength(count);
    expect(markup).toContain('button.cancel');
    expect(markup).toContain('button.save');
    expect(markup.match(/Show password/g)).toHaveLength(count);
  });
});

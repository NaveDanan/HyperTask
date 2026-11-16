import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast, ToastHost } from './toast';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));
beforeEach(() => vi.clearAllMocks());

describe('showToast compatibility', () => {
  it.each(['success', 'error', 'warning'] as const)('routes %s notifications and preserves duration/close button', (type) => {
    showToast({ message: 'Saved', type, showCloseButton: true });
    expect(toast[type]).toHaveBeenCalledWith('Saved', expect.objectContaining({ duration: 3000, closeButton: true }));
  });

  it('defaults to success and keeps its void return', () => {
    expect(showToast({ message: 'Saved' })).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith('Saved', expect.objectContaining({ closeButton: false }));
    expect(ToastHost()).toBeNull();
  });

  it('notifies dismissal once whether Sonner expires or manually dismisses the toast', () => {
    const onDismissed = vi.fn();
    showToast({ message: 'Saved', onDismissed });
    const [, options] = vi.mocked(toast.success).mock.calls[0];
    options?.onAutoClose?.({ id: 1, title: 'Saved' });
    options?.onDismiss?.({ id: 1, title: 'Saved' });
    expect(onDismissed).toHaveBeenCalledTimes(1);
  });
});

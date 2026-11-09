import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { FlowySvg } from '@/icons/FlowySvg';

export type ToastType = 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  message: ReactNode;
  type: ToastType;
  showCloseButton: boolean;
  onDismissed?: () => void;
}

const useToastStore = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let nextId = 1;

const AUTO_CLOSE_MS = 3000;

function dismiss(id: number) {
  const toast = useToastStore.getState().toasts.find((t) => t.id === id);
  useToastStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  toast?.onDismissed?.();
}

/** showToastNotification (workspace/presentation/widgets/dialogs.dart): bottom-center, 3 s. */
export function showToast({
  message,
  type = 'success',
  showCloseButton = false,
  onDismissed,
}: {
  message: ReactNode;
  type?: ToastType;
  showCloseButton?: boolean;
  onDismissed?: () => void;
}) {
  const id = nextId++;
  useToastStore.setState((s) => ({ toasts: [...s.toasts, { id, message, type, showCloseButton, onDismissed }] }));
  window.setTimeout(() => dismiss(id), AUTO_CLOSE_MS);
}

const ICONS = {
  success: 'toast_checked_filled_s',
  warning: 'toast_warning_filled_s',
  error: 'toast_error_filled_s',
} as const;

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  useEffect(() => () => useToastStore.setState({ toasts: [] }), []);
  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 12,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            marginBottom: 32,
            maxWidth: 360,
            padding: '12px 16px',
            borderRadius: 12,
            background: 'var(--af-surface-inverse)',
            boxShadow: 'var(--af-shadow-small)',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'auto',
            animation: 'flowy-toast-in 600ms ease',
          }}
        >
          <FlowySvg svg={ICONS[toast.type]} size={20} blendMode={null} />
          <div
            style={{
              marginLeft: 8,
              color: 'var(--af-text-on-fill)',
              fontSize: 'calc(14px * var(--text-scale, 1))',
              lineHeight: '20px',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {toast.message}
          </div>
          {toast.showCloseButton && (
            <div style={{ marginLeft: 16, width: 24, height: 24, display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => dismiss(toast.id)}>
              <FlowySvg svg="toast_close_s" size={20} color="#BDBDBD" />
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

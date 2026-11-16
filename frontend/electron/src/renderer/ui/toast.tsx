import type { ReactNode } from 'react';
import { toast } from 'sonner';

export type ToastType = 'success' | 'warning' | 'error';

/** Compatibility entry point: three-second notifications through the app's Toaster. */
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
  // Sonner has separate callbacks for manual dismiss and expiry; notify once for either.
  let dismissed = false;
  const notifyDismissed = () => {
    if (dismissed) return;
    dismissed = true;
    onDismissed?.();
  };
  const options = { duration: 3000, closeButton: showCloseButton, onDismiss: notifyDismissed, onAutoClose: notifyDismissed };
  if (type === 'success') toast.success(message, options);
  else if (type === 'error') toast.error(message, options);
  else if (type === 'warning') toast.warning(message, options);
  else toast(message, options);
}

export function ToastHost() {
  return null;
}

// t3code's toastManager (apps/web/src/components/ui/toast.tsx) as the voice code calls it, shown with HyperTask's
// own toaster (sonner). Copyright (c) 2026 T3 Tools Inc., MIT License. See src/shared/hyper-voice/NOTICE.md.
import type { ReactNode } from 'react';
import { toast } from 'sonner';

type ToastInput = {
  type?: 'error' | 'warning' | 'success' | 'info' | 'loading';
  title: ReactNode;
  description?: ReactNode;
  timeout?: number;
  actionProps?: { children: ReactNode; onClick: () => void };
};

export const toastManager = {
  add({ type, title, description, timeout, actionProps }: ToastInput) {
    const options = {
      description,
      ...(timeout !== undefined ? { duration: timeout } : {}),
      ...(actionProps ? { action: { label: actionProps.children, onClick: actionProps.onClick } } : {}),
    };
    switch (type) {
      case 'error':
        return toast.error(title, options);
      case 'warning':
        return toast.warning(title, options);
      case 'success':
        return toast.success(title, options);
      case 'loading':
        return toast.loading(title, options);
      default:
        return toast(title, options);
    }
  },
  close(id: string | number) {
    toast.dismiss(id);
  },
};

import type { ComponentProps, ReactNode } from 'react';
import { X } from 'lucide-react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { showToast } from '@/ui';
import { cn } from '@/lib/utils';
import { asJiraException, type HyperJiraStore, type JiraException } from '..';

export type HyperJiraStoreHook = UseBoundStore<StoreApi<HyperJiraStore>>;

export function HyperJiraIconButton({ label, children, size = 'icon-sm', ...props }: Omit<ComponentProps<typeof Button>, 'size'> & { label: string; size?: 'icon-sm' | 'icon-xs' }) {
  return <Tooltip><TooltipTrigger render={<Button type="button" variant="ghost" size={size} aria-label={label} {...props} />}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

export function HyperJiraAvatar({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('').toUpperCase();
  return <Avatar size="sm" className="size-6" aria-hidden="true"><AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback></Avatar>;
}

export function HyperJiraNotice({ title, message, variant = 'info', actions, onDismiss }: {
  title?: string; message: string; variant?: 'info' | 'warning' | 'success' | 'destructive'; actions?: ReactNode; onDismiss?: () => void;
}) {
  return <Alert variant={variant} role={variant === 'destructive' ? 'alert' : 'status'} className={cn(onDismiss && 'pr-12')}>
    {title && <AlertTitle className="line-clamp-none text-sm">{title}</AlertTitle>}
    <AlertDescription className="gap-2 whitespace-pre-wrap text-xs text-foreground">
      <span>{message}</span>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </AlertDescription>
    {onDismiss && <HyperJiraIconButton label="Dismiss" onClick={onDismiss} className="absolute top-2 right-2"><X className="size-4" /></HyperJiraIconButton>}
  </Alert>;
}

export function HyperJiraError({ error, actions, onDismiss }: { error: JiraException; actions?: ReactNode; onDismiss?: () => void }) {
  return <HyperJiraNotice variant={error.kind === 'conflict' ? 'warning' : 'destructive'} title={error.title + (error.statusCode == null ? '' : ` (HTTP ${error.statusCode})`)} message={error.message} actions={actions} onDismiss={onDismiss} />;
}

export function HyperJiraField({ id, label, required, helper, error, children }: {
  id: string; label: string; required?: boolean; helper?: string; error?: string; children: ReactNode;
}) {
  return <Field data-invalid={!!error}>
    <FieldLabel id={id + '-label'} htmlFor={id} className="text-xs font-medium">{label}{required && <span className="text-destructive">*</span>}</FieldLabel>
    {children}
    {error ? <FieldError id={id + '-help'} className="text-xs">{error}</FieldError> : helper ? <FieldDescription id={id + '-help'} className="text-xs">{helper}</FieldDescription> : null}
  </Field>;
}

export function HyperJiraModal({ title, onClose, children, footer, initialFocus }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; initialFocus?: ComponentProps<typeof DialogContent>['initialFocus'] }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent initialFocus={initialFocus} showCloseButton={false} aria-describedby={undefined} className="max-h-[min(45rem,calc(100vh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] shadow-xl sm:max-w-lg">
      <DialogHeader className="flex-row items-center justify-between gap-3">
        <DialogTitle className="text-base font-medium">{title}</DialogTitle>
        <HyperJiraIconButton label="Close" onClick={onClose}><X className="size-4" /></HyperJiraIconButton>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto p-1">{children}</div>
      <DialogFooter>{footer}</DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function formatHyperJiraRelative(time: Date | null, now = new Date()): string {
  if (!time) return 'never';
  const seconds = (now.getTime() - time.getTime()) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)} d ago`;
  return `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`;
}

export function openHyperJiraUrl(url: string) {
  void window.appflowy.shell.openExternal(url).catch(error => showToast({ message: asJiraException(error).message, type: 'error' }));
}

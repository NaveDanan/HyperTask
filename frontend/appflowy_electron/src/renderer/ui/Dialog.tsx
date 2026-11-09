import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { tr } from '@/i18n';

// A small dialog host: showDialog(...) pushes a dialog; each closes itself via the close callback.
interface DialogEntry {
  id: number;
  render: (close: () => void) => ReactNode;
  barrierColor?: string;
  barrierDismissible: boolean;
  onClosed?: () => void;
}

const useDialogStore = create<{ dialogs: DialogEntry[] }>(() => ({ dialogs: [] }));
let nextId = 1;

export interface ShowDialogOptions {
  /** Material showDialog default: black54. AF dialogs pass AF.surface.overlay (#00000099). */
  barrierColor?: string;
  barrierDismissible?: boolean;
  onClosed?: () => void;
}

/** showDialog: returns a function that closes the dialog. */
export function showDialog(render: (close: () => void) => ReactNode, options: ShowDialogOptions = {}): () => void {
  const id = nextId++;
  const close = () => {
    const entry = useDialogStore.getState().dialogs.find((d) => d.id === id);
    useDialogStore.setState((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) }));
    entry?.onClosed?.();
  };
  useDialogStore.setState((s) => ({
    dialogs: [
      ...s.dialogs,
      {
        id,
        render,
        barrierColor: options.barrierColor,
        barrierDismissible: options.barrierDismissible ?? true,
        onClosed: options.onClosed,
      },
    ],
  }));
  return close;
}

export function closeAllDialogs() {
  useDialogStore.setState({ dialogs: [] });
}

export function DialogHost() {
  const dialogs = useDialogStore((s) => s.dialogs);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const top = useDialogStore.getState().dialogs.at(-1);
      if (event.key === 'Escape' && top?.barrierDismissible) {
        event.stopPropagation();
        useDialogStore.setState((s) => ({ dialogs: s.dialogs.slice(0, -1) }));
        top.onClosed?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <>
      {dialogs.map((dialog) => {
        const close = () => {
          useDialogStore.setState((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== dialog.id) }));
          dialog.onClosed?.();
        };
        return (
          <div
            key={dialog.id}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in-0"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && dialog.barrierDismissible) close();
            }}
          >
            {dialog.render(close)}
          </div>
        );
      })}
    </>,
    document.body,
  );
}

const dialogSurfaceClass = 'rounded-xl bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 duration-100';
const customColor = (color?: string) => color?.includes('var(') ? undefined : color;

/** Compatibility surface; caller-computed dimensions remain inline. */
export function MaterialDialog({
  children, radius, background, width, style,
}: {
  children: ReactNode;
  radius?: number;
  background?: string;
  width?: CSSProperties['width'];
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(dialogSurfaceClass, 'flex max-h-[calc(100vh-48px)] max-w-[calc(100vw-80px)] flex-col')}
      style={{ width, borderRadius: radius, backgroundColor: customColor(background), ...style }}
    >
      {children}
    </div>
  );
}

export function FlowyDialog({
  children, width, minWidth, maxWidth, expandHeight = true,
}: {
  children: ReactNode;
  width?: CSSProperties['width'];
  minWidth?: number;
  maxWidth?: number;
  expandHeight?: boolean;
}) {
  return (
    <MaterialDialog width={width ?? '70vw'} style={{ minWidth, maxWidth: maxWidth ?? 'calc(100vw - 80px)', height: expandHeight ? '70vh' : undefined, overflow: 'hidden' }}>
      {children}
    </MaterialDialog>
  );
}

export function AFModal({ children, maxWidth = 400 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div className="w-full p-4" style={{ maxWidth: maxWidth + 32 }}>
      <div className={cn(dialogSurfaceClass, 'flex flex-col')}>{children}</div>
    </div>
  );
}

AFModal.Header = function AFModalHeader({ title, onClose }: { title: ReactNode; onClose?: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-4 pt-4">
      <div className="min-w-0 flex-1 text-base font-medium">{title}</div>
      {onClose && <Button type="button" variant="ghost" size="icon-sm" onClick={onClose}><X className="size-4" /></Button>}
    </div>
  );
};
AFModal.Body = ({ children, minHeight }: { children: ReactNode; minHeight?: number }) => (
  <div className="px-4 py-3" style={{ minHeight }}>{children}</div>
);
AFModal.Footer = ({ leading, trailing }: { leading?: ReactNode; trailing?: ReactNode }) => (
  <div className="flex items-center gap-3 rounded-b-xl border-t bg-muted/50 p-4">
    {leading}
    <div className="flex-1" />
    {trailing}
  </div>
);

/** AlertDialog layout inside the existing imperative host, preserving its focus/Escape rules. */
function HyperAlertDialogLayout({ children }: { children: ReactNode }) {
  return <div className={cn(dialogSurfaceClass, 'grid w-[min(26rem,calc(100vw-2rem))] gap-4 p-4')}>{children}</div>;
}
function HyperAlertDialogHeading({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1 truncate text-base font-medium">{title}</div>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onClose}><X className="size-4" /></Button>
    </div>
  );
}
const alertFooterClass = '-mx-4 -mb-4 flex flex-row justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4';
const destructiveConfirmClass = 'bg-destructive text-white hover:bg-destructive/90';

/** showSimpleAFDialog (dialog_v2.dart). */
export function showSimpleAFDialog({
  title,
  content,
  isDestructive,
  primaryAction,
  secondaryAction,
  barrierDismissible = true,
}: {
  title: string;
  content: string;
  isDestructive?: boolean;
  primaryAction: [string, (() => void)?];
  secondaryAction?: [string, (() => void)?];
  barrierDismissible?: boolean;
}) {
  showDialog(
    (close) => (
      <HyperAlertDialogLayout>
        <HyperAlertDialogHeading title={title} onClose={close} />
        <div className="text-sm text-muted-foreground">{content}</div>
        <AlertDialogFooter className={alertFooterClass}>
          {secondaryAction && <Button type="button" variant="outline" onClick={() => { secondaryAction[1]?.(); close(); }}>{secondaryAction[0]}</Button>}
          <Button type="button" className={isDestructive ? destructiveConfirmClass : undefined} onClick={() => { primaryAction[1]?.(); close(); }}>{primaryAction[0]}</Button>
        </AlertDialogFooter>
      </HyperAlertDialogLayout>
    ),
    { barrierDismissible },
  );
}

function TextFieldDialog({
  title,
  initialValue,
  hintText,
  maxLength,
  selectAll,
  onConfirm,
  close,
}: {
  title: string;
  initialValue: string;
  hintText?: string;
  maxLength?: number;
  selectAll: boolean;
  onConfirm: (value: string) => void;
  close: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const valueRef = useRef(initialValue);
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    field.current?.focus();
    if (selectAll) field.current?.select();
  }, [selectAll]);
  const submit = () => {
    const text = valueRef.current.trim();
    if (!text) return;
    onConfirm(text);
    close();
  };
  return (
    <HyperAlertDialogLayout>
      <HyperAlertDialogHeading title={title} onClose={close} />
      <Input
        ref={field}
        defaultValue={initialValue}
        placeholder={hintText}
        maxLength={maxLength}
        spellCheck={false}
        onChange={(event) => {
          valueRef.current = event.target.value;
          confirmRef.current?.setAttribute('data-empty', String(event.target.value.trim() === ''));
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
      />
      <AlertDialogFooter className={alertFooterClass}>
        <Button type="button" variant="outline" onClick={close}>{tr('button.cancel')}</Button>
        <div ref={confirmRef} className="contents">
          <Button type="button" onClick={submit}>{tr('button.confirm')}</Button>
        </div>
      </AlertDialogFooter>
    </HyperAlertDialogLayout>
  );
}

/** showAFTextFieldDialog (dialog_v2.dart). */
export function showAFTextFieldDialog(options: {
  title: string;
  initialValue: string;
  onConfirm: (value: string) => void;
  hintText?: string;
  maxLength?: number;
  selectAll?: boolean;
}) {
  showDialog(
    (close) => <TextFieldDialog {...options} selectAll={options.selectAll ?? true} close={close} />,
  );
}

export type ConfirmStyle = 'cancelAndOk' | 'onlyOk';

/** ConfirmPopup inside a 440px Dialog (showConfirmDialog & co., dialogs.dart). */
export function showConfirmDialog({
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel,
  style = 'onlyOk',
  confirmButtonColor,
  closeOnAction = true,
  children,
}: {
  title: string;
  description: string;
  onConfirm?: (close: () => void) => void;
  onCancel?: () => void;
  confirmLabel?: string;
  style?: ConfirmStyle;
  confirmButtonColor?: string;
  closeOnAction?: boolean;
  children?: ReactNode;
}) {
  showDialog((close) => (
    <ConfirmPopup
      title={title}
      description={description}
      style={style}
      confirmLabel={confirmLabel ?? (style === 'cancelAndOk' ? tr('space.delete') : tr('button.ok'))}
      confirmButtonColor={confirmButtonColor}
      onCancel={() => {
        onCancel?.();
        close();
      }}
      onConfirm={() => {
        onConfirm?.(close);
        if (closeOnAction) close();
      }}
      onClose={close}
    >
      {children}
    </ConfirmPopup>
  ));
}

export function showConfirmDeletionDialog({ name, description, onConfirm }: { name: string; description: string; onConfirm: () => void }) {
  showConfirmDialog({
    title: `${tr('space.deleteConfirmation')}${name}`,
    description,
    style: 'cancelAndOk',
    onConfirm: () => onConfirm(),
  });
}

function ConfirmPopup({
  title,
  description,
  style,
  confirmLabel,
  confirmButtonColor,
  onConfirm,
  onCancel,
  onClose,
  children,
}: {
  title: string;
  description: string;
  style: ConfirmStyle;
  confirmLabel: string;
  confirmButtonColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <HyperAlertDialogLayout>
      <div
        ref={ref}
        tabIndex={-1}
        className="grid gap-4 outline-none"
        onKeyUp={(event) => { if (event.key === 'Enter') onConfirm(); }}
      >
        <HyperAlertDialogHeading title={title} onClose={onClose} />
        {description && <div className="line-clamp-5 whitespace-pre-wrap text-sm text-muted-foreground">{description}</div>}
        {children && <div>{children}</div>}
        <AlertDialogFooter className={alertFooterClass}>
          {style === 'cancelAndOk' && <Button type="button" variant="outline" onClick={onCancel}>{tr('button.cancel')}</Button>}
          <Button type="button" className={style === 'cancelAndOk' ? destructiveConfirmClass : undefined} onClick={onConfirm} style={{ backgroundColor: style === 'cancelAndOk' ? customColor(confirmButtonColor) : undefined }}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </div>
    </HyperAlertDialogLayout>
  );
}

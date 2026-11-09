import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { FlowySvg } from '@/icons/FlowySvg';
import { tr } from '@/i18n';
import { AFButton } from './Buttons';
import { AFTextField, type AFTextFieldHandle } from './Inputs';

// A small dialog host: showDialog(...) pushes a dialog; each closes itself via the close callback.
interface DialogEntry {
  id: number;
  render: (close: () => void) => ReactNode;
  barrierColor: string;
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
        barrierColor: options.barrierColor ?? '#0000008A',
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
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 900,
              background: dialog.barrierColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'flowy-fade-in 150ms ease-out',
            }}
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

/** Material Dialog: surface bg, inset 40/24, elevation 24. */
export function MaterialDialog({
  children,
  radius = 4,
  background = 'var(--cs-surface)',
  width,
  style,
}: {
  children: ReactNode;
  radius?: number;
  background?: string;
  width?: CSSProperties['width'];
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background,
        borderRadius: radius,
        width,
        maxWidth: 'calc(100vw - 80px)',
        maxHeight: 'calc(100vh - 48px)',
        boxShadow: '0 11px 15px -7px #00000033, 0 24px 38px 3px #00000024, 0 9px 46px 8px #0000001F',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** FlowyDialog: 70% of the window, radius 16, card color. */
export function FlowyDialog({
  children,
  width,
  minWidth,
  maxWidth,
  expandHeight = true,
}: {
  children: ReactNode;
  width?: CSSProperties['width'];
  minWidth?: number;
  maxWidth?: number;
  expandHeight?: boolean;
}) {
  return (
    <MaterialDialog
      radius={16}
      background="var(--th-card)"
      width={width ?? '70vw'}
      style={{ minWidth, maxWidth: maxWidth ?? 'calc(100vw - 80px)', height: expandHeight ? '70vh' : undefined, overflow: 'hidden' }}
    >
      {children}
    </MaterialDialog>
  );
}

/** AFModal: radius 16, surface.primary, shadow medium; header/body/footer paddings. */
export function AFModal({ children, maxWidth = 400 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div style={{ padding: 16, width: '100%', maxWidth: maxWidth + 32 }}>
      <div
        style={{
          background: 'var(--af-surface-primary)',
          borderRadius: 16,
          boxShadow: 'var(--af-shadow-medium)',
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--af-text-primary)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

AFModal.Header = function AFModalHeader({ title, onClose }: { title: ReactNode; onClose?: () => void }) {
  return (
    <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, fontSize: 'calc(16px * var(--text-scale, 1))', lineHeight: '22px', fontWeight: 700 }}>{title}</div>
      {onClose && (
        <AFButton variant="ghostPrimary" padding={4} onTap={onClose}>
          <FlowySvg svg="toast_close_s" size={20} />
        </AFButton>
      )}
    </div>
  );
};
AFModal.Body = ({ children, minHeight }: { children: ReactNode; minHeight?: number }) => (
  <div style={{ padding: '12px 20px', minHeight }}>{children}</div>
);
AFModal.Footer = ({ leading, trailing }: { leading?: ReactNode; trailing?: ReactNode }) => (
  <div style={{ padding: '0 20px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
    {leading}
    <div style={{ flex: 1 }} />
    {trailing}
  </div>
);

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
      <AFModal>
        <AFModal.Header title={title} onClose={close} />
        <AFModal.Body minHeight={108}>
          <div style={{ fontSize: 'calc(14px * var(--text-scale, 1))', lineHeight: '20px' }}>{content}</div>
        </AFModal.Body>
        <AFModal.Footer
          trailing={
            <>
              {secondaryAction && (
                <AFButton
                  variant="outlinedNormal"
                  text={secondaryAction[0]}
                  onTap={() => {
                    secondaryAction[1]?.();
                    close();
                  }}
                />
              )}
              <AFButton
                variant={isDestructive ? 'filledDestructive' : 'filledPrimary'}
                text={primaryAction[0]}
                onTap={() => {
                  primaryAction[1]?.();
                  close();
                }}
              />
            </>
          }
        />
      </AFModal>
    ),
    { barrierColor: 'var(--af-surface-overlay)', barrierDismissible },
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
  const field = useRef<AFTextFieldHandle>(null);
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
    <AFModal>
      <AFModal.Header title={title} onClose={close} />
      <AFModal.Body>
        <AFTextField
          ref={field}
          size="m"
          initialText={initialValue}
          hintText={hintText}
          maxLength={maxLength}
          onChanged={(value) => {
            valueRef.current = value;
            confirmRef.current?.setAttribute('data-empty', String(value.trim() === ''));
          }}
          onSubmitted={submit}
        />
      </AFModal.Body>
      <AFModal.Footer
        trailing={
          <>
            <AFButton variant="outlinedNormal" text={tr('button.cancel')} onTap={close} />
            <div ref={confirmRef} style={{ display: 'contents' }}>
              <AFButton variant="filledPrimary" text={tr('button.confirm')} onTap={submit} />
            </div>
          </>
        }
      />
    </AFModal>
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
    { barrierColor: 'var(--af-surface-overlay)' },
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
      confirmButtonColor={confirmButtonColor ?? (style === 'cancelAndOk' ? 'var(--cs-error)' : 'var(--cs-primary)')}
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
  confirmButtonColor: string;
  onConfirm: () => void;
  onCancel: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <MaterialDialog radius={12} width={440} style={{ overflow: 'hidden' }}>
      <div
        ref={ref}
        tabIndex={-1}
        onKeyUp={(event) => {
          if (event.key === 'Enter') onConfirm();
        }}
        style={{ outline: 'none', borderRadius: 16, background: 'var(--af-surface-primary)', padding: 20, color: 'var(--af-text-primary)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              flex: 1,
              fontSize: 'calc(16px * var(--text-scale, 1))',
              lineHeight: '22px',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
          <AFButton variant="ghostPrimary" size="s" padding={4} onTap={onClose}>
            <FlowySvg svg="password_close_m" size={20} />
          </AFButton>
        </div>
        {description && (
          <div
            style={{
              marginTop: 12,
              fontSize: 'calc(14px * var(--text-scale, 1))',
              lineHeight: '20px',
              display: '-webkit-box',
              WebkitLineClamp: 5,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
            }}
          >
            {description}
          </div>
        )}
        {children && <div style={{ marginTop: 12 }}>{children}</div>}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          {style === 'cancelAndOk' && (
            <AFButton variant="outlinedNormal" text={tr('button.cancel')} onTap={onCancel} style={{ fontWeight: 400 }} />
          )}
          <AFButton
            variant="filledPrimary"
            text={confirmLabel}
            onTap={onConfirm}
            padding="6px 16px"
            style={
              {
                '--btn-bg': style === 'cancelAndOk' ? confirmButtonColor : 'var(--cs-primary)',
                '--btn-bg-hover': `color-mix(in srgb, ${style === 'cancelAndOk' ? confirmButtonColor : 'var(--cs-primary)'} 90%, transparent)`,
                '--btn-fg': 'var(--cs-on-primary)',
                fontWeight: 400,
                minWidth: 0,
              } as CSSProperties
            }
          />
        </div>
      </div>
    </MaterialDialog>
  );
}

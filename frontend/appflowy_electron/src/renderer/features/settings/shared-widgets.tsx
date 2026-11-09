import { useId, useState, type ReactNode } from 'react';
import { ArrowLeft, Eye, EyeOff, Info, RotateCcw, X } from 'lucide-react';
import { tr } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import { SettingsGroup, SettingsRow, SettingsSection } from '@/components/app/settings-layout';
import { Tooltip, showDialog } from '@/ui';
import { cn } from '@/lib/utils';

export function SettingsSubcategory({ title, children }: { title: string; children: ReactNode }) {
  return <SettingsSection title={title}><SettingsGroup>{children}</SettingsGroup></SettingsSection>;
}

export function SettingsResetButton({ onResetRequested, tooltip }: { onResetRequested: () => void; tooltip?: string }) {
  const label = tooltip ?? tr('settings.appearance.resetSetting');
  return <Tooltip message={label}><Button variant="ghost" size="icon-sm" aria-label={label} onClick={onResetRequested}><RotateCcw className="size-4" /></Button></Tooltip>;
}

export function SettingListTile({
  label,
  hint,
  trailing,
  subtitle,
  onResetRequested,
  resetTooltipText,
}: {
  label: string;
  hint?: string;
  trailing?: ReactNode;
  subtitle?: ReactNode;
  onResetRequested?: () => void;
  resetTooltipText?: string;
}) {
  return <SettingsRow label={label} description={hint || subtitle ? <>{hint}{subtitle}</> : undefined} control={<>{trailing}{onResetRequested && <SettingsResetButton onResetRequested={onResetRequested} tooltip={resetTooltipText} />}</>} />;
}

export function PasswordSuffixIcon({ isObscured, onTap }: { isObscured: boolean; onTap: () => void }) {
  return <Button variant="ghost" size="icon-xs" aria-label={isObscured ? 'Show password' : 'Hide password'} onMouseDown={(event) => event.preventDefault()} onClick={onTap}>
    {isObscured ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
  </Button>;
}

export function SettingsInputField({
  label,
  tooltip,
  value,
  placeholder,
  obscureText = false,
  hideActions = false,
  autoFocus,
  onSave,
  onCancel,
  onChanged,
  onBlur,
  onEscape,
  text,
  setText,
}: {
  label?: string;
  tooltip?: string;
  value?: string;
  placeholder?: string;
  obscureText?: boolean;
  hideActions?: boolean;
  autoFocus?: boolean;
  onSave?: (value: string) => void;
  onCancel?: () => void;
  onChanged?: (value: string) => void;
  onBlur?: (value: string) => void;
  onEscape?: () => void;
  /** Controlled text (the TextEditingController); uncontrolled when omitted. */
  text?: string;
  setText?: (value: string) => void;
}) {
  const id = useId();
  const [inner, setInner] = useState(value ?? '');
  const current = text ?? inner;
  const update = (next: string) => (setText ? setText(next) : setInner(next));
  const [obscured, setObscured] = useState(obscureText);
  const showActions = !hideActions && ((value === undefined && current !== '') || (value !== undefined && value !== current));
  return <Field className="gap-2">
    {(label || tooltip) && <div className="flex items-center gap-1">
      {label && <FieldLabel htmlFor={id}>{label}</FieldLabel>}
      {tooltip && <Tooltip message={tooltip}><span className="inline-flex"><Info className="size-4 text-muted-foreground" /></span></Tooltip>}
    </div>}
    <InputGroup data-size="l">
      <InputGroupInput id={id} type={obscured ? 'password' : 'text'} value={current} placeholder={placeholder} autoFocus={autoFocus} spellCheck={false}
        onChange={(event) => { update(event.target.value); onChanged?.(event.target.value); }}
        onBlur={(event) => onBlur?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSave?.(event.currentTarget.value);
          if (event.key === 'Escape' && onEscape) { event.stopPropagation(); onEscape(); }
        }} />
      {obscureText && <InputGroupAddon align="inline-end"><PasswordSuffixIcon isObscured={obscured} onTap={() => setObscured(!obscured)} /></InputGroupAddon>}
    </InputGroup>
    {showActions && <div className="flex justify-end gap-2">
      <Button size="sm" onClick={() => onSave?.(current)}>{tr('button.save')}</Button>
      <Button variant="outline" size="sm" onClick={() => { update(value ?? ''); onCancel?.(); }}>{tr('button.cancel')}</Button>
    </div>}
  </Field>;
}

export type SingleSettingsButtonType = 'primary' | 'danger' | 'highlight';

export function SingleSettingAction({
  label,
  description,
  buttonLabel,
  onPressed,
  buttonType = 'primary',
  minWidth,
}: {
  label: string;
  description?: string;
  labelMaxLines?: number;
  buttonLabel: string;
  onPressed?: () => void;
  buttonType?: SingleSettingsButtonType;
  fontSize?: number;
  fontWeight?: 400 | 500 | 600;
  minWidth?: number;
}) {
  return <SettingsRow label={label} description={description} destructive={buttonType === 'danger'}
    control={<Button variant={buttonType === 'danger' ? 'destructive' : 'outline'} size="sm" data-disabled={onPressed ? undefined : 'true'} disabled={!onPressed} onClick={onPressed} style={{ minWidth }}>{buttonLabel}</Button>} />;
}

export function SettingAction({ onPressed, icon, label, tooltip }: { onPressed: () => void; icon: ReactNode; label?: string; tooltip?: string }) {
  const content = <Button variant="ghost" size={label ? 'sm' : 'icon-sm'} onClick={onPressed} aria-label={tooltip}>{icon}{label}</Button>;
  return tooltip ? <Tooltip message={tooltip}>{content}</Tooltip> : content;
}

export function SettingsDashedDivider({ height, strokeWidth = 1 }: { color?: string; height?: number; strokeWidth?: number; gap?: number }) {
  return <div style={{ paddingBlock: height ? (height - strokeWidth) / 2 : undefined }}><Separator /></div>;
}

export interface SettingsAlertDialogProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  confirm?: () => void;
  confirmLabel?: string;
  hideCancelButton?: boolean;
  isDangerous?: boolean;
  implyLeading?: boolean;
  confirmEnabled?: boolean;
}



export function SettingsAlertDialog({
  title,
  subtitle,
  icon,
  children,
  confirm,
  confirmLabel,
  hideCancelButton,
  isDangerous,
  implyLeading,
  confirmEnabled = true,
  close,
}: SettingsAlertDialogProps & { close: () => void }) {
  const showButtons = !hideCancelButton || !!confirm;
  // Keep the app's dialog host, barrier and callbacks; match AlertDialog's surface and layout.
  return <div className="relative flex max-h-[min(37.5rem,calc(100vh-5rem))] w-[min(26rem,calc(100vw-2rem))] flex-col gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-foreground/10">
    <div className="flex items-center gap-2">
      {implyLeading && <Button variant="ghost" size="sm" onClick={close}><ArrowLeft className="size-4" />{tr('button.back')}</Button>}
      <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" onClick={close}><X className="size-4" /></Button>
    </div>
    {icon}
    <div className="text-base font-medium">{title}</div>
    {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
    {children}
    {showButtons && <div className="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4">
      {!hideCancelButton && <Button variant="outline" onClick={close}>{tr('button.cancel')}</Button>}
      {confirm && <Button disabled={!confirmEnabled} onClick={confirmEnabled ? confirm : undefined} className={cn(isDangerous && 'bg-destructive text-white hover:bg-destructive/90')}>{confirmLabel ?? tr('button.confirm')}</Button>}
    </div>}
  </div>;
}

export function showSettingsAlertDialog(props: Omit<SettingsAlertDialogProps, 'confirm'> & { confirm?: (close: () => void) => void }) {
  return showDialog((close) => <SettingsAlertDialog {...props} confirm={props.confirm ? () => props.confirm!(close) : undefined} close={close} />);
}

export function FlowyErrorMessage({ message, howToFix }: { message: string; howToFix: string }) {
  return <div className="flex flex-col items-center gap-2 p-4 text-center"><div className="text-sm font-medium">{message}</div><div className="text-xs text-muted-foreground">{howToFix}</div></div>;
}

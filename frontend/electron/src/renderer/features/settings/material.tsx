import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, Flag, FolderOpen, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { SettingsRow } from '@/components/app/settings-layout';
import { cn } from '@/lib/utils';

export function MdTextField({
  label,
  value,
  onChange,
  hint,
  helper,
  disabled,
  obscure,
  type = 'text',
  autoFocus,
  onSubmitted,
  style,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  helper?: string;
  disabled?: boolean;
  obscure?: boolean;
  type?: 'text' | 'url';
  autoFocus?: boolean;
  onSubmitted?: () => void;
  style?: CSSProperties;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const float = focused || value !== '';
  return <Field data-float={float ? 'true' : undefined} data-disabled={disabled ? 'true' : undefined} style={style}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} type={obscure ? 'password' : type} value={value} placeholder={hint} disabled={disabled} autoFocus={autoFocus} spellCheck={false} autoComplete="off"
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSubmitted?.(); }} />
    {helper && <FieldDescription className="text-xs">{helper}</FieldDescription>}
  </Field>;
}

export function MdSwitch({ value, onChanged, disabled }: { value: boolean; onChanged?: (value: boolean) => void; disabled?: boolean }) {
  return <Switch checked={value} aria-checked={value} data-on={value ? 'true' : undefined} data-disabled={disabled ? 'true' : undefined} disabled={disabled} onCheckedChange={(next) => onChanged?.(next)} />;
}

export function MdCheckbox({ value }: { value: boolean }) {
  return <Checkbox checked={value} readOnly data-on={value ? 'true' : undefined} />;
}

export function SwitchListTile({ title, value, onChanged, disabled }: { title: string; value: boolean; onChanged: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return <label htmlFor={id} className="block cursor-pointer"><SettingsRow label={title}
    control={<Switch id={id} checked={value} disabled={disabled} aria-label={title} onCheckedChange={onChanged} data-on={value ? 'true' : undefined} data-disabled={disabled ? 'true' : undefined} />} /></label>;
}

export function CheckboxListTile({ title, value, onChanged, disabled }: { title: string; value: boolean; onChanged: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return <label htmlFor={id} className="block cursor-pointer"><SettingsRow label={title}
    control={<Checkbox id={id} checked={value} disabled={disabled} aria-label={title} onCheckedChange={onChanged} data-on={value ? 'true' : undefined} />} /></label>;
}

export function MdButton({
  variant,
  children,
  icon,
  onPressed,
  disabled,
  style,
}: {
  variant: 'filled' | 'outlined' | 'text';
  children: ReactNode;
  icon?: ReactNode;
  onPressed?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return <Button variant={variant === 'filled' ? 'default' : variant === 'outlined' ? 'outline' : 'ghost'} size="sm" data-variant={variant} disabled={disabled || !onPressed} onClick={onPressed} style={style}>{icon}{children}</Button>;
}

export const LinearProgress = () => <Progress value={null} className="[&_[data-slot=progress-indicator]]:w-1/3 [&_[data-slot=progress-indicator]]:animate-pulse" />;

export function MdText({ children, size = 14, weight, color, selectable, style }: {
  children: ReactNode; size?: number; weight?: number; color?: string; selectable?: boolean; style?: CSSProperties;
}) {
  return <div className={cn('break-words text-sm leading-relaxed text-foreground', selectable && 'select-text', size <= 12 ? 'text-xs' : size >= 20 ? 'text-xl' : size >= 16 ? 'text-base' : 'text-sm', weight === 600 ? 'font-semibold' : weight === 500 ? 'font-medium' : 'font-normal', color?.includes('error') && 'text-destructive', (color?.includes('hint') || color?.includes('secondary')) && 'text-muted-foreground')} style={style}>{children}</div>;
}

/** Compatibility exports for settings pages still using the original icon helpers. */
export const MaterialIcon = {
  verifiedUserOutlined: (size = 20, color = 'currentColor') => <ShieldCheck size={size} className="text-muted-foreground" color={color.startsWith('var(') ? undefined : color} />,
  flag: (size = 20, color = 'currentColor') => <Flag size={size} className="text-muted-foreground" color={color.startsWith('var(') ? undefined : color} />,
  folderOpen: (size = 18, color = 'currentColor') => <FolderOpen size={size} color={color.startsWith('var(') ? undefined : color} />,
  arrowDropDown: (size = 24, color = 'currentColor') => <ChevronDown size={size} className="text-muted-foreground" color={color.startsWith('var(') ? undefined : color} />,
};

import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import './settings.css';

// Material (useMaterial3: false) controls the custom settings pages build from (Flutter
// TextField, SwitchListTile, CheckboxListTile, FilledButton, OutlinedButton, TextButton,
// LinearProgressIndicator, Slider). Kept local to the settings feature.

const text = (size: number, extra?: CSSProperties): CSSProperties => ({
  fontSize: `calc(${size}px * var(--text-scale, 1))`,
  color: 'var(--text-color)',
  ...extra,
});

/** Material TextField with InputDecoration(labelText, hintText, helperText). */
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
  return (
    <div className="md-textfield" data-float={float ? 'true' : undefined} data-disabled={disabled ? 'true' : undefined} style={style}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={obscure ? 'password' : type}
        value={value}
        placeholder={hint}
        disabled={disabled}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmitted?.();
        }}
      />
      {helper && <div className="md-helper">{helper}</div>}
    </div>
  );
}

export function MdSwitch({ value, onChanged, disabled }: { value: boolean; onChanged?: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div
      className="md-switch"
      role="switch"
      aria-checked={value}
      data-on={value ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      onClick={() => !disabled && onChanged?.(!value)}
    >
      <div className="track" />
      <div className="thumb" />
    </div>
  );
}

export function MdCheckbox({ value }: { value: boolean }) {
  return (
    <div className="md-checkbox" data-on={value ? 'true' : undefined}>
      {value && (
        <svg width="14" height="14" viewBox="0 0 24 24">
          <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" fill="var(--cs-on-primary)" />
        </svg>
      )}
    </div>
  );
}

/** ListTile row shared by SwitchListTile / CheckboxListTile (contentPadding: zero, min height 48/56). */
function ListTileRow({ title, trailing, onTap, disabled }: { title: string; trailing: ReactNode; onTap: () => void; disabled?: boolean }) {
  return (
    <div
      onClick={() => !disabled && onTap()}
      style={{ display: 'flex', alignItems: 'center', minHeight: 48, cursor: disabled ? 'default' : 'pointer', gap: 16 }}
    >
      <div style={text(16, { flex: 1, color: disabled ? 'var(--th-disabled)' : 'var(--text-color)' })}>{title}</div>
      {trailing}
    </div>
  );
}

export function SwitchListTile({ title, value, onChanged, disabled }: { title: string; value: boolean; onChanged: (v: boolean) => void; disabled?: boolean }) {
  return <ListTileRow title={title} disabled={disabled} onTap={() => onChanged(!value)} trailing={<MdSwitch value={value} disabled={disabled} />} />;
}

export function CheckboxListTile({ title, value, onChanged, disabled }: { title: string; value: boolean; onChanged: (v: boolean) => void; disabled?: boolean }) {
  return <ListTileRow title={title} disabled={disabled} onTap={() => onChanged(!value)} trailing={<MdCheckbox value={value} />} />;
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
  return (
    <button
      type="button"
      className="md-button"
      data-variant={variant}
      disabled={disabled || !onPressed}
      onClick={onPressed}
      style={{ ...(icon ? { paddingLeft: variant === 'filled' ? 16 : 12 } : null), ...style }}
    >
      {icon && <span style={{ display: 'flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>{icon}</span>}
      {children}
    </button>
  );
}

export const LinearProgress = () => <div className="md-linear-progress" role="progressbar" />;

/** Material Text: bodyMedium 14 by default. */
export function MdText({
  children,
  size = 14,
  weight,
  color,
  selectable,
  style,
}: {
  children: ReactNode;
  size?: number;
  weight?: number;
  color?: string;
  selectable?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className={selectable ? 'settings-selectable' : undefined} style={text(size, { fontWeight: weight, color: color ?? 'var(--text-color)', lineHeight: 1.43, overflowWrap: 'anywhere', ...style })}>
      {children}
    </div>
  );
}

/** Material Icons used by the custom pages (outlined variants, 24 viewBox). */
export const MaterialIcon = {
  verifiedUserOutlined: (size = 20, color = 'var(--icon-color)') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm7 10c0 4.52-2.98 8.69-7 9.93-4.02-1.24-7-5.41-7-9.93V6.3l7-3.11 7 3.11V11zm-11.59.59L6 13l4 4 8-8-1.41-1.42L10 14.17z" />
    </svg>
  ),
  flag: (size = 20, color = 'var(--icon-color)') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z" />
    </svg>
  ),
  folderOpen: (size = 18, color = 'currentColor') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" />
    </svg>
  ),
  arrowDropDown: (size = 24, color = 'var(--icon-color)') => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M7 10l5 5 5-5z" />
    </svg>
  ),
};

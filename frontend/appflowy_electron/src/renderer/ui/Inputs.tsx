import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

export interface AFTextFieldHandle {
  syncError(errorText: string): void;
  clearError(): void;
  syncObscured(obscured: boolean): void;
  focus(): void;
  select(): void;
  value(): string;
}

export interface AFTextFieldProps {
  size?: 'm' | 'l';
  hintText?: string;
  initialText?: string;
  value?: string;
  autoFocus?: boolean;
  obscureText?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  type?: 'text' | 'email' | 'number';
  autoComplete?: string;
  onChanged?: (value: string) => void;
  onSubmitted?: (value: string) => void;
  onEscape?: () => void;
  /** validator(controller) → [hasError, errorText], run on every change. */
  validator?: (value: string) => [boolean, string];
  suffixIcon?: (obscured: boolean) => ReactNode;
  style?: CSSProperties;
}

/** AFTextField (appflowy_ui textfield.dart): size l by default, error text below. */
export const AFTextField = forwardRef<AFTextFieldHandle, AFTextFieldProps>(function AFTextField(
  {
    size = 'l',
    hintText,
    initialText,
    value,
    autoFocus,
    obscureText = false,
    readOnly,
    maxLength,
    type = 'text',
    autoComplete,
    onChanged,
    onSubmitted,
    onEscape,
    validator,
    suffixIcon,
    style,
  },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [obscured, setObscured] = useState(obscureText);

  useImperativeHandle(ref, () => ({
    syncError: (text) => setError(text),
    clearError: () => setError(null),
    syncObscured: (next) => setObscured(next),
    focus: () => inputRef.current?.focus(),
    select: () => inputRef.current?.select(),
    value: () => inputRef.current?.value ?? '',
  }));

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...style }}>
      <div className="af-textfield" data-size={size} data-error={error !== null ? 'true' : undefined} data-readonly={readOnly ? 'true' : undefined}>
        <input
          ref={inputRef}
          type={obscured ? 'password' : type === 'number' ? 'text' : type}
          inputMode={type === 'number' ? 'numeric' : undefined}
          placeholder={hintText}
          defaultValue={value === undefined ? initialText : undefined}
          value={value}
          readOnly={readOnly}
          maxLength={maxLength}
          autoComplete={autoComplete}
          spellCheck={false}
          onChange={(event) => {
            onChanged?.(event.target.value);
            if (validator) {
              const [hasError, text] = validator(event.target.value);
              setError(hasError ? text : null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmitted?.(event.currentTarget.value);
            if (event.key === 'Escape') onEscape?.();
          }}
        />
        {suffixIcon && <div style={{ display: 'flex', paddingRight: 8 }}>{suffixIcon(obscured)}</div>}
      </div>
      {error && (
        <div
          style={{
            marginTop: 4,
            fontSize: 'calc(12px * var(--text-scale, 1))',
            lineHeight: '18px',
            color: 'var(--af-text-error)',
            textAlign: 'start',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
});

/** Toggle (workspace/presentation/widgets/toggle/toggle.dart): big 16×27 track, 14px thumb. */
export function Toggle({
  value,
  onChanged,
  small,
  activeBackgroundColor = 'var(--cs-primary)',
  inactiveBackgroundColor = 'var(--afx-toggle-button-bg)',
}: {
  value: boolean;
  onChanged: (value: boolean) => void;
  small?: boolean;
  activeBackgroundColor?: string;
  inactiveBackgroundColor?: string;
}) {
  const [h, w, d] = small ? [10, 16, 8] : [16, 27, 14];
  return (
    <div style={{ padding: 8, display: 'inline-flex' }} onClick={() => onChanged(!value)}>
      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          borderRadius: h / 2,
          background: value ? activeBackgroundColor : inactiveBackgroundColor,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: (h - d) / 2,
            left: value ? w - d - 1 : 1,
            width: d,
            height: d,
            borderRadius: '50%',
            background: '#FFFFFF',
            transition: 'left 150ms linear',
          }}
        />
      </div>
    </div>
  );
}

const AVATAR_COLORS: Array<[string, string]> = [
  ['#FAE3E3', '#702828'],
  ['#FAE8DE', '#6B3215'],
  ['#FCEDD9', '#613B0A'],
  ['#FCF1D7', '#5C4102'],
  ['#FCF5CF', '#574800'],
  ['#F6F7D0', '#4A4C03'],
  ['#EEF5CE', '#414D05'],
  ['#E9F5D7', '#334D0C'],
  ['#E2F5DF', '#1E4F16'],
  ['#DFF5EB', '#075231'],
  ['#DFF3F5', '#004E57'],
  ['#E1EEF7', '#154469'],
  ['#E3EBFA', '#223C70'],
  ['#E6E6FA', '#36366B'],
  ['#EBE3FA', '#462F75'],
  ['#F0E1F7', '#562D6B'],
  ['#F5E1F4', '#632861'],
  ['#F7E1EB', '#6E2343'],
  ['#E8E8E8', '#404040'],
  ['#E6E9F0', '#394152'],
];

/** AFAvatar color index: Dart's 64-bit `c + ((hash << 5) - hash)` string hash, then |hash| % 20 + 1. */
export function avatarColorIndex(seed: string | undefined): number {
  if (!seed) return 1;
  let hash = 0n;
  for (let i = 0; i < seed.length; i++) {
    hash = BigInt.asIntN(64, BigInt(seed.charCodeAt(i)) + BigInt.asIntN(64, (hash << 5n) - hash));
  }
  const abs = hash < 0n ? -hash : hash;
  return Number(abs % 20n) + 1;
}

const AVATAR_SIZES = { xs: [16, 12], s: [24, 14], m: [32, 16], l: [48, 20], xl: [64, 24] } as const;

/** AFAvatar (appflowy_ui avatar.dart). */
export function AFAvatar({
  name,
  url,
  size = 'm',
  colorHash,
}: {
  name?: string;
  url?: string;
  size?: keyof typeof AVATAR_SIZES;
  colorHash?: string;
}) {
  const [px, fontSize] = AVATAR_SIZES[size];
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url}
        width={px}
        height={px}
        alt=""
        onError={() => setFailed(true)}
        style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  const [bg, fg] = AVATAR_COLORS[avatarColorIndex(colorHash ?? name) - 1];
  const initial = name?.trim().charAt(0).toUpperCase() ?? '';
  return (
    <div
      style={{
        width: px,
        height: px,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

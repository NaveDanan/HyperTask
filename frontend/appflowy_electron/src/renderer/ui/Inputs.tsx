import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

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
    <div className="flex flex-col" style={style}>
      <div className="relative flex items-center" data-size={size} data-error={error !== null ? 'true' : undefined} data-readonly={readOnly ? 'true' : undefined}>
        <Input
          className={cn(size === 'l' ? 'h-9' : 'h-8', suffixIcon && 'pr-10')}
          aria-invalid={error !== null ? true : undefined}
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
        {suffixIcon && <div className="absolute right-2 flex">{suffixIcon(obscured)}</div>}
      </div>
      {error && <div className="mt-1 text-start text-xs text-destructive">{error}</div>}
    </div>
  );
});

/** Toggle compatibility wrapper. */
export function Toggle({
  value, onChanged, small, activeBackgroundColor, inactiveBackgroundColor,
}: {
  value: boolean;
  onChanged: (value: boolean) => void;
  small?: boolean;
  activeBackgroundColor?: string;
  inactiveBackgroundColor?: string;
}) {
  const color = value ? activeBackgroundColor : inactiveBackgroundColor;
  return (
    <span className="inline-flex p-2">
      <Switch checked={value} onCheckedChange={onChanged} size={small ? 'sm' : 'default'} style={{ backgroundColor: color?.includes('var(') ? undefined : color }} />
    </span>
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

const AVATAR_SIZES = { xs: 16, s: 24, m: 32, l: 48, xl: 64 } as const;

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
  const px = AVATAR_SIZES[size];
  const [failed, setFailed] = useState(false);
  const [bg, fg] = AVATAR_COLORS[avatarColorIndex(colorHash ?? name) - 1];
  const initial = name?.trim().charAt(0).toUpperCase() ?? '';
  return (
    <Avatar style={{ width: px, height: px }}>
      {url && !failed && <AvatarImage src={url} alt="" onError={() => setFailed(true)} />}
      <AvatarFallback className="text-xs font-medium" style={{ backgroundColor: bg, color: fg }}>{initial}</AvatarFallback>
    </Avatar>
  );
}

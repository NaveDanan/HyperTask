import { forwardRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface FlowyTextFieldProps {
  defaultValue?: string;
  value?: string;
  hintText?: string;
  maxLength?: number;
  readOnly?: boolean;
  autoFocus?: boolean;
  borderRadius?: number;
  enableBorderColor?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  height?: number;
  fontSize?: number;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onFocusChange?: (focused: boolean) => void;
  style?: CSSProperties;
}

/** FlowyTextField (flowy_infra_ui/lib/style_widget/text_field.dart): 32px, outline border, primary on focus. */
export const FlowyTextField = forwardRef<HTMLInputElement, FlowyTextFieldProps>(function FlowyTextField(
  {
    defaultValue,
    value,
    hintText,
    maxLength,
    readOnly,
    autoFocus,
    borderRadius = 8,
    enableBorderColor = 'var(--cs-outline)',
    prefix,
    suffix,
    height = 32,
    fontSize = 14,
    onChange,
    onSubmit,
    onFocusChange,
    style,
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height,
        borderRadius,
        border: `1px solid ${focused && !readOnly ? 'var(--cs-primary)' : enableBorderColor}`,
        boxSizing: 'border-box',
        minWidth: 0,
        ...style,
      }}
    >
      {prefix}
      <input
        ref={ref}
        defaultValue={value === undefined ? defaultValue : undefined}
        value={value}
        placeholder={hintText}
        maxLength={maxLength}
        readOnly={readOnly}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit?.(event.currentTarget.value);
        }}
        onFocus={() => {
          setFocused(true);
          onFocusChange?.(true);
        }}
        onBlur={() => {
          setFocused(false);
          onFocusChange?.(false);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          padding: prefix ? '0 12px 0 0' : '0 12px',
          color: 'var(--text-color)',
          fontSize: `calc(${fontSize}px * var(--text-scale, 1))`,
          fontFamily: 'inherit',
        }}
      />
      {suffix}
    </div>
  );
});

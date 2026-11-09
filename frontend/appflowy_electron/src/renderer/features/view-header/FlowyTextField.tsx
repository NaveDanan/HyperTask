import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

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
    prefix,
    suffix,
    onChange,
    onSubmit,
    onFocusChange,
    style,
  },
  ref,
) {
  return (
    <InputGroup style={style}>
      {prefix && <InputGroupAddon>{prefix}</InputGroupAddon>}
      <InputGroupInput ref={ref} defaultValue={value === undefined ? defaultValue : undefined} value={value}
        placeholder={hintText} maxLength={maxLength} readOnly={readOnly} autoFocus={autoFocus} spellCheck={false}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit?.(event.currentTarget.value);
        }}
        onFocus={() => onFocusChange?.(true)} onBlur={() => onFocusChange?.(false)} />
      {suffix && <InputGroupAddon align="inline-end">{suffix}</InputGroupAddon>}
    </InputGroup>
  );
});

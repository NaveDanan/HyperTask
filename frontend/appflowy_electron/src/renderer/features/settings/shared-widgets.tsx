import { useState, type CSSProperties, type ReactNode } from 'react';
import { FlowySvg } from '@/icons/FlowySvg';
import { tr } from '@/i18n';
import { FlowyHover, FlowyIconButton, FlowyText, HSpace, Tooltip, VSpace, showDialog } from '@/ui';

// More shared settings widgets (lib/workspace/presentation/settings/shared/). The basic
// layout widgets (SettingsBody, SettingsCategory, SettingsDropdown...) are in shared.tsx.

/** SettingsSubcategory: medium 14 secondary title, VSpace 8, children separated by 16. */
export function SettingsSubcategory({ title, children }: { title: string; children: ReactNode }) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <FlowyText fontWeight={500} maxLines={2} color="var(--afx-secondary-text)">
        {title}
      </FlowyText>
      <VSpace size={8} />
      {items.map((child, index) => (
        <div key={index} style={{ marginTop: index > 0 ? 16 : 0 }}>
          {child}
        </div>
      ))}
    </div>
  );
}

/** SettingsResetButton: 24px FlowyIconButton with restore_s at 20, secondaryContainer hover. */
export function SettingsResetButton({ onResetRequested, tooltip }: { onResetRequested: () => void; tooltip?: string }) {
  return (
    <FlowyIconButton
      width={24}
      hoverColor="var(--cs-secondary-container)"
      iconColorOnHover="var(--cs-on-primary)"
      tooltip={tooltip ?? tr('settings.appearance.resetSetting')}
      onPressed={onResetRequested}
      icon={<FlowySvg svg="restore_s" size={20} />}
    />
  );
}

/** SettingListTile: label (medium 14) + optional hint (10, hintColor) + trailing + reset. */
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
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <FlowyText fontWeight={500} ellipsis>
          {label}
        </FlowyText>
        {hint && (
          <div style={{ paddingBottom: 4 }}>
            <FlowyText fontSize={10} color="var(--th-hint)" maxLines={null}>
              {hint}
            </FlowyText>
          </div>
        )}
        {subtitle}
      </div>
      {trailing}
      {onResetRequested && <SettingsResetButton onResetRequested={onResetRequested} tooltip={resetTooltipText} />}
    </div>
  );
}

/** PasswordSuffixIcon: show_s / hide_s at 20. */
export function PasswordSuffixIcon({ isObscured, onTap }: { isObscured: boolean; onTap: () => void }) {
  return (
    <span style={{ display: 'flex', cursor: 'pointer' }} onMouseDown={(event) => event.preventDefault()} onClick={onTap}>
      <FlowySvg svg={isObscured ? 'show_s' : 'hide_s'} size={20} color="var(--af-icon-secondary)" />
    </span>
  );
}

/** SettingsInputField: optional label, AFTextField (size l), Save/Cancel once the text differs. */
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
  const [inner, setInner] = useState(value ?? '');
  const current = text ?? inner;
  const update = (next: string) => (setText ? setText(next) : setInner(next));
  const [obscured, setObscured] = useState(obscureText);
  const showActions = !hideActions && ((value === undefined && current !== '') || (value !== undefined && value !== current));
  const actionStyle: CSSProperties = { height: 21, cursor: 'pointer', display: 'flex', alignItems: 'center' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {(label || tooltip) && (
        <>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {label && (
              <FlowyText fontWeight={500} color="var(--afx-secondary-text)">
                {label}
              </FlowyText>
            )}
            {tooltip && (
              <Tooltip message={tooltip}>
                <span style={{ marginLeft: 4, display: 'flex' }}>
                  <FlowySvg svg="information_s" />
                </span>
              </Tooltip>
            )}
          </div>
          <VSpace size={8} />
        </>
      )}
      <div className="af-textfield" data-size="l">
        <input
          type={obscured ? 'password' : 'text'}
          value={current}
          placeholder={placeholder}
          autoFocus={autoFocus}
          spellCheck={false}
          onChange={(event) => {
            update(event.target.value);
            onChanged?.(event.target.value);
          }}
          onBlur={(event) => onBlur?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSave?.(event.currentTarget.value);
            if (event.key === 'Escape' && onEscape) {
              event.stopPropagation();
              onEscape();
            }
          }}
        />
        {obscureText && (
          <div style={{ display: 'flex', paddingRight: 8 }}>
            <PasswordSuffixIcon isObscured={obscured} onTap={() => setObscured(!obscured)} />
          </div>
        )}
      </div>
      {showActions && (
        <>
          <VSpace size={8} />
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1 }} />
            <div style={actionStyle} onClick={() => onSave?.(current)}>
              <FlowyText color="var(--afx-text)">{tr('button.save')}</FlowyText>
            </div>
            <HSpace size={24} />
            <div
              style={actionStyle}
              onClick={() => {
                update(value ?? '');
                onCancel?.();
              }}
            >
              <FlowyText color="var(--afx-text)">{tr('button.cancel')}</FlowyText>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export type SingleSettingsButtonType = 'primary' | 'danger' | 'highlight';

/** SingleSettingAction: label (+ description) and a 32px FlowyTextButton on the right. */
export function SingleSettingAction({
  label,
  description,
  labelMaxLines,
  buttonLabel,
  onPressed,
  buttonType = 'primary',
  fontSize = 14,
  fontWeight = 400,
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
  const colors = {
    primary: { fill: 'var(--cs-primary)', hover: 'color-mix(in srgb, var(--cs-primary) 90%, transparent)', font: 'var(--cs-on-primary)', border: 'transparent' },
    danger: { fill: 'transparent', hover: 'color-mix(in srgb, var(--cs-error) 10%, transparent)', font: 'var(--cs-error)', border: 'var(--cs-error)' },
    highlight: { fill: 'transparent', hover: '#5C3699', font: '#5C3699', border: '#5C3699' },
  }[buttonType];
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <FlowyText fontSize={fontSize} fontWeight={fontWeight} color="var(--afx-secondary-text)" maxLines={labelMaxLines ?? 1} ellipsis>
          {label}
        </FlowyText>
        {description && (
          <>
            <VSpace size={4} />
            <FlowyText fontSize={11} maxLines={2}>
              {description}
            </FlowyText>
          </>
        )}
      </div>
      <HSpace size={24} />
      <div style={{ minWidth, height: 32, display: 'flex' }}>
        <button
          className="af-button"
          data-disabled={onPressed ? undefined : 'true'}
          onClick={onPressed}
          style={
            {
              '--btn-bg': colors.fill,
              '--btn-bg-hover': colors.hover,
              '--btn-border': colors.border,
              '--btn-fg': colors.font,
              '--btn-fg-hover': buttonType === 'danger' ? colors.font : '#FFFFFF',
              '--btn-radius': '8px',
              padding: '7px 16px',
              fontSize: 'calc(12px * var(--text-scale, 1))',
              lineHeight: 1,
              fontWeight: 500,
              width: '100%',
            } as CSSProperties
          }
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

/** SettingAction: 26px high hover row with an icon and an optional label. */
export function SettingAction({ onPressed, icon, label, tooltip }: { onPressed: () => void; icon: ReactNode; label?: string; tooltip?: string }) {
  const content = (
    <div style={{ height: 26, display: 'flex' }} onClick={onPressed}>
      <FlowyHover style={{ padding: '2px 4px', display: 'flex', alignItems: 'center' }}>
        {icon}
        {label && (
          <>
            <HSpace size={4} />
            <FlowyText>{label}</FlowyText>
          </>
        )}
      </FlowyHover>
    </div>
  );
  return tooltip ? <Tooltip message={tooltip}>{content}</Tooltip> : content;
}

/** SettingsDashedDivider: dashes 3 / gaps 3, 1px. */
export function SettingsDashedDivider({ color = 'var(--th-divider)', height, strokeWidth = 1, gap = 3 }: { color?: string; height?: number; strokeWidth?: number; gap?: number }) {
  return (
    <div style={{ padding: height ? `${(height - strokeWidth) / 2}px 0` : undefined }}>
      <div
        style={{
          height: strokeWidth,
          backgroundImage: `linear-gradient(to right, ${color} 0 ${gap}px, transparent ${gap}px ${gap * 2}px)`,
          backgroundSize: `${gap * 2}px ${strokeWidth}px`,
          borderRadius: 1,
        }}
      />
    </div>
  );
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

/** SettingsAlertDialog (StyledDialog maxWidth 600, maxHeight 600, padding 24). */
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
  const button = (bg: string, hover: string, weight: number): CSSProperties =>
    ({
      '--btn-bg': bg,
      '--btn-bg-hover': hover,
      '--btn-fg': 'var(--cs-on-primary)',
      '--btn-radius': '12px',
      height: 48,
      padding: '12px 24px',
      fontWeight: weight,
    }) as CSSProperties;
  return (
    <div
      style={{
        background: 'var(--th-card)',
        borderRadius: 6,
        padding: 24,
        width: 600,
        maxWidth: 'calc(100vw - 80px)',
        maxHeight: 600,
        overflowY: 'auto',
        boxShadow: '0 11px 15px -7px #00000033, 0 24px 38px 3px #00000024, 0 9px 46px 8px #0000001F',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {implyLeading && (
          <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={close}>
            <FlowySvg svg="arrow_back_m" size={24} />
            <HSpace size={8} />
            <FlowyText fontSize={16} fontWeight={600}>
              {tr('button.back')}
            </FlowyText>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ display: 'flex', cursor: 'pointer' }} onClick={close}>
          <FlowySvg svg="m_close_m" size={20} color="var(--cs-outline)" />
        </span>
      </div>
      {icon && (
        <>
          {icon}
          <VSpace size={16} />
        </>
      )}
      <FlowyText fontSize={22} fontWeight={500} color="var(--cs-tertiary)" maxLines={null} textAlign="center">
        {title}
      </FlowyText>
      {subtitle && (
        <>
          <VSpace size={16} />
          <FlowyText fontSize={16} maxLines={null} textAlign="center">
            {subtitle}
          </FlowyText>
        </>
      )}
      {children && (
        <>
          <VSpace size={16} />
          {children}
        </>
      )}
      {showButtons && <VSpace size={20} />}
      {showButtons && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          {!hideCancelButton && (
            <button className="af-button" onClick={close} style={button('var(--cs-primary)', '#005483', 600)}>
              {tr('button.cancel')}
            </button>
          )}
          {confirm && (
            <button
              className="af-button"
              onClick={confirmEnabled ? confirm : undefined}
              style={button(
                !confirmEnabled ? 'var(--th-divider)' : isDangerous ? 'var(--cs-error)' : 'var(--cs-primary)',
                !confirmEnabled ? 'var(--th-divider)' : isDangerous ? 'var(--cs-error)' : '#005483',
                500,
              )}
            >
              {confirmLabel ?? tr('button.confirm')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** `SettingsAlertDialog(...).show(context)`; `confirm` receives the close callback. */
export function showSettingsAlertDialog(props: Omit<SettingsAlertDialogProps, 'confirm'> & { confirm?: (close: () => void) => void }) {
  return showDialog((close) => <SettingsAlertDialog {...props} confirm={props.confirm ? () => props.confirm!(close) : undefined} close={close} />);
}

/** FlowyErrorPage.message: centered message + how-to-fix text. */
export function FlowyErrorMessage({ message, howToFix }: { message: string; howToFix: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16, gap: 8 }}>
      <FlowyText fontWeight={500} maxLines={null} textAlign="center">
        {message}
      </FlowyText>
      <FlowyText fontSize={12} color="var(--th-hint)" maxLines={null} textAlign="center">
        {howToFix}
      </FlowyText>
    </div>
  );
}

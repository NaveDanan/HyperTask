import { isValidElement, useRef, type CSSProperties, type ReactNode } from 'react';
import { FlowySvg } from '@/icons/FlowySvg';
import { AppFlowyPopover, FlowyText, Tooltip, VSpace, type PopoverController } from '@/ui';

// Shared settings layout (lib/workspace/presentation/settings/shared/).

const heading = (size: number, lineHeight: number, weight = 600): CSSProperties => ({
  fontSize: `calc(${size}px * var(--text-scale, 1))`,
  lineHeight: `${lineHeight}px`,
  fontWeight: weight,
  color: 'var(--af-text-primary)',
});

/** A child's own React key when it has one, so conditional siblings do not remount it. */
const childKey = (child: ReactNode, index: number) =>
  isValidElement(child) && child.key !== null ? `k:${child.key}` : `i:${index}`;

/** SettingsCategorySpacer: 12 + 16 (hairline centered) + 12. */
export const SettingsCategorySpacer = () => (
  <div style={{ padding: '12px 0', flexShrink: 0 }}>
    <div style={{ height: 16, display: 'flex', alignItems: 'center' }}>
      <div style={{ height: 1, flex: 1, background: 'var(--af-border-primary)', transform: 'scaleY(0.5)' }} />
    </div>
  </div>
);

export function SettingsHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div>
      <div style={heading(24, 32)}>{title}</div>
      {description && (
        <>
          <VSpace size={4} />
          {typeof description === 'string' ? (
            <div style={{ ...heading(12, 18, 400), color: 'var(--af-text-secondary)' }}>{description}</div>
          ) : (
            description
          )}
        </>
      )}
    </div>
  );
}

/** SettingsBody: scrollable, padding 24, header then children separated by spacers. */
export function SettingsBody({
  title,
  description,
  autoSeparate = true,
  children,
}: {
  title: string;
  description?: ReactNode;
  autoSeparate?: boolean;
  children: ReactNode;
}) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24 }}>
      <SettingsHeader title={title} description={description} />
      <SettingsCategorySpacer />
      {items.map((child, index) => (
        <div key={childKey(child, index)}>
          {index > 0 && autoSeparate && <SettingsCategorySpacer />}
          {child}
        </div>
      ))}
    </div>
  );
}

export function SettingsCategory({
  title,
  description,
  tooltip,
  actions,
  children,
}: {
  title: string;
  description?: string;
  tooltip?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ ...heading(16, 22), overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        {tooltip && (
          <Tooltip message={tooltip}>
            <span style={{ marginLeft: 4, display: 'flex' }}>
              <FlowySvg svg="information_s" />
            </span>
          </Tooltip>
        )}
        <div style={{ flex: 1 }} />
        {actions}
      </div>
      <VSpace size={16} />
      {description && (
        <>
          <FlowyText fontSize={12} maxLines={4} ellipsis>
            {description}
          </FlowyText>
          <VSpace size={8} />
        </>
      )}
      {items.map((child, index) => (
        <div key={childKey(child, index)} style={{ marginTop: index > 0 ? 16 : 0 }}>
          {child}
        </div>
      ))}
    </div>
  );
}

export interface DropdownOption<T> {
  value: T;
  label: string;
  /** Renders the label in this font (font pickers). */
  fontFamily?: string;
  /** buildDropdownMenuEntry leadingWidget / trailingWidget. */
  leading?: ReactNode;
  trailing?: ReactNode;
}

/** SettingsDropdown: Material DropdownMenu, outline radius 8, menu max height 250. */
export function SettingsDropdown<T>({
  selected,
  options,
  onChanged,
  actions,
  expandWidth = true,
  showCheck = true,
}: {
  selected: T;
  options: DropdownOption<T>[];
  onChanged: (value: T) => void;
  actions?: ReactNode;
  expandWidth?: boolean;
  /** False when the entries are built without selectedValue (no check mark). */
  showCheck?: boolean;
}) {
  const controller = useRef<PopoverController>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === selected);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ flex: expandWidth ? 1 : undefined, minWidth: 0 }} ref={triggerRef}>
        <AppFlowyPopover
          controllerRef={controller}
          direction="bottomWithLeftAligned"
          offset={{ x: 0, y: 4 }}
          margin="8px 6px"
          constraints={{ maxHeight: 250, width: triggerRef.current?.offsetWidth }}
          popup={(close) => (
            <div style={{ overflowY: 'auto' }}>
              {options.map((option, index) => (
                <div
                  key={index}
                  className="flowy-hover"
                  onClick={() => {
                    onChanged(option.value);
                    close();
                  }}
                  style={{ minHeight: 29, padding: '4px 6px', display: 'flex', alignItems: 'center' }}
                >
                  {option.leading && <span style={{ display: 'flex', marginRight: 8 }}>{option.leading}</span>}
                  <FlowyText fontFamily={option.fontFamily} style={{ flex: 1 }}>
                    {option.label}
                  </FlowyText>
                  {option.trailing && (
                    <span style={{ display: 'flex', marginLeft: 8 }} onClick={(event) => event.stopPropagation()}>
                      {option.trailing}
                    </span>
                  )}
                  {showCheck && option.value === selected && (
                    <span style={{ marginLeft: 8, display: 'flex' }}>
                      <FlowySvg svg="check_s" />
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        >
          <div
            style={{
              border: '1px solid var(--cs-outline)',
              borderRadius: 8,
              padding: '12px 18px',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              fontSize: 'calc(16px * var(--text-scale, 1))',
              color: 'var(--text-color)',
            }}
          >
            <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: current?.fontFamily }}>
              {current?.label ?? String(selected)}
            </div>
            <span style={{ marginLeft: 8, display: 'flex' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--icon-color)">
                <path d="M7 10l5 5 5-5z" />
              </svg>
            </span>
          </div>
        </AppFlowyPopover>
      </div>
      {actions && <div style={{ marginLeft: 16, display: 'flex', gap: 8 }}>{actions}</div>}
    </div>
  );
}

/** SettingsRadioSelect: 14px circles, 24px spacing. */
export function SettingsRadioSelect<T>({
  items,
  onChanged,
}: {
  items: Array<{ value: T; label: string; isSelected: boolean; icon?: ReactNode }>;
  onChanged: (value: T) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 24, rowGap: 8 }}>
      {items.map((item, index) => (
        <div key={index} onClick={() => onChanged(item.value)} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--afx-text)', padding: 2 }}>
            {item.isSelected && <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'var(--afx-text)' }} />}
          </div>
          <div style={{ width: 8 }} />
          {item.icon && <span style={{ display: 'flex', marginRight: 4 }}>{item.icon}</span>}
          <FlowyText>{item.label}</FlowyText>
        </div>
      ))}
    </div>
  );
}

/** OutlinedRoundedButton: 1px border, inner FlowyButton, height 32. */
export function OutlinedRoundedButton({ text, onTap, minWidth }: { text: string; onTap: () => void; minWidth?: number }) {
  return (
    <div
      className="flowy-hover"
      onClick={onTap}
      style={{
        border: `1px solid ${'var(--outlined-rounded-border)'}`,
        borderRadius: 8,
        padding: '9px 16px',
        minWidth,
        display: 'inline-flex',
        justifyContent: 'center',
        ['--outlined-rounded-border' as string]: 'color-mix(in srgb, var(--text-color) 12%, transparent)',
      }}
    >
      <FlowyText lineHeight={14}>{text}</FlowyText>
    </div>
  );
}

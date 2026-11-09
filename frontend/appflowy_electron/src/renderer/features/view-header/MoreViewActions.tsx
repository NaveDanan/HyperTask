import { useRef, useState, type ReactNode } from 'react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { useTr } from '@/i18n';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { useAppearanceStore } from '@/theme/appearance-store';
import { AppFlowyPopover, FlowyButton, FlowyDivider, FlowyHover, FlowySvg, FlowyText, PopoverMutex, Tooltip, showConfirmDeletionDialog } from '@/ui';
import { useHomeStore } from '../home/home-store';
import { nameOrDefault } from '../view/view-ext';
import { formatDate } from './date-format';
import { refreshDocumentFontSize, syncFontSize, useDocumentFontSize } from './document-appearance-store';
import { MovePageMenu } from './MovePageMenu';
import { isReadOnly, viewIsLocked } from './page-access-level-store';
import { containPublishedPage, deleteView, duplicateView } from './view-service';
import { usePageAccessLevel, useViewScope } from './view-scope';

const isDocument = (view: ViewPB) => view.layout === ViewLayoutPB.Document;
const isDatabase = (view: ViewPB) =>
  view.layout === ViewLayoutPB.Grid || view.layout === ViewLayoutPB.Board || view.layout === ViewLayoutPB.Calendar;

export interface CustomViewActionProps {
  leftIcon: FlowySvgName;
  label: string;
  tooltipMessage?: string;
  disabled?: boolean;
  onTap?: () => void;
}

/** CustomViewAction (more_view_actions/widgets/common_view_action.dart). */
export function CustomViewAction({ leftIcon, label, tooltipMessage, disabled, onTap }: CustomViewActionProps) {
  return (
    <div style={{ height: 34, padding: '2px 0', boxSizing: 'border-box' }}>
      <Tooltip message={tooltipMessage}>
        <FlowyButton
          margin="0 6px"
          height={30}
          disable={disabled}
          onTap={onTap}
          iconPadding={10}
          leftIcon={<FlowySvg svg={leftIcon} size={16} color={disabled ? 'var(--th-disabled)' : undefined} />}
          text={
            <FlowyText lineHeight={18} color={disabled ? 'var(--th-disabled)' : undefined}>
              {label}
            </FlowyText>
          }
        />
      </Tooltip>
    </div>
  );
}

const Divider = () => (
  <div style={{ padding: 8 }}>
    <FlowyDivider />
  </div>
);

/** ViewMoreActionTypeWrapper._buildActionButton: 34px rows, 16px icon, 10px gap. */
function ActionButton({
  icon,
  label,
  isDelete,
  onTap,
  rightIcon,
}: {
  icon: FlowySvgName;
  label: string;
  isDelete?: boolean;
  onTap?: () => void;
  rightIcon?: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const color = isDelete && hover ? 'var(--cs-error)' : undefined;
  return (
    <div style={{ height: 34, padding: '2px 0', boxSizing: 'border-box' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <FlowyButton
        margin="0 6px"
        height={30}
        iconPadding={10}
        onTap={onTap}
        leftIcon={<FlowySvg svg={icon} size={16} color={color} />}
        rightIcon={rightIcon}
        text={
          <FlowyText.regular fontSize={14} lineHeight={18} color={color}>
            {label}
          </FlowyText.regular>
        }
      />
    </div>
  );
}

/** LockPageButtonWrapper: disabled with a tooltip while the page is locked. */
function LockedWrapper({ locked, children }: { locked: boolean; children: ReactNode }) {
  const { tr } = useTr();
  if (!locked) return <>{children}</>;
  return (
    <Tooltip message={tr('lockPage.lockedOperationTooltip')}>
      <div style={{ pointerEvents: 'none' }}>{children}</div>
    </Tooltip>
  );
}

// Material Icons.format_size_sharp.
function FormatSizeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--icon-color)" aria-hidden>
      <path d="M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z" />
    </svg>
  );
}

/** FontSizeAction + FontSizeStepper (min 10, max 24, 8 divisions). */
function FontSizeAction() {
  const { tr } = useTr();
  return (
    <AppFlowyPopover
      direction="leftWithCenterAligned"
      constraints={{ maxHeight: 40, maxWidth: 240, width: 240 }}
      offset={{ x: -10, y: 0 }}
      onOpen={refreshDocumentFontSize}
      popup={() => <FontSizeStepper />}
    >
      <div style={{ height: 34, padding: '2px 0', boxSizing: 'border-box' }}>
        <FlowyButton
          height={30}
          hoverColor="var(--afx-light-grey-hover)"
          leftIcon={<FormatSizeIcon />}
          leftIconSize={18}
          text={
            <FlowyText.regular fontSize={14} lineHeight={18} color="var(--afx-text)">
              {tr('moreAction.fontSize')}
            </FlowyText.regular>
          }
        />
      </div>
    </AppFlowyPopover>
  );
}

function FontSizeStepper() {
  const fontSize = useDocumentFontSize((s) => s.fontSize);
  const [value, setValue] = useState(() => Math.min(24, Math.max(10, fontSize)));
  return (
    <div style={{ padding: '0 10px', display: 'flex', alignItems: 'center', height: 28 }}>
      <FlowyText fontSize={14}>A</FlowyText>
      <div style={{ width: 6 }} />
      <input
        type="range"
        min={10}
        max={24}
        step={1.75}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          setValue(next);
          void syncFontSize(next);
        }}
        style={{ flex: 1, minWidth: 0, accentColor: 'var(--cs-primary)', cursor: 'pointer' }}
      />
      <div style={{ width: 6 }} />
      <FlowyText fontSize={20}>A</FlowyText>
    </div>
  );
}

/** LockPageAction: "Lock page" with a switch (server workspaces only). */
function LockPageAction() {
  const { tr } = useTr();
  const scope = useViewScope();
  const access = usePageAccessLevel();
  if (!scope || !access) return null;
  const toggle = () => void (access.isLocked ? scope.accessLevel.unlock() : scope.accessLevel.lock());
  return (
    <div style={{ height: 34, padding: '2px 0', boxSizing: 'border-box' }}>
      <FlowyButton
        margin="0 6px"
        height={30}
        iconPadding={10}
        onTap={toggle}
        leftIcon={<FlowySvg svg="lock_page_s" size={16} />}
        text={<FlowyText lineHeight={18}>{tr('disclosureAction.lockPage')}</FlowyText>}
        rightIcon={
          access.isLoadingLockStatus ? undefined : (
            <div style={{ width: 30, height: 20, marginRight: 6, display: 'flex', alignItems: 'center' }}>
              <div
                style={{
                  width: 30,
                  height: 18,
                  borderRadius: 9,
                  background: access.isLocked ? 'var(--cs-primary)' : 'var(--afx-toggle-off-fill)',
                  position: 'relative',
                  transition: 'background 150ms',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: access.isLocked ? 14 : 2,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: '#FFFFFF',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                    transition: 'left 150ms',
                  }}
                />
              </div>
            </div>
          )
        }
      />
    </div>
  );
}

/** ViewMetaInfo: "Created: <date>" (word counts come with the document editor). */
function ViewMetaInfo({ createdAt }: { createdAt: Date }) {
  const { tr } = useTr();
  const dateTime = useAppearanceStore((s) => s.dateTime);
  return (
    <div style={{ padding: '0 6px', display: 'flex', flexDirection: 'column' }}>
      <FlowyText.regular fontSize={12} maxLines={2} color="var(--th-hint)">
        {tr('moreAction.createdAt', { args: [formatDate(createdAt, dateTime.dateFormat, true, dateTime.timeFormat)] })}
      </FlowyText.regular>
    </div>
  );
}

/** MoreViewActions (workspace/presentation/widgets/more_view_actions/more_view_actions.dart). */
export function MoreViewActions({ view, customActions }: { view: ViewPB; customActions?: ReactNode }) {
  const { tr } = useTr();
  const mutexRef = useRef(new PopoverMutex());
  return (
    <AppFlowyPopover
      mutex={mutexRef.current}
      constraints={{ maxWidth: 245, maxHeight: 600, width: 245 }}
      direction="bottomWithRightAligned"
      offset={{ x: 0, y: 12 }}
      popup={(close) => <MoreViewActionsMenu view={view} customActions={customActions} close={close} />}
    >
      {/* A real element first: popovers and tooltips anchor to their first element child. */}
      <div style={{ display: 'flex', flexShrink: 0 }}>
        <Tooltip message={tr('moreAction.moreOptions')}>
          <FlowyHover foregroundColorOnHover="var(--cs-on-surface)" style={{ padding: 6, display: 'flex' }}>
            <FlowySvg svg="three_dots_s" size={18} />
          </FlowyHover>
        </Tooltip>
      </div>
    </AppFlowyPopover>
  );
}

function MoreViewActionsMenu({
  view: widgetView,
  customActions,
  close,
}: {
  view: ViewPB;
  customActions?: ReactNode;
  close: () => void;
}) {
  const { tr } = useTr();
  const access = usePageAccessLevel();
  const workspaceType = useHomeStore((s) => s.user?.workspaceType);
  const view = access?.view ?? widgetView;
  const readOnly = access ? isReadOnly(access) : false;
  const locked = viewIsLocked(view);
  const serverWorkspace = workspaceType === WorkspaceTypePB.ServerW;

  const onDelete = async () => {
    const [published] = await containPublishedPage(view);
    close();
    if (published) {
      showConfirmDeletionDialog({
        name: nameOrDefault(view),
        description: tr('publish.containsPublishedPage'),
        onConfirm: () => void deleteView(view),
      });
    } else {
      void deleteView(view);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      {customActions}
      {isDocument(widgetView) && (
        <>
          <FontSizeAction />
          <Divider />
        </>
      )}
      {serverWorkspace && (isDocument(widgetView) || isDatabase(widgetView)) && !readOnly && (
        <>
          <LockPageAction />
          <Divider />
        </>
      )}
      {!readOnly && (
        <>
          {widgetView.layout !== ViewLayoutPB.Chat && (
            <ActionButton
              icon="duplicate_s"
              label={tr('disclosureAction.duplicate')}
              onTap={() => {
                void duplicateView(view);
                close();
              }}
            />
          )}
          {/* Move to is only available in server workspaces (MovePageMenu). */}
          {serverWorkspace && (
            <LockedWrapper locked={locked}>
              <AppFlowyPopover
                constraints={{ maxWidth: 260, maxHeight: 345, width: 260 }}
                margin="12px 14px"
                direction="leftWithTopAligned"
                offset={{ x: -10, y: 0 }}
                popup={(closeMove) => (
                  <MovePageMenu
                    sourceView={view}
                    onSelected={() => {
                      closeMove();
                      close();
                    }}
                  />
                )}
              >
                <ActionButton icon="move_to_s" label={tr('disclosureAction.moveTo')} />
              </AppFlowyPopover>
            </LockedWrapper>
          )}
          <LockedWrapper locked={locked}>
            <ActionButton icon="trash_s" label={tr('disclosureAction.delete')} isDelete onTap={() => void onDelete()} />
          </LockedWrapper>
          <Divider />
        </>
      )}
      <ViewMetaInfo createdAt={new Date(Number(widgetView.createTime) * 1000)} />
      <div style={{ height: 4, flexShrink: 0 }} />
    </div>
  );
}

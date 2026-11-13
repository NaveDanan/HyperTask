import { useRef, useState, type ReactNode } from 'react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { useTr } from '@/i18n';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { useAppearanceStore } from '@/theme/appearance-store';
import { Copy, FolderInput, Lock, Minus, MoreHorizontal, Plus, SquarePen, Trash2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';
import { MenuFootnote, MenuRow, MenuSeparator } from '@/components/app/menu-row';
import { AppFlowyPopover, PopoverMutex, Tooltip, showConfirmDeletionDialog } from '@/ui';
import { useHomeStore } from '../home/home-store';
import { nameOrDefault } from '../view/view-ext';
import { formatDate } from './date-format';
import { refreshDocumentFontSize, syncFontSize, useDocumentFontSize } from './document-appearance-store';
import { MovePageMenu } from './MovePageMenu';
import { isReadOnly, viewIsLocked } from './page-access-level-store';
import { containPublishedPage, deleteView, duplicateView } from './view-service';
import { usePageAccessLevel, useViewScope } from './view-scope';
import { hyperCaptureSearchOwner } from '../search/HyperSearchOwner';

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
    <Tooltip message={tooltipMessage}>
      <div><MenuRow disabled={disabled} onClick={onTap} icon={leftIcon === 'ai_add_to_page_s' ? <SquarePen className="size-4" /> : <Copy className="size-4" />} label={label} /></div>
    </Tooltip>
  );
}

function ActionButton({ icon, label, isDelete, onTap, rightIcon }: {
  icon: FlowySvgName; label: string; isDelete?: boolean; onTap?: () => void; rightIcon?: ReactNode;
}) {
  const Icon = icon === 'move_to_s' ? FolderInput : icon === 'trash_s' ? Trash2 : Copy;
  return <MenuRow icon={<Icon className="size-4" />} label={label} destructive={isDelete} onClick={onTap} trailing={rightIcon} />;
}

/** LockPageButtonWrapper: disabled with a tooltip while the page is locked. */
function LockedWrapper({ locked, children }: { locked: boolean; children: ReactNode }) {
  const { tr } = useTr();
  if (!locked) return <>{children}</>;
  return (
    <Tooltip message={tr('lockPage.lockedOperationTooltip')}>
      <div className="pointer-events-none opacity-50">{children}</div>
    </Tooltip>
  );
}

/** Keep the existing 10–24 range and 1.75 step, now exposed as the specified stepper. */
function FontSizeAction() {
  const { tr } = useTr();
  return (
    <div className="relative flex items-center">
      <MenuRow icon={<Type className="size-4" />} label={tr('moreAction.fontSize')} className="pr-24" />
      <div className="absolute right-1.5"><FontSizeStepper /></div>
    </div>
  );
}

function FontSizeStepper() {
  const fontSize = useDocumentFontSize((s) => s.fontSize);
  const [value, setValue] = useState(() => Math.min(24, Math.max(10, fontSize)));
  const update = (next: number) => { setValue(next); void syncFontSize(next); };
  return (
    <ButtonGroup>
      <Button variant="outline" size="icon-xs" aria-label="Decrease font size" disabled={value <= 10} onClick={() => update(Math.max(10, value - 1.75))}><Minus className="size-4" /></Button>
      <span className="flex w-8 items-center justify-center text-center text-xs tabular-nums">{value}</span>
      <Button variant="outline" size="icon-xs" aria-label="Increase font size" disabled={value >= 24} onClick={() => update(Math.min(24, value + 1.75))}><Plus className="size-4" /></Button>
    </ButtonGroup>
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
    <div className="relative flex items-center">
      <MenuRow icon={<Lock className="size-4" />} label={tr('disclosureAction.lockPage')} onClick={toggle} className="pr-10" />
      {!access.isLoadingLockStatus && <Switch size="sm" className="absolute right-1.5" aria-label={tr('disclosureAction.lockPage')} checked={access.isLocked} onCheckedChange={toggle} />}
    </div>
  );
}

/** ViewMetaInfo: "Created: <date>" (word counts come with the document editor). */
function ViewMetaInfo({ createdAt }: { createdAt: Date }) {
  const { tr } = useTr();
  const dateTime = useAppearanceStore((s) => s.dateTime);
  return <MenuFootnote>{tr('moreAction.createdAt', { args: [formatDate(createdAt, dateTime.dateFormat, true, dateTime.timeFormat)] })}</MenuFootnote>;
}

/** MoreViewActions (workspace/presentation/widgets/more_view_actions/more_view_actions.dart). */
export function MoreViewActions({ view, customActions }: { view: ViewPB; customActions?: ReactNode }) {
  const { tr } = useTr();
  const mutexRef = useRef(new PopoverMutex());
  return (
    <AppFlowyPopover
      mutex={mutexRef.current}
      onOpen={view.layout === ViewLayoutPB.Document ? refreshDocumentFontSize : undefined}
      constraints={{ maxWidth: 240, maxHeight: 600, width: 240 }}
      direction="bottomWithRightAligned"
      offset={{ x: 0, y: 12 }}
      popup={(close) => <MoreViewActionsMenu view={view} customActions={customActions} close={close} />}
    >
      <div className="flex shrink-0">
        <Tooltip message={tr('moreAction.moreOptions')}>
          <Button variant="ghost" size="icon-sm" aria-label={tr('moreAction.moreOptions')}><MoreHorizontal className="size-4" /></Button>
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
    const scope = hyperCaptureSearchOwner();
    if (!scope) return;
    const [published] = await containPublishedPage(view, scope);
    if (!scope.isCurrent()) return;
    close();
    if (published) {
      showConfirmDeletionDialog({
        name: nameOrDefault(view),
        description: tr('publish.containsPublishedPage'),
        onConfirm: () => { if (scope.isCurrent()) void deleteView(view, scope); },
      });
    } else {
      void deleteView(view, scope);
    }
  };

  return (
    <div className="flex flex-col">
      {customActions}
      {isDocument(widgetView) && (
        <>
          <FontSizeAction />
          <MenuSeparator />
        </>
      )}
      {serverWorkspace && (isDocument(widgetView) || isDatabase(widgetView)) && !readOnly && (
        <>
          <LockPageAction />
          <MenuSeparator />
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
        </>
      )}
      <MenuSeparator />
      <ViewMetaInfo createdAt={new Date(Number(widgetView.createTime) * 1000)} />
    </div>
  );
}

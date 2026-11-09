// Space widgets: SpaceIcon (space_icon.dart), CurrentSpace / SpacePopup / SpacePages /
// SpacePermissionSwitch / SpaceCancelOrConfirmButton / SpaceSearchField (shared_widget.dart),
// SidebarSpaceMenu (sidebar_space_menu.dart), SpaceIconPopup (space_icon_popup.dart),
// CreateSpacePopup and ManageSpacePopup.
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import { Check, ChevronDown, Globe, Lock, PencilLine, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { floatingSurfaceClass, MenuRow, MenuSeparator } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';
import {
  AppFlowyPopover,
  FlowySvg,
  MaterialDialog,
  Tooltip,
  showDialog,
  usePopoverContainer,
  type PopoverController,
} from '@/ui';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { SpacePermission, spaceIcon, spaceIconColor, spacePermission, viewExtra, ViewExtKeys } from '@/features/view/view-ext';
import { FlowyTextField } from '../components';
import { IconEmojiPicker } from '../icon-picker/IconEmojiPicker';
import { findSvgContent, parseIconsData, svgDataUrl, useIconGroups } from '../icon-picker/icon-groups';
import type { SpaceStore } from '../stores/space-store';
import { builtInSpaceColors, dartColorToCss, kDefaultSpaceIconId, type IgnoreViewType } from '../stores/types';
import { useViewBloc } from '../stores/view-bloc';
import { ViewItem, type ViewItemOnSelected } from '../view/ViewItem';
import type { ViewBloc } from '../stores/view-bloc';
import { SpaceStoreContext, useSpaceBloc, useSpaceState } from './space-context';

/** A monochrome SVG string tinted like FlowySvg.string(color:). */
function SvgGlyph({ content, size, color: _color }: { content: string; size: number; color: string }) {
  return (
    <span
      className="inline-block shrink-0 bg-current [mask-size:100%_100%] [mask-repeat:no-repeat]"
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url("${svgDataUrl(content)}")`,
      }}
    />
  );
}

/** SpaceIcon: the space's icon on its color, or its initial on the first built-in color. */
export function SpaceIcon({
  dimension,
  textDimension: _textDimension,
  cornerRadius: _cornerRadius = 0,
  space,
  svgSize,
}: {
  dimension: number;
  textDimension?: number;
  cornerRadius?: number;
  space: ViewPB;
  svgSize?: number;
}) {
  const groups = useIconGroups();
  const icon = spaceIcon(space);
  let glyph: ReactNode = null;
  let background: string | null;
  if (!icon) {
    const initial = space.name ? space.name.charAt(0).toUpperCase() : '';
    glyph = (
      <span className="text-xs font-medium text-white">{initial}</span>
    );
    background = dartColorToCss(builtInSpaceColors[0]);
  } else {
    // buildSpaceIconSvg needs both the icon and the color keys.
    const extra = viewExtra(space);
    const hasColor = extra?.[ViewExtKeys.spaceIconColor] != null;
    if (hasColor) {
      if (icon.includes('space_icon')) {
        glyph = <FlowySvg svg={`${icon}_s` as FlowySvgName} color="currentColor" />;
      } else {
        const content = findSvgContent(icon, groups);
        if (content) glyph = <SvgGlyph content={content} size={svgSize ?? 16} color="currentColor" />;
      }
    }
    const color = spaceIconColor(space);
    background = color ? dartColorToCss(color) : 'transparent';
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-md text-white"
      style={{ width: dimension, height: dimension, background: background ?? 'transparent' }}
    >
      {glyph}
    </div>
  );
}

/** DefaultSpaceIcon: kDefaultSpaceIconId on #A34AFD. */
export function DefaultSpaceIcon({ dimension, iconDimension, cornerRadius: _cornerRadius = 0 }: { dimension: number; iconDimension: number; cornerRadius?: number }) {
  const groups = useIconGroups();
  const content = findSvgContent(kDefaultSpaceIconId, groups);
  return (
    <div
      className="flex items-center justify-center overflow-hidden rounded-md text-white"
      style={{ width: dimension, height: dimension, background: dartColorToCss(builtInSpaceColors[0]) ?? undefined }}
    >
      {content ? (
        <SvgGlyph content={content} size={iconDimension} color="currentColor" />
      ) : (
        <FlowySvg svg="space_icon_1_s" size={iconDimension} color="currentColor" />
      )}
    </div>
  );
}

/** CurrentSpace: icon, name and the expand arrow; `onTapBlankArea` adds the move-to-space target. */
export function CurrentSpace({ space, isHovered: _isHovered = false, onTapBlankArea }: { space: ViewPB; isHovered?: boolean; onTapBlankArea?: () => void }) {
  const { tr } = useTr();
  const child = (
    <div className="flex min-w-0 items-center gap-2">
      <SpaceIcon dimension={20} space={space} svgSize={12} cornerRadius={6} />
      <span className="truncate text-sm font-medium">{space.name}</span>
      <ChevronDown className="size-3.5 shrink-0 text-sidebar-foreground/50" />
    </div>
  );
  if (!onTapBlankArea) return child;
  return (
    <div className="flex w-full items-stretch">
      <div className="flex min-w-0 flex-[2] rounded-md p-0.5 transition-colors hover:bg-sidebar-accent">
        {child}
      </div>
      <Tooltip message={tr('space.movePageToSpace')}>
        <button
          type="button"
          aria-label={tr('space.movePageToSpace')}
          className="flex-1 rounded-md transition-colors hover:bg-sidebar-accent"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onTapBlankArea();
          }}
        />
      </Tooltip>
    </div>
  );
}

/** SpacePopup: the space switcher trigger (click on the name). */
export function SpacePopup({
  height = 32,
  useIntrinsicWidth = true,
  showCreateButton,
  children,
  style,
}: {
  height?: number;
  useIntrinsicWidth?: boolean;
  showCreateButton: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const bloc = useSpaceBloc();
  return (
    <div className="flex min-w-0 flex-1" style={{ height, ...style }} onClick={(event) => event.stopPropagation()}>
      <AppFlowyPopover
        plain
        margin={0}
        constraints={{ width: 256, maxWidth: 256 }}
        direction="bottomWithLeftAligned"
        offset={{ x: 0, y: 4 }}
        popup={() => (
          <SpaceStoreContext.Provider value={bloc}>
            <SidebarSpaceMenu showCreateButton={showCreateButton} />
          </SpaceStoreContext.Provider>
        )}
      >
        {useIntrinsicWidth ? (
          <button type="button" className="flex h-full max-w-full items-center rounded-md text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring">{children}</button>
        ) : (
          <div className="flex h-full w-full max-w-full items-center rounded-md transition-colors hover:bg-sidebar-accent">{children}</div>
        )}
      </AppFlowyPopover>
    </div>
  );
}

/** SidebarSpaceMenu: every space (30px rows), then "Create a new space". */
export function SidebarSpaceMenu({ showCreateButton }: { showCreateButton: boolean }) {
  const { tr } = useTr();
  const bloc = useSpaceBloc();
  const spaces = useSpaceState((s) => s.spaces);
  const currentId = useSpaceState((s) => s.currentSpace?.id);
  const popover = usePopoverContainer();
  return (
    <div className={cn(floatingSurfaceClass, 'flex w-64 flex-col p-1')}>
      {spaces.map((space) => (
        <MenuRow key={space.id} icon={<SpaceIcon dimension={20} space={space} svgSize={12} cornerRadius={6} />}
          label={<span className="flex min-w-0 items-center gap-1.5"><span className="truncate">{space.name}</span>{spacePermission(space) === SpacePermission.private && <Tooltip message={tr('space.privatePermissionDescription')}><Lock className="size-3.5 shrink-0 text-muted-foreground" /></Tooltip>}</span>}
          trailing={currentId === space.id ? <Check className="size-4" /> : undefined}
          onClick={() => { void bloc.actions.open(space); popover?.close(); }} />
      ))}
      {showCreateButton && <><MenuSeparator /><MenuRow icon={<Plus className="size-4" />} label={tr('space.createNewSpace')}
        onClick={() => { popover?.close(); showCreateSpaceDialog(bloc); }} /></>}
    </div>
  );
}

/** SpacePages: the space's root pages, one ViewItem each (keyed by space + view). */
export function SpacePages({
  space,
  hoverGated,
  collapseAllSignal,
  onSelected,
  onTertiarySelected,
  rightIconsBuilder,
  disableSelectedStatus = false,
  shouldIgnoreView,
}: {
  space: ViewPB;
  hoverGated: boolean;
  collapseAllSignal?: number;
  onSelected: ViewItemOnSelected;
  onTertiarySelected?: (view: ViewPB) => void;
  rightIconsBuilder?: (view: ViewPB, bloc: ViewBloc) => ReactNode;
  disableSelectedStatus?: boolean;
  shouldIgnoreView?: (view: ViewPB) => IgnoreViewType;
}) {
  const bloc = useViewBloc(space);
  const view = useStore(bloc.store, (s) => s.view);
  let childViews = view.childViews;
  if (shouldIgnoreView) childViews = childViews.filter((v) => shouldIgnoreView(v) !== 'hide');
  const spaceType = spacePermission(space) === SpacePermission.publicToAll ? 'public' : 'private';
  return (
    <div className="mt-0.5 flex flex-col gap-px">
      {childViews.map((child) => (
        <ViewItem
          key={`${space.id} ${child.id}`}
          spaceType={spaceType}
          isFirstChild={child.id === childViews[0].id}
          view={child}
          level={0}
          leftPadding={16}
          isFeedback={false}
          hoverGated={hoverGated}
          enableRightClickContext={!disableSelectedStatus}
          disableSelectedStatus={disableSelectedStatus}
          collapseAllSignal={collapseAllSignal}
          rightIconsBuilder={rightIconsBuilder}
          onSelected={onSelected}
          onTertiarySelected={onTertiarySelected}
          shouldIgnoreView={shouldIgnoreView}
        />
      ))}
    </div>
  );
}

/** SpacePermissionButton: a 20px icon, title and description; a dropdown arrow in the switch. */
function SpacePermissionButton({ permission, onTap, showArrow = false }: { permission: SpacePermission; onTap?: () => void; showArrow?: boolean }) {
  const { tr } = useTr();
  const isPublic = permission === SpacePermission.publicToAll;
  return (
    <MenuRow icon={isPublic ? <Globe className="size-5" /> : <Lock className="size-5" />}
      label={tr(isPublic ? 'space.publicPermission' : 'space.privatePermission')}
      description={tr(isPublic ? 'space.publicPermissionDescription' : 'space.privatePermissionDescription')}
      trailing={showArrow ? <ChevronDown className="size-4 text-muted-foreground" /> : undefined} onClick={onTap} />
  );
}

export function SpacePermissionSwitch({
  spacePermission: initial,
  onPermissionChanged,
}: {
  spacePermission?: SpacePermission;
  onPermissionChanged: (permission: SpacePermission) => void;
}) {
  const { tr } = useTr();
  const [permission, setPermission] = useState(initial ?? SpacePermission.publicToAll);
  const controller = useRef<PopoverController>(null);
  const change = (value: SpacePermission) => {
    onPermissionChanged(value);
    setPermission(value);
    controller.current?.close();
  };
  return (
    <div className="flex w-full flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">
        {tr('space.permission')}
      </span>
      <AppFlowyPopover
        controllerRef={controller}
        plain
        direction="bottomWithCenterAligned"
        constraints={{ maxWidth: 500 }}
        offset={{ x: 0, y: 4 }}
        margin={0}
        popup={() => (
          <div className={cn(floatingSurfaceClass, 'flex w-[28rem] max-w-full flex-col p-1')}>
            <SpacePermissionButton permission={SpacePermission.publicToAll} onTap={() => change(SpacePermission.publicToAll)} />
            <SpacePermissionButton permission={SpacePermission.private} onTap={() => change(SpacePermission.private)} />
          </div>
        )}
      >
        <div className="rounded-lg border border-input p-1">
          <SpacePermissionButton showArrow permission={permission} />
        </div>
      </AppFlowyPopover>
    </div>
  );
}

/** SpaceCancelOrConfirmButton: outlined Cancel + a filled confirm (primary unless colored). */
export function SpaceCancelOrConfirmButton({
  onCancel,
  onConfirm,
  confirmButtonName,
  confirmButtonColor,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmButtonName: string;
  confirmButtonColor?: string;
}) {
  const { tr } = useTr();
  return (
    <div className="flex w-full items-center justify-end gap-2">
      <Button variant="outline" onClick={onCancel}>{tr('button.cancel')}</Button>
      <Button className={confirmButtonColor ? 'bg-destructive text-white hover:bg-destructive/90' : undefined} onClick={onConfirm}>{confirmButtonName}</Button>
    </div>
  );
}

/** Autofocused menu search, retaining query and clear callbacks. */
export function SpaceSearchField({ width: _width, onSearch }: { width: number; onSearch: (text: string) => void }) {
  const { tr } = useTr();
  const [value, setValue] = useState('');
  return (
    <InputGroup className="h-9 rounded-none border-0 bg-transparent focus-within:ring-0">
      <InputGroupAddon><Search className="size-4" /></InputGroupAddon>
      <InputGroupInput autoFocus value={value} placeholder={tr('search.label')} className="h-9"
        onChange={(event) => { setValue(event.target.value); onSearch(event.target.value); }} />
      {value && <InputGroupAddon align="inline-end"><Button variant="ghost" size="icon-xs" aria-label={tr('button.remove')}
        onClick={() => { setValue(''); onSearch(''); }}><X className="size-4" /></Button></InputGroupAddon>}
    </InputGroup>
  );
}

/** SpaceIconPopup: the icon preview (rename pencil on hover) opening the icon picker. */
export function SpaceIconPopup({
  icon,
  iconColor,
  cornerRadius = 16,
  space,
  onIconChanged,
}: {
  icon?: string | null;
  iconColor?: string | null;
  cornerRadius?: number;
  space?: ViewPB | null;
  onIconChanged: (icon: string | null, color: string | null) => void;
}) {
  const { tr } = useTr();
  const groups = useIconGroups();
  const [selectedIcon, setSelectedIcon] = useState<string | null>(icon ?? null);
  const [selectedColor, setSelectedColor] = useState<string>(iconColor ?? builtInSpaceColors[0]);
  const [hover, setHover] = useState(false);

  let preview: ReactNode;
  if (selectedIcon === null) {
    preview = space ? (
      <SpaceIcon dimension={32} space={space} svgSize={24} cornerRadius={cornerRadius} />
    ) : (
      <DefaultSpaceIcon cornerRadius={cornerRadius} dimension={32} iconDimension={32} />
    );
  } else if (selectedIcon.includes('space_icon')) {
    preview = (
      <div className="flex size-full items-center justify-center rounded-md text-white" style={{ background: dartColorToCss(selectedColor) ?? undefined }}>
        <FlowySvg svg={`${selectedIcon}_s` as FlowySvgName} size={42} color="currentColor" />
      </div>
    );
  } else {
    const content = findSvgContent(selectedIcon, groups);
    preview = content ? (
      <div className="flex size-full items-center justify-center rounded-md text-white" style={{ background: dartColorToCss(selectedColor) ?? undefined }}>
        <SvgGlyph content={content} size={24} color="currentColor" />
      </div>
    ) : null;
  }

  return (
    <AppFlowyPopover
      plain
      offset={{ x: 0, y: 4 }}
      constraints={{ maxWidth: 360, maxHeight: 432 }}
      margin={0}
      direction="bottomWithCenterAligned"
      popup={(close) => (
        <IconEmojiPicker
          tabs={['icon']}
          width={360}
          height={432}
          onSelected={(result) => {
            if (result.data.type === 'icon') {
              const data = parseIconsData(result.data.emoji);
              if (data) {
                const next = `${data.groupName}/${data.iconName}`;
                const color = data.color ?? selectedColor;
                setSelectedIcon(next);
                setSelectedColor(color);
                onIconChanged(next, color);
              } else {
                setSelectedIcon('');
                onIconChanged('', selectedColor);
              }
            }
            close();
          }}
        />
      )}
    >
      <button
        type="button"
        aria-label={tr('space.changeIcon')}
        className="relative flex size-full cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div className={cn('absolute inset-0 flex items-center justify-center', hover && 'opacity-20')}>
          {preview}
        </div>
        {hover && (
          <div className="relative flex">
            <PencilLine className="size-5" />
          </div>
        )}
      </button>
    </AppFlowyPopover>
  );
}

/** showDialog(Dialog(radius 12)) around a space popup. */
function showSpaceDialog(bloc: SpaceStore, render: (close: () => void) => ReactNode) {
  showDialog((close) => (
    <SpaceStoreContext.Provider value={bloc}>
      <MaterialDialog radius={12}>{render(close)}</MaterialDialog>
    </SpaceStoreContext.Provider>
  ));
}

export function showCreateSpaceDialog(bloc: SpaceStore) {
  showSpaceDialog(bloc, (close) => <CreateSpacePopup close={close} />);
}

export function showManageSpaceDialog(bloc: SpaceStore) {
  showSpaceDialog(bloc, (close) => <ManageSpacePopup close={close} />);
}

/** CreateSpacePopup: defaults "General", home-3 on #A34AFD, public. No empty-name check. */
function CreateSpacePopup({ close }: { close: () => void }) {
  const { tr } = useTr();
  const bloc = useSpaceBloc();
  const values = useRef({
    name: tr('space.defaultSpaceName'),
    icon: kDefaultSpaceIconId as string | null,
    iconColor: builtInSpaceColors[0] as string | null,
    permission: SpacePermission.publicToAll,
  });
  const create = () => {
    const v = values.current;
    void bloc.actions.create({
      name: v.name,
      icon: v.icon ?? '',
      iconColor: v.iconColor ?? '',
      permission: v.permission,
      createNewPageByDefault: true,
      openAfterCreate: true,
    });
    close();
  };
  return (
    <div className="flex w-[32rem] max-w-full flex-col items-center gap-4 p-6">
      <h2 className="text-lg font-semibold">{tr('space.createNewSpace')}</h2>
      <p className="text-sm text-muted-foreground">{tr('space.createSpaceDescription')}</p>
      <div className="size-14">
        <SpaceIconPopup
          onIconChanged={(icon, color) => {
            values.current.icon = icon;
            values.current.iconColor = color;
          }}
        />
      </div>
      <div className="flex w-full flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">
          {tr('space.spaceName')}
        </span>
        <div className="h-10">
          <FlowyTextField hintText={tr('space.spaceNamePlaceholder')} onChanged={(value) => (values.current.name = value)}
            onSubmitted={(value) => {
              values.current.name = value;
              create();
            }}
          />
        </div>
      </div>
      <SpacePermissionSwitch onPermissionChanged={(value) => (values.current.permission = value)} />
      <SpaceCancelOrConfirmButton confirmButtonName={tr('button.create')} onCancel={close} onConfirm={create} />
    </div>
  );
}

/** ManageSpacePopup: only touched values are sent (see SpaceBloc.update's icon quirk). */
function ManageSpacePopup({ close }: { close: () => void }) {
  const { tr } = useTr();
  const bloc = useSpaceBloc();
  const space = useStore(bloc.store, (s) => s.currentSpace);
  const values = useRef<{ name?: string; icon?: string | null; iconColor?: string | null; permission?: SpacePermission }>({});
  return (
    <div className="flex w-[32rem] max-w-full flex-col items-center gap-4 p-6">
      <h2 className="text-lg font-semibold">{tr('space.manage')}</h2>
      <div className="flex w-full flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">{tr('space.spaceName')}</span>
        <div className="flex h-10 items-center gap-3">
          <div className="size-10 shrink-0">
            <SpaceIconPopup
              space={space}
              cornerRadius={12}
              icon={space ? spaceIcon(space) : null}
              iconColor={space ? spaceIconColor(space) : null}
              onIconChanged={(icon, color) => {
                values.current.icon = icon;
                values.current.iconColor = color;
              }}
            />
          </div>
          <div className="h-10 min-w-0 flex-1">
            <FlowyTextField defaultValue={space?.name} onChanged={(value) => (values.current.name = value)} />
          </div>
        </div>
      </div>
      <SpacePermissionSwitch
        spacePermission={space ? spacePermission(space) : undefined}
        onPermissionChanged={(value) => (values.current.permission = value)}
      />
      <SpaceCancelOrConfirmButton
        confirmButtonName={tr('button.save')}
        onCancel={close}
        onConfirm={() => {
          const v = values.current;
          void bloc.actions.update({ name: v.name, icon: v.icon, iconColor: v.iconColor, permission: v.permission });
          close();
        }}
      />
    </div>
  );
}

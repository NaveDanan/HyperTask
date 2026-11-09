// Space widgets: SpaceIcon (space_icon.dart), CurrentSpace / SpacePopup / SpacePages /
// SpacePermissionSwitch / SpaceCancelOrConfirmButton / SpaceSearchField (shared_widget.dart),
// SidebarSpaceMenu (sidebar_space_menu.dart), SpaceIconPopup (space_icon_popup.dart),
// CreateSpacePopup and ManageSpacePopup.
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import { useBrightness } from '@/theme/appearance-store';
import {
  AFButton,
  AppFlowyPopover,
  FlowyButton,
  FlowyDivider,
  FlowySvg,
  FlowyText,
  MaterialDialog,
  Tooltip,
  VSpace,
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
function SvgGlyph({ content, size, color }: { content: string; size: number; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: size,
        height: size,
        background: color,
        WebkitMaskImage: `url("${svgDataUrl(content)}")`,
        WebkitMaskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
      }}
    />
  );
}

/** SpaceIcon: the space's icon on its color, or its initial on the first built-in color. */
export function SpaceIcon({
  dimension,
  textDimension,
  cornerRadius = 0,
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
      <FlowyText fontWeight={500} color="var(--cs-surface)" fontSize={svgSize} lineHeight={textDimension ?? dimension}>
        {initial}
      </FlowyText>
    );
    background = dartColorToCss(builtInSpaceColors[0]);
  } else {
    // buildSpaceIconSvg needs both the icon and the color keys.
    const extra = viewExtra(space);
    const hasColor = extra?.[ViewExtKeys.spaceIconColor] != null;
    if (hasColor) {
      if (icon.includes('space_icon')) {
        glyph = <FlowySvg svg={`${icon}_s` as FlowySvgName} color="var(--cs-surface)" />;
      } else {
        const content = findSvgContent(icon, groups);
        if (content) glyph = <SvgGlyph content={content} size={svgSize ?? 16} color="var(--cs-surface)" />;
      }
    }
    const color = spaceIconColor(space);
    background = color ? dartColorToCss(color) : 'transparent';
  }
  return (
    <div
      style={{
        width: dimension,
        height: dimension,
        borderRadius: cornerRadius,
        overflow: 'hidden',
        background: background ?? 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {glyph}
    </div>
  );
}

/** DefaultSpaceIcon: kDefaultSpaceIconId on #A34AFD. */
export function DefaultSpaceIcon({ dimension, iconDimension, cornerRadius = 0 }: { dimension: number; iconDimension: number; cornerRadius?: number }) {
  const groups = useIconGroups();
  const content = findSvgContent(kDefaultSpaceIconId, groups);
  return (
    <div
      style={{
        width: dimension,
        height: dimension,
        borderRadius: cornerRadius,
        background: dartColorToCss(builtInSpaceColors[0]) ?? undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {content ? (
        <SvgGlyph content={content} size={iconDimension} color="var(--cs-surface)" />
      ) : (
        <FlowySvg svg="space_icon_1_s" size={iconDimension} color="var(--cs-surface)" />
      )}
    </div>
  );
}

/** CurrentSpace: icon, name and the expand arrow; `onTapBlankArea` adds the move-to-space target. */
export function CurrentSpace({ space, isHovered = false, onTapBlankArea }: { space: ViewPB; isHovered?: boolean; onTapBlankArea?: () => void }) {
  const { tr } = useTr();
  const isExpanded = useSpaceState((s) => s.isExpanded);
  const color = isHovered ? 'var(--cs-on-surface)' : undefined;
  const child = (
    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
      <SpaceIcon dimension={22} space={space} svgSize={12} cornerRadius={8} />
      <div style={{ width: 10, flexShrink: 0 }} />
      <FlowyText fontWeight={500} lineHeight={18} ellipsis color={color} style={{ flexShrink: 1 }}>
        {space.name}
      </FlowyText>
      <div style={{ width: 4, flexShrink: 0 }} />
      <FlowySvg svg={isExpanded ? 'workspace_drop_down_menu_show_s' : 'workspace_drop_down_menu_hide_s'} color={color} />
    </div>
  );
  if (!onTapBlankArea) return child;
  return (
    <div style={{ display: 'flex', width: '100%', alignItems: 'stretch' }}>
      <div className="flowy-hover" style={{ flex: 2, minWidth: 0, padding: 2, display: 'flex' }}>
        {child}
      </div>
      <Tooltip message={tr('space.movePageToSpace')}>
        <div
          style={{ flex: 1 }}
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
    <div style={{ height, display: 'flex', minWidth: 0, ...style }} onClick={(event) => event.stopPropagation()}>
      <AppFlowyPopover
        constraints={{ width: 260, maxWidth: 260 }}
        direction="bottomWithLeftAligned"
        offset={{ x: 0, y: 4 }}
        popup={() => (
          <SpaceStoreContext.Provider value={bloc}>
            <SidebarSpaceMenu showCreateButton={showCreateButton} />
          </SpaceStoreContext.Provider>
        )}
      >
        <FlowyButton
          useIntrinsicWidth={useIntrinsicWidth}
          margin="0 4px 0 3px"
          iconPadding={10}
          text={children}
          style={{ height: '100%', maxWidth: '100%', width: useIntrinsicWidth ? undefined : '100%' }}
        />
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
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <VSpace size={4} />
      {spaces.map((space) => (
        <div key={space.id} style={{ height: 30, flexShrink: 0 }}>
          <FlowyButton
            height={30}
            iconPadding={10}
            leftIcon={<SpaceIcon dimension={20} space={space} svgSize={12} cornerRadius={6} />}
            leftIconSize={20}
            rightIcon={currentId === space.id ? <FlowySvg svg="workspace_selected_s" blendMode={null} /> : undefined}
            text={
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <FlowyText ellipsis style={{ flexShrink: 1 }}>
                  {space.name}
                </FlowyText>
                <div style={{ width: 6, flexShrink: 0 }} />
                {spacePermission(space) === SpacePermission.private && (
                  <Tooltip message={tr('space.privatePermissionDescription')}>
                    <div style={{ display: 'flex' }}>
                      <FlowySvg svg="space_lock_s" />
                    </div>
                  </Tooltip>
                )}
              </div>
            }
            onTap={() => {
              void bloc.actions.open(space);
              popover?.close();
            }}
          />
        </div>
      ))}
      {showCreateButton && (
        <>
          <div style={{ padding: '8px 0' }}>
            <FlowyDivider />
          </div>
          <div style={{ height: 30 }}>
            <FlowyButton
              height={30}
              iconPadding={10}
              leftIcon={<FlowySvg svg="space_add_s" />}
              text={<FlowyText>{tr('space.createNewSpace')}</FlowyText>}
              onTap={() => {
                popover?.close();
                showCreateSpaceDialog(bloc);
              }}
            />
          </div>
        </>
      )}
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
    <div style={{ display: 'flex', flexDirection: 'column' }}>
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

/** context.enableBorderColor (space/_extension.dart). */
export function useEnableBorderColor() {
  return useBrightness() === 'light' ? '#1717171E' : '#3A3F49';
}

/** SpacePermissionButton: a 20px icon, title and description; a dropdown arrow in the switch. */
function SpacePermissionButton({ permission, onTap, showArrow = false }: { permission: SpacePermission; onTap?: () => void; showArrow?: boolean }) {
  const { tr } = useTr();
  const border = useEnableBorderColor();
  const isPublic = permission === SpacePermission.publicToAll;
  return (
    <FlowyButton
      margin="12px 14px"
      radius={showArrow ? 10 : 0}
      iconPadding={16}
      leftIcon={<FlowySvg svg={isPublic ? 'space_permission_public_s' : 'space_permission_private_s'} />}
      leftIconSize={20}
      rightIcon={showArrow ? <FlowySvg svg="space_permission_dropdown_s" /> : undefined}
      borderColor={border}
      onTap={onTap}
      text={
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <FlowyText>{tr(isPublic ? 'space.publicPermission' : 'space.privatePermission')}</FlowyText>
          <VSpace size={4} />
          <FlowyText fontSize={12} color="var(--th-hint)">
            {tr(isPublic ? 'space.publicPermissionDescription' : 'space.privatePermissionDescription')}
          </FlowyText>
        </div>
      }
    />
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
  const border = useEnableBorderColor();
  const change = (value: SpacePermission) => {
    onPermissionChanged(value);
    setPermission(value);
    controller.current?.close();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <FlowyText lineHeight={18} color="var(--th-hint)">
        {tr('space.permission')}
      </FlowyText>
      <VSpace size={6} />
      <AppFlowyPopover
        controllerRef={controller}
        direction="bottomWithCenterAligned"
        constraints={{ maxWidth: 500 }}
        offset={{ x: 0, y: 4 }}
        margin={0}
        popup={() => (
          <div style={{ width: 452, display: 'flex', flexDirection: 'column' }}>
            <SpacePermissionButton permission={SpacePermission.publicToAll} onTap={() => change(SpacePermission.publicToAll)} />
            <SpacePermissionButton permission={SpacePermission.private} onTap={() => change(SpacePermission.private)} />
          </div>
        )}
      >
        <div style={{ borderRadius: 10, boxShadow: `inset 0 0 0 1px ${border}` }}>
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
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
      <AFButton variant="outlinedNormal" size="m" text={tr('button.cancel')} onTap={onCancel} style={{ fontWeight: 400 }} />
      <div style={{ width: 12 }} />
      <div style={{ borderRadius: 8, background: confirmButtonColor ?? 'var(--cs-primary)' }}>
        <FlowyButton
          useIntrinsicWidth
          margin="9px 16px"
          radius={8}
          onTap={onConfirm}
          text={
            <FlowyText style={{ lineHeight: 1 }} color="var(--cs-on-primary)">
              {confirmButtonName}
            </FlowyText>
          }
        />
      </div>
    </div>
  );
}

/** SpaceSearchField: a 30px CupertinoSearchTextField with a 1.2px #00BCF0 outline, autofocused. */
export function SpaceSearchField({ width, onSearch }: { width: number; onSearch: (text: string) => void }) {
  const { tr } = useTr();
  const [value, setValue] = useState('');
  return (
    <div className="sb-search-field" style={{ width }}>
      <div style={{ padding: '0 8px 0 12px', display: 'flex' }}>
        <FlowySvg svg="magnifier_s" size={16} />
      </div>
      <input
        autoFocus
        value={value}
        placeholder={tr('search.label')}
        onChange={(event) => {
          setValue(event.target.value);
          onSearch(event.target.value);
        }}
      />
      {value && (
        <div
          style={{ paddingRight: 8, display: 'flex', cursor: 'pointer', color: 'var(--th-hint)', fontSize: 16 }}
          onClick={() => {
            setValue('');
            onSearch('');
          }}
        >
          ✕
        </div>
      )}
    </div>
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
      <div style={{ width: '100%', height: '100%', borderRadius: cornerRadius, background: dartColorToCss(selectedColor) ?? undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FlowySvg svg={`${selectedIcon}_s` as FlowySvgName} size={42} color="var(--cs-surface)" />
      </div>
    );
  } else {
    const content = findSvgContent(selectedIcon, groups);
    preview = content ? (
      <div style={{ width: '100%', height: '100%', borderRadius: cornerRadius, background: dartColorToCss(selectedColor) ?? undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <SvgGlyph content={content} size={24} color="var(--cs-surface)" />
      </div>
    ) : null;
  }

  return (
    <AppFlowyPopover
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
      <div
        style={{ width: '100%', height: '100%', position: 'relative', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: hover ? 0.2 : 1 }}>
          {preview}
        </div>
        {hover && (
          <div style={{ position: 'relative', display: 'flex' }}>
            <FlowySvg svg="view_item_rename_s" size={20} />
          </div>
        )}
      </div>
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
  const border = useEnableBorderColor();
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
    <div style={{ padding: '16px 24px', width: 524, maxWidth: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <FlowyText fontSize={18} lineHeight={24}>
        {tr('space.createNewSpace')}
      </FlowyText>
      <VSpace size={2} />
      <FlowyText fontWeight={400} lineHeight={18} maxLines={2} color="var(--th-hint)" style={{ fontWeight: 300 }}>
        {tr('space.createSpaceDescription')}
      </FlowyText>
      <VSpace size={16} />
      <div style={{ width: 56, height: 56 }}>
        <SpaceIconPopup
          onIconChanged={(icon, color) => {
            values.current.icon = icon;
            values.current.iconColor = color;
          }}
        />
      </div>
      <VSpace size={8} />
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <FlowyText lineHeight={18} color="var(--th-hint)">
          {tr('space.spaceName')}
        </FlowyText>
        <VSpace size={6} />
        <div style={{ height: 40 }}>
          <FlowyTextField
            hintText={tr('space.spaceNamePlaceholder')}
            enableBorderColor={border}
            onChanged={(value) => (values.current.name = value)}
            onSubmitted={(value) => {
              values.current.name = value;
              create();
            }}
          />
        </div>
      </div>
      <VSpace size={20} />
      <SpacePermissionSwitch onPermissionChanged={(value) => (values.current.permission = value)} />
      <VSpace size={20} />
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
    <div style={{ padding: '16px 24px', width: 500, maxWidth: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <FlowyText fontSize={18}>{tr('space.manage')}</FlowyText>
      <VSpace size={16} />
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <FlowyText color="var(--th-hint)">{tr('space.spaceName')}</FlowyText>
        <VSpace size={8} />
        <div style={{ height: 40, display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 40, height: 40, flexShrink: 0 }}>
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
          <div style={{ width: 12, flexShrink: 0 }} />
          <div style={{ flex: 1, height: 40 }}>
            <FlowyTextField defaultValue={space?.name} onChanged={(value) => (values.current.name = value)} />
          </div>
        </div>
      </div>
      <VSpace size={16} />
      <SpacePermissionSwitch
        spacePermission={space ? spacePermission(space) : undefined}
        onPermissionChanged={(value) => (values.current.permission = value)}
      />
      <VSpace size={16} />
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

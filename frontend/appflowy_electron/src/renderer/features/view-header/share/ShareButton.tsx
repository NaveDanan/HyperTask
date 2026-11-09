import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FolderEventGetView } from '@/backend/events';
import { useTr } from '@/i18n';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { useBrightness } from '@/theme/appearance-store';
import { AFButton, AFDivider, FlowyButton, FlowyHover, FlowySvg, FlowyText, Popover, Tooltip, showToast, type PopoverController } from '@/ui';
import { layoutIcon } from '../../tabs/plugin';
import { FlowyTextField } from '../FlowyTextField';
import { ShareAccessLevel } from '../page-access-level-store';
import { usePageAccessLevel } from '../view-scope';
import {
  buildNamespaceUrl,
  buildShareUrl,
  createShareStore,
  isDatabaseView,
  type ShareStore,
} from './share-store';
import { generatePublishName } from './publish-name';

type ShareMenuTab = 'share' | 'publish' | 'exportAs';

/** String.toFileName (util/string_extension.dart). */
const toFileName = (name: string) => name.replace(/[\\/:*?"<>| ]/g, '_');

const borderColor = (light: boolean) => (light ? '#14171B1E' : 'rgba(255,255,255,0.1)');

/** PrimaryRoundedButton (flowy_infra_ui/lib/style_widget/primary_rounded_button.dart). */
function PrimaryRoundedButton({
  text,
  onTap,
  margin = '0 14px',
  leftIcon,
  fullWidth,
}: {
  text: string;
  onTap: () => void;
  margin?: CSSProperties['padding'];
  leftIcon?: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <FlowyButton
      useIntrinsicWidth={!fullWidth}
      leftIcon={leftIcon}
      margin={margin}
      radius={10}
      backgroundColor="var(--cs-primary)"
      hoverColor="color-mix(in srgb, var(--cs-primary) 90%, transparent)"
      onTap={onTap}
      style={{ justifyContent: 'center' }}
      text={
        <FlowyText fontSize={14} fontWeight={500} lineHeight={18} color="var(--cs-on-primary)" textAlign="center" ellipsis style={{ flex: 1 }}>
          {text}
        </FlowyText>
      }
    />
  );
}

/** ShareButton (plugins/shared/share/share_button.dart) + ShareMenuButton (_shared.dart). */
export function ShareButton({ view }: { view: ViewPB }) {
  const { tr } = useTr();
  const [store] = useState(() => createShareStore(view));
  useEffect(() => store.start(), [store]);
  const state = useStore(store);
  const controller = useRef<PopoverController>(null);
  const tabs: ShareMenuTab[] = [...(state.enablePublish ? (['share', 'publish'] as const) : []), 'exportAs'];

  return (
    <Popover
      controllerRef={controller}
      trigger="none"
      direction="bottomWithCenterAligned"
      offset={{ x: -176, y: 12 }}
      windowPadding={8}
      onOpen={() => void store.updatePublishStatus()}
      containerStyle={{
        maxWidth: 460,
        background: 'var(--af-surface-layer01)',
        borderRadius: 8,
        boxShadow: 'var(--af-shadow-medium)',
        padding: '12px 8px',
        color: 'var(--af-text-primary)',
      }}
      popup={() => <ShareMenu key={tabs.join()} tabs={tabs} store={store} />}
    >
      <AFButton variant="filledPrimary" size="m" text={tr('shareAction.buttonText')} onTap={() => controller.current?.show()} />
    </Popover>
  );
}

function Segment({ tab, isSelected, isPublished }: { tab: ShareMenuTab; isSelected: boolean; isPublished: boolean }) {
  const { tr } = useTr();
  const [hover, setHover] = useState(false);
  const label = tab === 'share' ? tr('shareAction.shareTab') : tab === 'publish' ? tr('shareAction.publishTab') : tr('shareAction.exportAsTab');
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        fontSize: 'calc(14px * var(--text-scale, 1))',
        lineHeight: '20px',
        fontWeight: 500,
        color: isSelected || hover ? 'var(--af-text-primary)' : 'var(--af-text-secondary)',
        whiteSpace: 'nowrap',
      }}
    >
      {tab === 'publish' && isPublished && (
        <>
          <FlowySvg svg="published_checkmark_s" blendMode={null} />
          <div style={{ width: 6 }} />
        </>
      )}
      {label}
    </div>
  );
}

/** ShareMenu (plugins/shared/share/share_menu.dart). */
function ShareMenu({ tabs, store }: { tabs: ShareMenuTab[]; store: ShareStore }) {
  const [selected, setSelected] = useState<ShareMenuTab>(tabs[0]);
  const isPublished = useStore(store, (s) => s.isPublished);
  if (tabs.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 4 }} />
      <div style={{ height: 28, display: 'flex', alignItems: 'flex-end' }}>
        {tabs.map((tab) => (
          <div
            key={tab}
            onMouseDown={() => setSelected(tab)}
            style={{ position: 'relative', padding: '0 16px 6px', cursor: 'pointer', display: 'flex', justifyContent: 'center' }}
          >
            <Segment tab={tab} isSelected={selected === tab} isPublished={isPublished} />
            {selected === tab && (
              <div
                style={{
                  position: 'absolute',
                  bottom: -1,
                  width: 68,
                  maxWidth: '100%',
                  height: 3,
                  borderRadius: 2,
                  background: 'var(--cs-primary)',
                }}
              />
            )}
          </div>
        ))}
      </div>
      <AFDivider />
      <div style={{ padding: '0 8px' }}>
        {selected === 'publish' ? <PublishTab store={store} /> : selected === 'exportAs' ? <ExportTab store={store} /> : <ShareTab store={store} />}
      </div>
    </div>
  );
}

// ---- Export tab (plugins/shared/share/export_tab.dart) ------------------------------------

function ExportButton({ title, svg, onTap }: { title: string; svg: FlowySvgName; onTap: () => void }) {
  const light = useBrightness() === 'light';
  return (
    <FlowyButton
      margin="10px 14px"
      iconPadding={12}
      radius={10}
      borderColor={borderColor(light)}
      leftIcon={<FlowySvg svg={svg} />}
      text={<FlowyText lineHeight={16}>{title}</FlowyText>}
      onTap={onTap}
    />
  );
}

function ExportTab({ store }: { store: ShareStore }) {
  const { tr } = useTr();
  const view = store.view;

  // Document export needs the editor's document → HTML / Markdown encoders (document milestone).
  const unsupported = () => showToast({ message: `${tr('settings.files.exportFileFail')}: Unimplemented` });

  const exportCSV = async () => {
    const path = await window.appflowy.dialog.saveFile({ title: '', defaultPath: `${toFileName(store.getState().viewName)}.csv` });
    if (path) await store.exportCSV(path);
  };

  if (view.layout === ViewLayoutPB.Document) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 10 }} />
        <ExportButton title={tr('shareAction.html')} svg="export_html_s" onTap={unsupported} />
        <div style={{ height: 10 }} />
        <ExportButton title={tr('shareAction.markdown')} svg="export_markdown_s" onTap={unsupported} />
        <div style={{ height: 10 }} />
        <ExportButton title={tr('shareAction.clipboard')} svg="duplicate_s" onTap={unsupported} />
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 10 }} />
      <ExportButton title={tr('shareAction.csv')} svg="database_layout_s" onTap={() => void exportCSV()} />
    </div>
  );
}

// ---- Share tab (plugins/shared/share/share_tab.dart, FeatureFlag.sharedSection off) -------

function ShareTab({ store }: { store: ShareStore }) {
  const { tr } = useTr();
  const { workspaceId, viewId } = useStore(store);
  const [url, setUrl] = useState('');
  useEffect(() => {
    void buildShareUrl(workspaceId, viewId).then(setUrl);
  }, [workspaceId, viewId]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 18 }} />
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <FlowySvg svg="share_tab_icon_s" />
        <div style={{ width: 6 }} />
        <FlowyText.medium lineHeight={18}>{tr('shareAction.shareTabTitle')}</FlowyText.medium>
      </div>
      <div style={{ height: 2 }} />
      <div style={{ padding: '0 2px' }}>
        <FlowyText.regular fontSize={13} lineHeight={18} color="var(--th-hint)">
          {tr('shareAction.shareTabDescription')}
        </FlowyText.regular>
      </div>
      <div style={{ height: 14 }} />
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <FlowyTextField value={url} readOnly borderRadius={10} height={36} style={{ flex: 1 }} />
        <div style={{ width: 8 }} />
        <PrimaryRoundedButton
          margin="9px 14px"
          text={tr('button.copyLink')}
          leftIcon={<FlowySvg svg="share_tab_copy_s" color="var(--cs-on-primary)" />}
          onTap={() => {
            window.appflowy.clipboard.writeText(url);
            showToast({ message: tr('message.copy.success') });
          }}
        />
      </div>
    </div>
  );
}

// ---- Publish tab (plugins/shared/share/publish_tab.dart) ----------------------------------

function PublishTabHeader() {
  const { tr } = useTr();
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <FlowySvg svg="share_publish_s" />
        <div style={{ width: 6 }} />
        <FlowyText>{tr('shareAction.publishToTheWeb')}</FlowyText>
      </div>
      <div style={{ height: 4 }} />
      <FlowyText.regular fontSize={12} maxLines={3} color="var(--th-hint)">
        {tr('shareAction.publishToTheWebHint')}
      </FlowyText.regular>
    </div>
  );
}

function PublishTab({ store }: { store: ShareStore }) {
  const state = useStore(store);
  return state.isPublished ? <PublishedWidget store={store} /> : <PublishWidget store={store} />;
}

function PublishedWidget({ store }: { store: ShareStore }) {
  const { tr } = useTr();
  const light = useBrightness() === 'light';
  const { namespace, pathName } = useStore(store);
  const [text, setText] = useState(pathName);
  const [focused, setFocused] = useState(false);
  const [prefix, setPrefix] = useState('');
  useEffect(() => setText(pathName), [pathName]);
  useEffect(() => {
    void buildNamespaceUrl(`${namespace}/`).then(setPrefix);
  }, [namespace]);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 16 }} />
      <PublishTabHeader />
      <div style={{ height: 16 }} />
      <FlowyTextField
        ref={inputRef}
        value={text}
        height={36}
        enableBorderColor={borderColor(light)}
        onChange={setText}
        onFocusChange={(f) => setTimeout(() => setFocused(f), 0)}
        prefix={
          <div style={{ display: 'flex', alignItems: 'center', maxWidth: 230, flexShrink: 0 }}>
            <div style={{ width: 8 }} />
            <FlowyText.regular fontSize={14} lineHeight={18} ellipsis>
              {prefix}
            </FlowyText.regular>
            <div style={{ width: 6 }} />
            <div style={{ width: 1, height: 16, background: 'var(--th-divider)' }} />
            <div style={{ width: 6 }} />
          </div>
        }
        suffix={
          focused ? (
            <div style={{ padding: 6 }} onMouseDown={(e) => e.preventDefault()}>
              <FlowyButton
                useIntrinsicWidth
                text={<FlowyText.regular lineHeight={18}>{tr('button.save')}</FlowyText.regular>}
                onTap={() => {
                  void store.updatePathName(text);
                  inputRef.current?.blur();
                }}
              />
            </div>
          ) : (
            <FlowyHover
              style={{ margin: 4, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid #1F232914' }}
              onClick={() => {
                window.appflowy.clipboard.writeText(store.getState().url);
                showToast({ message: tr('message.copy.success') });
              }}
            >
              <FlowySvg svg="m_toolbar_link_m" size={20} />
            </FlowyHover>
          )
        }
      />
      <div style={{ height: 16 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <div style={{ width: 108, height: 36, display: 'flex' }}>
          <FlowyButton
            radius={10}
            borderColor={borderColor(light)}
            style={{ width: '100%', justifyContent: 'center' }}
            text={
              <FlowyText.regular textAlign="center" style={{ flex: 1 }}>
                {tr('shareAction.unPublish')}
              </FlowyText.regular>
            }
            onTap={() => void store.unpublish()}
          />
        </div>
        <div style={{ width: 6 }} />
        <button
          className="af-button"
          onClick={() => {
            // afLaunchUrlString: vendor domains are refused by the main process.
            void window.appflowy.shell.openExternal(store.getState().url).catch(() => {});
          }}
          style={
            {
              width: 108,
              height: 36,
              '--btn-radius': '10px',
              '--btn-bg': 'var(--cs-primary)',
              '--btn-bg-hover': 'color-mix(in srgb, var(--cs-primary) 90%, transparent)',
              '--btn-fg': 'var(--cs-on-primary)',
              fontWeight: 400,
            } as CSSProperties
          }
        >
          {tr('shareAction.visitSite')}
        </button>
      </div>
    </div>
  );
}

function PublishWidget({ store }: { store: ShareStore }) {
  const { tr } = useTr();
  const access = usePageAccessLevel();
  const view = store.view;
  const selectedRef = useRef<ViewPB[]>([]);

  const onPublish = () => {
    if (isDatabaseView(view) && selectedRef.current.length === 0) {
      showToast({ message: tr('publish.noDatabaseSelected') });
      return;
    }
    const { pathName, viewName } = store.getState();
    const publishName = pathName || generatePublishName(view.id, viewName);
    void store.publish(publishName, selectedRef.current.map((v) => v.id));
  };

  let button: ReactNode = <PrimaryRoundedButton fullWidth text={tr('shareAction.publish')} margin="9px 0" onTap={onPublish} />;
  if (access?.accessLevel === ShareAccessLevel.readOnly) {
    button = (
      <Tooltip message="You are a readonly user, you can't publish a page.">
        <div style={{ pointerEvents: 'none' }}>{button}</div>
      </Tooltip>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 16 }} />
      <PublishTabHeader />
      <div style={{ height: 16 }} />
      {isDatabaseView(view) && (
        <>
          <PublishDatabaseSelector view={view} onSelected={(views) => (selectedRef.current = views)} />
          <div style={{ height: 16 }} />
        </>
      )}
      {button}
    </div>
  );
}

/** _PublishDatabaseSelector: the database and its linked views (DatabaseTabBarBloc tab bars). */
function PublishDatabaseSelector({ view, onSelected }: { view: ViewPB; onSelected: (views: ViewPB[]) => void }) {
  const { plural, tr } = useTr();
  const [status, setStatus] = useState<Array<[ViewPB, boolean]>>([]);
  useEffect(() => {
    void FolderEventGetView({ value: view.id }).then((result) => {
      const children = result.ok ? result.value.childViews.filter((c) => isDatabaseView(c)) : [];
      const next: Array<[ViewPB, boolean]> = [view, ...children].map((v) => [v, true]);
      setStatus(next);
      onSelected(next.map(([v]) => v));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const border = 'color-mix(in srgb, var(--th-hint) 30%, transparent)';
  const count = status.filter(([, s]) => s).length;
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 10 }} />
      <div style={{ padding: '0 12px' }}>
        <FlowyText fontSize={13} color="var(--th-hint)">
          {plural('publish.database', count)}
        </FlowyText>
      </div>
      <div style={{ height: 10 }} />
      <div style={{ margin: '0 12px', height: 1, background: border }} />
      <div style={{ height: 10 }} />
      {status.map(([tab, selected]) => {
        const isPrimary = tab.id === view.id;
        const item = (
          <div style={{ height: 30, padding: '0 8px', display: 'flex', alignItems: 'center' }}>
            <FlowySvg
              svg={isPrimary ? 'unable_select_s' : selected ? 'check_filled_s' : 'uncheck_s'}
              size={18}
              blendMode={isPrimary ? 'srcIn' : null}
            />
            <div style={{ width: 9 }} />
            <FlowySvg svg={layoutIcon(tab.layout)} size={16} />
            <div style={{ width: 6 }} />
            <FlowyText.regular fontSize={14} ellipsis>
              {tab.name}
            </FlowyText.regular>
          </div>
        );
        return (
          <div key={tab.id} style={{ padding: '2px 4px' }}>
            {isPrimary ? (
              <Tooltip message={tr('publish.mustSelectPrimaryDatabase')}>
                <div style={{ cursor: 'not-allowed' }}>{item}</div>
              </Tooltip>
            ) : (
              <FlowyHover
                onClick={() => {
                  const next = status.map(([v, s]): [ViewPB, boolean] => (v.id === tab.id ? [v, !s] : [v, s]));
                  setStatus(next);
                  onSelected(next.filter(([, s]) => s).map(([v]) => v));
                }}
              >
                {item}
              </FlowyHover>
            )}
          </div>
        );
      })}
    </div>
  );
}

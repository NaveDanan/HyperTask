import { useEffect, useState, type ReactNode } from 'react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { FlowySvg, FlowyText } from '@/ui';
import { layoutIcon } from '../tabs/plugin';
import { nameOrDefault } from '../view/view-ext';
import { RawEmojiIcon, viewIcon } from '../view-header/ViewIcon';
import { useViewPluginNotifier, useViewScope } from '../view-header/view-scope';
import { DocumentBanner, deletePermanently, restorePage } from './DocumentBanner';
import type { PluginContext } from './registry';

export const PLACEHOLDER_LINE = 'This page type opens in a later milestone of the Electron port.';

/** A centered "later milestone" message with the page's icon and name. */
export function PlaceholderMessage({ icon, name }: { icon: ReactNode; name: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
          {icon}
          <FlowyText.semibold fontSize={18} ellipsis>
            {name}
          </FlowyText.semibold>
        </div>
        <FlowyText.regular color="var(--th-hint)" maxLines={null} textAlign="center">
          {PLACEHOLDER_LINE}
        </FlowyText.regular>
      </div>
    </div>
  );
}

/**
 * Body of the Document / Grid / Board / Calendar / Chat plugins until their pages land. It keeps
 * the plugins' delete handling: documents show the "in Trash" banner (restore / delete
 * permanently → onDeleted), databases close as soon as a trash notification carries an index.
 */
export function ViewPlaceholderPage({ view, context }: { view: ViewPB; context: PluginContext }) {
  const notifier = useViewPluginNotifier();
  const scope = useViewScope();
  const current = notifier?.view ?? view;
  const deleted = notifier?.isDeleted ?? null;
  const [bannerHidden, setBannerHidden] = useState(false);
  const isDatabase = view.layout === ViewLayoutPB.Grid || view.layout === ViewLayoutPB.Board || view.layout === ViewLayoutPB.Calendar;

  // DocumentBloc.moveToTrash: a new trash notification shows the banner again.
  useEffect(() => setBannerHidden(false), [deleted]);

  // DatabaseTabBarViewPlugin: closes immediately when the deleted view has an index.
  useEffect(() => {
    if (isDatabase && deleted && deleted.oneOfIndex.case === 'index') context.onDeleted?.(current, deleted.oneOfIndex.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleted, isDatabase]);

  // AIChatPage renders nothing without a user profile (e.g. in the secondary view).
  if (view.layout === ViewLayoutPB.Chat && !context.userProfile) return null;

  const icon = viewIcon(current);
  const showBanner = view.layout === ViewLayoutPB.Document && deleted !== null && !bannerHidden;
  const deletedIndex = deleted?.oneOfIndex.case === 'index' ? deleted.oneOfIndex.value : undefined;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {showBanner && (
        <DocumentBanner
          viewName={nameOrDefault(view)}
          onRestore={() =>
            void restorePage(view).then((ok) => {
              if (ok) {
                setBannerHidden(true);
                scope?.notifier.setState({ isDeleted: null });
              }
            })
          }
          onDelete={() =>
            void deletePermanently(view).then((ok) => {
              if (ok) context.onDeleted?.(current, deletedIndex);
            })
          }
        />
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <PlaceholderMessage
          icon={icon ? <RawEmojiIcon icon={icon} size={24} /> : <FlowySvg svg={layoutIcon(current.layout)} size={24} />}
          name={nameOrDefault(current)}
        />
      </div>
    </div>
  );
}

/** BlankPage (plugins/blank/blank.dart): an empty surface. */
export function BlankPage() {
  return <div style={{ height: '100%', background: 'var(--cs-surface)', padding: 10, boxSizing: 'border-box' }} />;
}

/** The Jira / Templates local tools until their pages land. */
export function LocalToolPlaceholder({ title }: { title: string }) {
  return <PlaceholderMessage icon={null} name={title} />;
}

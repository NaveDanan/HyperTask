// MovePageMenu (menu/sidebar/move_to/move_page_menu.dart): pick a space root or a document in
// the (switchable) current space, or search all pages. Uses its own SpaceBloc, like the row's
// fresh SpaceBloc in Flutter.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import { Tooltip, VSpace } from '@/ui';
import { isSpace } from '@/features/view/view-ext';
import { ViewBackendService } from '@/features/view/view-service';
import { createSpaceStore, sidebarSpace } from '../stores/space-store';
import { SpaceStoreContext } from '../space/space-context';
import { CurrentSpace, SpacePages, SpacePopup, SpaceSearchField } from '../space/SpaceWidgets';
import { ViewItem } from './ViewItem';

export function MovePageMenu({ sourceView, onSelected }: { sourceView: ViewPB; onSelected: (space: ViewPB, view: ViewPB) => void }) {
  const { tr } = useTr();
  const [bloc] = useState(() => createSpaceStore());
  const space = useStore(bloc.store, (s) => s.currentSpace);
  const [allViews, setAllViews] = useState<ViewPB[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const user = sidebarSpace.actions.userProfile;
    if (user) void bloc.actions.initial(user, sidebarSpace.actions.workspaceId, false);
    // SpaceSearchBloc.initial
    void ViewBackendService.getAllViews().then((result) => setAllViews(result.ok ? result.value.items : []));
    return () => bloc.actions.dispose();
  }, [bloc]);

  const queryResults = useMemo(
    () => (query ? allViews.filter((v) => v.name.toLowerCase().includes(query.toLowerCase())) : null),
    [allViews, query],
  );

  if (!space) return null;
  return (
    <SpaceStoreContext.Provider value={bloc}>
      <div style={{ height: 321, display: 'flex', flexDirection: 'column' }}>
        <SpaceSearchField width={240} onSearch={setQuery} />
        <VSpace size={10} />
        {queryResults === null ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <SpacePopup useIntrinsicWidth={false} height={30} showCreateButton={false}>
              <Tooltip message={tr('space.switchSpace')}>
                <div style={{ display: 'flex', width: '100%' }}>
                  <CurrentSpace space={space} onTapBlankArea={() => onSelected(space, space)} />
                </div>
              </Tooltip>
            </SpacePopup>
            <div className="sb-scroll" style={{ flex: 1, minHeight: 0 }}>
              <SpacePages
                key={space.id}
                space={space}
                hoverGated={false}
                disableSelectedStatus
                rightIconsBuilder={() => null}
                shouldIgnoreView={(view) => {
                  if (view.id === sourceView.id) return 'hide';
                  if (view.layout !== ViewLayoutPB.Document) return 'disable';
                  return 'none';
                }}
                onSelected={(view) => onSelected(space, view)}
              />
            </div>
          </div>
        ) : (
          <div className="sb-scroll" style={{ flex: 1, minHeight: 0 }}>
            {queryResults
              .filter((v) => v.id !== sourceView.id && !isSpace(v))
              .map((view) => (
                <ViewItem
                  key={view.id}
                  view={view}
                  spaceType="unknown"
                  level={0}
                  isFeedback={false}
                  isDraggable={false}
                  shouldRenderChildren={false}
                  leftIconBuilder={() => null}
                  rightIconsBuilder={() => null}
                  onSelected={(v) => onSelected(space, v)}
                />
              ))}
          </div>
        )}
      </div>
    </SpaceStoreContext.Provider>
  );
}

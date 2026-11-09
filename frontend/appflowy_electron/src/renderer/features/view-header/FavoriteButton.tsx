import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import { FlowyHover, FlowySvg, Tooltip } from '@/ui';
import { toggleFavorite, useIsFavorite } from './favorite-store';

/** ViewFavoriteButton (workspace/presentation/widgets/favorite_button.dart). */
export function ViewFavoriteButton({ view }: { view: ViewPB }) {
  const { tr } = useTr();
  const isFavorite = useIsFavorite(view.id);
  return (
    <div style={{ display: 'flex', flexShrink: 0 }} onMouseDown={() => void toggleFavorite(view)}>
      <Tooltip message={isFavorite ? tr('button.removeFromFavorites') : tr('button.addToFavorites')}>
        <FlowyHover style={{ padding: 6, display: 'flex' }}>
          <FlowySvg svg={isFavorite ? 'favorited_s' : 'favorite_s'} size={18} blendMode={isFavorite ? null : 'srcIn'} />
        </FlowyHover>
      </Tooltip>
    </div>
  );
}

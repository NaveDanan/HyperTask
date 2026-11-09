import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { useTr } from '@/i18n';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/ui';
import { toggleFavorite, useIsFavorite } from './favorite-store';

/** ViewFavoriteButton (workspace/presentation/widgets/favorite_button.dart). */
export function ViewFavoriteButton({ view }: { view: ViewPB }) {
  const { tr } = useTr();
  const isFavorite = useIsFavorite(view.id);
  return (
    <Tooltip message={isFavorite ? tr('button.removeFromFavorites') : tr('button.addToFavorites')}>
      <Button variant="ghost" size="icon-sm" aria-label={isFavorite ? tr('button.removeFromFavorites') : tr('button.addToFavorites')} onMouseDown={() => void toggleFavorite(view)}>
        <Star className={cn('size-4', isFavorite && 'fill-amber-400 text-amber-400')} />
      </Button>
    </Tooltip>
  );
}

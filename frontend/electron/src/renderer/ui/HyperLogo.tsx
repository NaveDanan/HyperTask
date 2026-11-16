import logoSvg from '@resources/hypertask-logo.svg?raw';
import { cn } from '@/lib/utils';

// The master SVG, recoloured to follow the text color (black in light mode, white in dark).
const MARK = logoSvg.replace(/fill="#[0-9A-Fa-f]{3,8}"/g, 'fill="currentColor"');

/** HyperTask mark, with an optional wordmark for app chrome. */
export function HyperLogo({ size = 36, wordmark = false, className }: { size?: number; wordmark?: boolean; className?: string }) {
  return (
    <span aria-label="HyperTask" className={cn('inline-flex items-center gap-2 whitespace-nowrap text-foreground', className)}>
      <span aria-hidden className="inline-block shrink-0 [&>svg]:block [&>svg]:size-full" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: MARK }} />
      {wordmark && <span className="text-sm font-semibold tracking-tight">HyperTask</span>}
    </span>
  );
}

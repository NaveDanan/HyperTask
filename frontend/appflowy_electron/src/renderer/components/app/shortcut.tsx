import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

const isMac = navigator.userAgent.includes('Mac');

const GLYPH: Record<string, string> = isMac
  ? { cmd: '⌘', ctrl: '⌃', alt: '⌥', option: '⌥', shift: '⇧', enter: '↵', meta: '⌘' }
  : { cmd: 'Ctrl', meta: 'Win', enter: 'Enter' };

/** Renders "Ctrl+Shift+P" / "⌘+P" as a group of <Kbd> caps. */
export function ShortcutKeys({ keys, className }: { keys: string; className?: string }) {
  const parts = keys
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    <KbdGroup className={cn('gap-0.5', className)}>
      {parts.map((part, index) => (
        <Kbd key={index} className="h-4.5 min-w-4.5 px-1 text-2xs">
          {GLYPH[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part)}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

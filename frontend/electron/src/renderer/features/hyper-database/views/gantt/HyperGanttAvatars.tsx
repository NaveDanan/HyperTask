import { Avatar, AvatarFallback } from '@/components/ui/avatar';
export function HyperGanttAvatars({ names }: { names: string[] }) {
  if (!names.length) return <span className="text-muted-foreground">—</span>;
  return <div
    className="flex items-center -space-x-1"
    aria-label={names.join(', ')}
    title={names.join(', ')}
  >
    {names.slice(0, 2).map((name, index) => <Avatar key={`${name}-${index}`} className="size-5 ring-1 ring-background">
      <AvatarFallback className="text-2xs font-medium">{name.split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase()}</AvatarFallback>
    </Avatar>)}
    {names.length > 2 && <span className="pl-2 text-2xs text-muted-foreground">+{names.length - 2}</span>}
  </div>;
}

import { Eye, EyeOff, Mail, RefreshCw } from 'lucide-react';
import type { HyperOutlookStatus } from '@shared/api';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openSettings } from '@/features/home/notifiers';
export function HyperOutlookToolbar({ status, error, refreshing, shown, lastSyncedAt, onToggle, onRefresh }: { status: HyperOutlookStatus | null; error: string | null; refreshing: boolean; shown: boolean; lastSyncedAt: Date | null; onToggle: (value: boolean) => void; onRefresh: () => void }) {
  const loading = shown && refreshing && !lastSyncedAt && !error;
  const label = loading ? 'Loading Outlook…' : status?.available ? status.userName || status.email || 'Outlook' : status ? 'Outlook unavailable' : 'Connecting to Outlook';
  return <div className="flex h-8 shrink-0 items-center gap-0.5 border-r pr-1.5">
    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="sm" aria-label="Manage Outlook connection" className="h-7 max-w-36 bg-muted/60 px-2 text-xs text-muted-foreground" onClick={() => openSettings.emit('connections/outlook')} />}><Mail className="size-3.5 shrink-0" /><span className="hidden truncate xl:inline">{label}</span></TooltipTrigger><TooltipContent>{error || status?.reason || status?.email || label}</TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Show Outlook" aria-pressed={shown} onClick={() => onToggle(!shown)} />}>{shown ? <Eye className="size-4" /> : <EyeOff className="size-4" />}</TooltipTrigger><TooltipContent>{shown ? 'Hide Outlook events' : 'Show Outlook events'}</TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Refresh Outlook" disabled={refreshing} onClick={onRefresh} />}><RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} /></TooltipTrigger><TooltipContent>Refresh Outlook{lastSyncedAt ? ` · Last synced ${lastSyncedAt.toLocaleTimeString()}` : ''}</TooltipContent></Tooltip>
  </div>;
}

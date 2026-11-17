import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useHyperChromePanel } from '../home/HyperChromePanel';
import { hyperBotsWithDirectRooms, type HyperBotsDelivery, type HyperBotsSettings } from '@shared/HyperBots';
import { Button } from '@/components/ui/button';
import { HyperBotsController, hyperBotsOutbox, type HyperBotsOutbox, type HyperBotsViewState } from './HyperBotsController';
import { HyperBotSidebar } from './HyperBotSidebar';
import { HyperBotChat } from './HyperBotChat';
import { HyperBotDetails } from './HyperBotDetails';
import { HyperBotCreateDialog } from './HyperBotCreateDialog';
import { HyperBotGroupDialog } from './HyperBotGroupDialog';
import { HyperBotSettingsDialog } from './HyperBotSettingsDialog';
import { hyperBotStoredRoom, hyperBotRememberRoom } from './HyperBotSettings';
import './HyperBot.css';
export interface HyperBotActions {
  reload(): void;
  select(roomId: string): void;
  send(text: string, model: string | null): Promise<boolean>;
  decide(approvalId: string, approved: boolean, delivery?: HyperBotsDelivery): void;
  saveSettings(settings: HyperBotsSettings): Promise<boolean>;
}
let sessionDetailsOpen: boolean | undefined;
export function HyperBotScreen({ userId }: { userId: string }) {
  const [controller] = useState(() => new HyperBotsController(window.hypertask.hyperBots, hyperBotsOutbox(userId)));
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    let alive = true;
    setRestoring(true);
    const open = async () => {
      const preferred = hyperBotStoredRoom(userId);
      await controller.start(preferred);
      if (alive && preferred && !controller.getState().snapshot) await controller.start();
      if (!alive) return;
      const snapshot = controller.getState().snapshot;
      if (!snapshot) return;
      const settings = hyperBotsWithDirectRooms(snapshot.settings);
      const first = settings.rooms.find(room => room.kind === 'direct' && room.botIds[0] === settings.bots[0]?.id);
      const roomId = settings.rooms.find(room => room.id === preferred)?.id ?? first?.id;
      if (roomId) await controller.select(roomId);
    };
    void open().finally(() => { if (alive) setRestoring(false); }); return () => { alive = false; controller.dispose(); };
  }, [controller, userId]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  useEffect(() => { if (!restoring && state.snapshot && state.phase === 'ready') hyperBotRememberRoom(userId, state.snapshot.roomId); }, [userId, state.snapshot?.roomId, state.phase, restoring]);
  return <HyperBotsView state={restoring ? { ...state, snapshot: null, phase: 'opening' } : state} outbox={controller.outbox} actions={{ reload: () => void controller.reload(), select: id => void controller.select(id), send: (text, model) => controller.send(text, model), decide: (id, approved, delivery) => void controller.decide(id, approved, delivery), saveSettings: settings => controller.saveSettings(settings) }} />;
}
export function HyperBotsView({ state, outbox, actions }: { state: HyperBotsViewState; outbox: HyperBotsOutbox; actions: HyperBotActions }) {
  const root = useRef<HTMLDivElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(() => sessionDetailsOpen ?? (typeof window === 'undefined' || window.innerWidth >= 1100));
  const chromePanel = useHyperChromePanel(330, !!state.snapshot);
  const [modal, setModal] = useState<'create' | 'group' | 'settings' | null>(null);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => { if (sessionDetailsOpen === undefined) setDetailsOpen((entries[0]?.contentRect.width ?? 0) >= 1100); });
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const toggleDetails = (open: boolean) => { sessionDetailsOpen = open; setDetailsOpen(open); };
  const snapshot = state.snapshot;
  if (!snapshot) return <div data-hyper-bot className="hyper-bot-screen" ref={root}><div className="screen-status"><h1>Hyper-Bot</h1>{state.syncError ? <p role="alert">Bots could not be opened. {state.syncError}</p> : <p role="status"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />Opening Hyper-Bot…</p>}<Button variant="ghost" size="sm" disabled={state.phase === 'opening'} onClick={actions.reload}><RefreshCw />Refresh</Button></div></div>;
  const settings = snapshot.settings, room = settings.rooms.find(row => row.id === snapshot.roomId);
  const members = settings.bots.filter(bot => room?.botIds.includes(bot.id));
  const bot = room?.kind === 'direct' ? members[0] : undefined, name = bot?.name ?? room?.name ?? 'Hyper-Bot';
  const readyState = { ...state, snapshot };
  const sidebar = <HyperBotSidebar settings={settings} roomId={snapshot.roomId} summaries={state.summaries} connections={snapshot.connections} busy={state.saving} onSelect={id => { setModal(null); actions.select(id); }} onCreate={() => setModal('create')} onGroup={() => setModal('group')} />;
  return <div data-hyper-bot className="hyper-bot-screen app" ref={root}>
    {chromePanel ? createPortal(<div data-hyper-bot className="hb-chrome-panel">{sidebar}</div>, chromePanel) : sidebar}
    <HyperBotChat key={snapshot.roomId} state={readyState} outbox={outbox} actions={actions} bot={bot} name={name} members={members} detailsOpen={detailsOpen} onDetails={() => toggleDetails(!detailsOpen)} onSettings={() => setModal('settings')} onGroup={() => setModal('group')} />
    {detailsOpen && <><button type="button" className="details-scrim" aria-label="Dismiss details" onClick={() => toggleDetails(false)} /><HyperBotDetails key={snapshot.roomId} state={readyState} actions={actions} bot={bot} name={name} members={members} onClose={() => toggleDetails(false)} onSettings={() => setModal('settings')} /></>}
    {modal === 'create' && <HyperBotCreateDialog settings={settings} onSave={actions.saveSettings} onSelect={actions.select} onClose={() => setModal(null)} onGroup={() => setModal('group')} error={state.settingsError} />}
    {modal === 'group' && <HyperBotGroupDialog settings={settings} onSave={actions.saveSettings} onSelect={actions.select} onClose={() => setModal(null)} error={state.settingsError} />}
    {modal === 'settings' && room && <HyperBotSettingsDialog key={room.id} settings={settings} bot={bot} room={room} onSave={actions.saveSettings} onClose={() => setModal(null)} error={state.settingsError} />}
  </div>;
}

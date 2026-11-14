import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { HYPER_OPENBOT_SERVICE_ACTIONS, type HyperOpenBotServiceAction } from '@shared/HyperOpenBotService';
import type { HyperOpenBotService } from './HyperOpenBotService';
export function registerHyperOpenBotServiceIpc(window: () => BrowserWindow | null, service: HyperOpenBotService) {
  const trusted = (event: IpcMainInvokeEvent) => event.sender === window()?.webContents && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle('hyper-openbot:service-state', event => { if (!trusted(event)) throw new Error('Untrusted AI service caller'); return service.snapshot(); });
  ipcMain.handle('hyper-openbot:service-action', (event, action: unknown) => {
    if (!trusted(event) || typeof action !== 'string' || !(HYPER_OPENBOT_SERVICE_ACTIONS as readonly string[]).includes(action)) throw new Error('AI service action refused');
    return service.run(action as HyperOpenBotServiceAction);
  });
  ipcMain.handle('hyper-openbot:service-configure', (event, autoStart: unknown) => {
    if (!trusted(event) || typeof autoStart !== 'boolean') throw new Error('AI service configuration refused');
    return service.configure(autoStart);
  });
  service.subscribe(state => { const view = window()?.webContents; if (view && !view.isDestroyed()) view.send('hyper-openbot:service-changed', state); });
  // A desktop exit closes only its connections. The explicit Stop control owns backend shutdown.
  app.once('before-quit', () => service.invalidate());
}

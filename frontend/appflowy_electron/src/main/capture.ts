import fs from 'node:fs/promises';
import { app, type BrowserWindow } from 'electron';

/**
 * Development aid: with APPFLOWY_CAPTURE=<file.png>, saves a screenshot of the window
 * after APPFLOWY_CAPTURE_DELAY ms (default 8000) and quits. Used to compare screens
 * with the Flutter app without manual clicking.
 */
export function scheduleCapture(window: BrowserWindow): void {
  const target = process.env.APPFLOWY_CAPTURE;
  if (!target || app.isPackaged) return;
  const delay = Number(process.env.APPFLOWY_CAPTURE_DELAY ?? 8000);
  setTimeout(async () => {
    try {
      const image = await window.webContents.capturePage();
      await fs.writeFile(target, image.toPNG());
      console.log(`[capture] saved ${target}`);
    } catch (error) {
      console.error('[capture] failed', error);
    }
    app.quit();
  }, delay);
}

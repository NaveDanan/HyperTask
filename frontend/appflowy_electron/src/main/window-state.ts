import { screen, type BrowserWindow, type Rectangle } from 'electron';
import type { SharedPreferences } from './prefs';

// The keys and JSON shapes the Flutter app's WindowSizeManager stores.
const SIZE_KEY = 'windowSize';
const POSITION_KEY = 'windowPosition';
const MAXIMIZED_KEY = 'windowMaximized';

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 960;
const MIN_SIZE = 640;
const MAX_SIZE = 8192;

const clampSize = (value: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)));

function parse<T>(value: unknown): T | null {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function restoreWindowBounds(
  prefs: SharedPreferences,
): Promise<{ rect: Partial<Rectangle>; maximized: boolean }> {
  const size = parse<{ width: number; height: number }>(await prefs.get(SIZE_KEY));
  const position = parse<{ dx: number; dy: number }>(await prefs.get(POSITION_KEY));
  const maximized = (await prefs.get(MAXIMIZED_KEY)) === 'true';

  const rect: Partial<Rectangle> = {
    width: clampSize(size?.width ?? DEFAULT_WIDTH),
    height: clampSize(size?.height ?? DEFAULT_HEIGHT),
  };
  if (position) {
    const candidate = { x: Math.round(position.dx), y: Math.round(position.dy), width: rect.width!, height: rect.height! };
    // Only restore a position that is still on a connected display.
    const visible = screen.getAllDisplays().some(({ workArea }) =>
      candidate.x < workArea.x + workArea.width &&
      candidate.x + candidate.width > workArea.x &&
      candidate.y < workArea.y + workArea.height &&
      candidate.y + candidate.height > workArea.y,
    );
    if (visible) Object.assign(rect, { x: candidate.x, y: candidate.y });
  }
  return { rect, maximized };
}

export function trackWindowBounds(window: BrowserWindow, prefs: SharedPreferences): void {
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (window.isDestroyed() || window.isMaximized() || window.isMinimized() || window.isFullScreen()) return;
      const { x, y, width, height } = window.getBounds();
      void prefs.set(SIZE_KEY, JSON.stringify({ height: clampSize(height), width: clampSize(width) }));
      void prefs.set(POSITION_KEY, JSON.stringify({ dx: x, dy: y }));
    }, 300);
  };
  // Maximize and full screen store windowMaximized=true and position {0,0}; leaving them
  // stores false and the restored position, as the Flutter WindowSizeManager does.
  const maximized = () => {
    void prefs.set(MAXIMIZED_KEY, 'true');
    void prefs.set(POSITION_KEY, JSON.stringify({ dx: 0, dy: 0 }));
  };
  const restored = () => {
    void prefs.set(MAXIMIZED_KEY, 'false');
    save();
  };
  window.on('resize', save);
  window.on('move', save);
  window.on('maximize', maximized);
  window.on('enter-full-screen', maximized);
  window.on('unmaximize', restored);
  window.on('leave-full-screen', restored);
}

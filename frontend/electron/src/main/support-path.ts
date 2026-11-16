import path from 'node:path';

/** Keep an existing Flutter workspace accessible after the desktop rename. */
export function supportPath(platform: NodeJS.Platform, appData: string, home: string, exists: (file: string) => boolean): string {
  const current = platform === 'win32'
    ? path.join(appData, 'io.hypertask', 'Hypertask')
    : platform === 'darwin'
      ? path.join(appData, 'io.hypertask.hypertask')
      : path.join(home, '.local', 'share', 'io.hypertask.hypertask');
  const legacy = platform === 'win32'
    ? path.join(appData, 'io.appflowy', 'AppFlowy')
    : platform === 'darwin'
      ? path.join(appData, 'io.appflowy.appflowy')
      : path.join(home, '.local', 'share', 'io.appflowy.appflowy');
  return !exists(current) && exists(legacy) ? legacy : current;
}

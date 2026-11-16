import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { supportPath } from './support-path';

describe('supportPath', () => {
  const appData = path.join('root', 'roaming');
  const home = path.join('root', 'home');
  const current = path.join(appData, 'io.hypertask', 'Hypertask');
  const legacy = path.join(appData, 'io.appflowy', 'AppFlowy');
  it('uses the existing legacy workspace when no current workspace exists', () => {
    expect(supportPath('win32', appData, home, p => p === legacy)).toBe(legacy);
  });
  it('keeps the current workspace when both exist', () => {
    expect(supportPath('win32', appData, home, p => p === legacy || p === current)).toBe(current);
  });
  it('uses the current location for a new workspace', () => {
    expect(supportPath('win32', appData, home, () => false)).toBe(current);
  });
});

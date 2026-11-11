import { describe, expect, it, vi } from 'vitest';
import { hyperInstallYouTubeClient, hyperYouTubeClientHeaders } from './HyperYouTubeClient';
import { hyperBindDesktopIdentity } from './HyperDesktopIdentity';
import { HYPER_DESKTOP_APP_ID, HYPER_DESKTOP_FILE, HYPER_YOUTUBE_APP_REFERRER } from '../shared/HyperDesktopIdentity';
function fixture() {
  const main = { frameTreeNodeId: 1, url: 'file:///private/app/index.html', parent: null, isDestroyed: () => false };
  const frame = { frameTreeNodeId: 2, url: 'about:blank', parent: main, isDestroyed: () => false };
  const owner = { webContentsId: 4, mainFrame: main, rendererURL: main.url, isDestroyed: () => false };
  const request = { url: 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE', resourceType: 'subFrame', method: 'GET', webContentsId: 4, frame, requestHeaders: { Accept: 'text/html', 'User-Agent': 'native', referer: 'file:///private/app/index.html' } };
  return { main, frame, owner, request };
}
describe('Hyper owned desktop/player identity', () => {
  it('binds OS desktop IDs without changing names, data paths, startup preferences or protocols', () => {
    const app = { setDesktopName: vi.fn(), setAppUserModelId: vi.fn() };
    hyperBindDesktopIdentity(app, 'linux'); expect(app.setDesktopName).toHaveBeenCalledExactlyOnceWith(HYPER_DESKTOP_FILE); expect(app.setAppUserModelId).not.toHaveBeenCalled();
    hyperBindDesktopIdentity(app, 'win32'); expect(app.setAppUserModelId).toHaveBeenCalledExactlyOnceWith(HYPER_DESKTOP_APP_ID);
    expect(hyperBindDesktopIdentity(app, 'darwin', () => 'com.github.Electron')).toBe(false); expect(hyperBindDesktopIdentity(app, 'darwin', () => HYPER_DESKTOP_APP_ID)).toBe(true); expect(hyperBindDesktopIdentity(app, 'darwin', () => { throw Error('No installed bundle'); })).toBe(false); expect(app.setDesktopName).toHaveBeenCalledTimes(1); expect(app.setAppUserModelId).toHaveBeenCalledTimes(1);
  });
  it('replaces only the direct trusted iframe Referer with a static own-ID origin', () => {
    const f = fixture(), result = hyperYouTubeClientHeaders(f.request, f.owner); expect(result).toEqual({ Accept: 'text/html', 'User-Agent': 'native', Referer: HYPER_YOUTUBE_APP_REFERRER }); expect(f.request.requestHeaders.referer).toContain('private'); expect(JSON.stringify(result)).not.toContain('private');
  });
  it.each(['https://www.youtube-nocookie.com.evil.example/embed/M7lc1UVf-VE', 'https://www.youtube.com/embed/M7lc1UVf-VE', 'http://www.youtube-nocookie.com/embed/M7lc1UVf-VE', 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?extra=1', 'https://user@www.youtube-nocookie.com/embed/M7lc1UVf-VE', 'https://www.youtube-nocookie.com:444/embed/M7lc1UVf-VE', 'https://www.youtube-nocookie.com/embed/short', 'https://www.youtube-nocookie.com/youtubei/v1/player'])('does not alter other targets: %s', url => { const f = fixture(); f.request.url = url; expect(hyperYouTubeClientHeaders(f.request, f.owner)).toBe(f.request.requestHeaders); });
  it('registers only the fixed player filter and resolves the current owned window on every request', () => {
    const f = fixture(), onBeforeSendHeaders = vi.fn(); let active = true;
    const session = { webRequest: { onBeforeSendHeaders } } as unknown as Parameters<typeof hyperInstallYouTubeClient>[0];
    hyperInstallYouTubeClient(session, () => active ? f.owner : null);
    expect(onBeforeSendHeaders.mock.calls[0][0]).toEqual({ urls: ['https://www.youtube-nocookie.com/embed/*'] });
    const handler = onBeforeSendHeaders.mock.calls[0][1], callback = vi.fn(); handler(f.request, callback); expect(callback).toHaveBeenLastCalledWith({ requestHeaders: { Accept: 'text/html', 'User-Agent': 'native', Referer: HYPER_YOUTUBE_APP_REFERRER } });
    active = false; handler(f.request, callback); expect(callback).toHaveBeenLastCalledWith({ requestHeaders: f.request.requestHeaders });
    expect(hyperYouTubeClientHeaders({ ...f.request, frame: null }, f.owner)).toBe(f.request.requestHeaders);
    f.owner.isDestroyed = () => true; expect(hyperYouTubeClientHeaders(f.request, f.owner)).toBe(f.request.requestHeaders);
    const staleRegister = vi.fn(), stale = { webRequest: { onBeforeSendHeaders: staleRegister } } as unknown as Parameters<typeof hyperInstallYouTubeClient>[0]; hyperInstallYouTubeClient(stale, () => { throw Error('Destroyed main frame'); }); const registered = staleRegister.mock.calls[0][1]; registered(f.request, callback); expect(callback).toHaveBeenLastCalledWith({ requestHeaders: f.request.requestHeaders });
  });
  it('does not alter other windows, nested frames, top navigations, missing/destroyed frames or foreign renderer documents', () => {
    for (const mode of ['window', 'nested', 'top', 'post', 'destroyed', 'main-destroyed', 'source', 'parent-source', 'missing-owner'] as const) {
      const f = fixture(); if (mode === 'window') f.request.webContentsId++; if (mode === 'nested') f.frame.parent = { ...f.main, frameTreeNodeId: 3 }; if (mode === 'top') f.request.resourceType = 'mainFrame'; if (mode === 'post') f.request.method = 'POST'; if (mode === 'destroyed') f.frame.isDestroyed = () => true; if (mode === 'main-destroyed') f.main.isDestroyed = () => true; if (mode === 'source') f.main.url = 'file:///other/index.html'; if (mode === 'parent-source') f.frame.parent = { ...f.main, url: 'https://foreign.example/' };
      expect(hyperYouTubeClientHeaders(f.request, mode === 'missing-owner' ? null : f.owner)).toBe(f.request.requestHeaders);
    }
  });
});

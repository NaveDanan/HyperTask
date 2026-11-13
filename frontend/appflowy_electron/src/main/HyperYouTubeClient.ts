import type { Session } from 'electron';
import { HYPER_YOUTUBE_APP_REFERRER } from '../shared/HyperDesktopIdentity';
interface HyperPlayerFrame { readonly frameTreeNodeId: number; readonly url: string; readonly parent: HyperPlayerFrame | null; isDestroyed(): boolean }
interface HyperPlayerOwner { webContentsId: number; mainFrame: HyperPlayerFrame; rendererURL: string; isDestroyed(): boolean }
interface HyperPlayerRequest { url: string; method: string; resourceType: string; webContentsId?: number; frame?: HyperPlayerFrame | null; requestHeaders: Record<string, string> }
const embed = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}$/u;
function documentUrl(value: string): string | null { try { const url = new URL(value); if (!['file:', 'http:', 'https:'].includes(url.protocol)) return null; url.hash = ''; return url.href; } catch { return null; } }
/** Identify only the owned app's direct player navigation, never its child requests or other windows. */
export function hyperYouTubeClientHeaders(request: HyperPlayerRequest, owner: HyperPlayerOwner | null): Record<string, string> {
  try {
    if (!owner || owner.isDestroyed() || request.webContentsId !== owner.webContentsId || request.resourceType !== 'subFrame' || request.method !== 'GET' || !embed.test(request.url)) return request.requestHeaders;
    const main = owner.mainFrame, frame = request.frame, parent = frame?.parent;
    if (main.isDestroyed() || !frame || frame.isDestroyed() || !parent || parent.isDestroyed() || parent.frameTreeNodeId !== main.frameTreeNodeId) return request.requestHeaders;
    const trusted = documentUrl(owner.rendererURL);
    if (!trusted || documentUrl(main.url) !== trusted || documentUrl(parent.url) !== trusted) return request.requestHeaders;
    return { ...Object.fromEntries(Object.entries(request.requestHeaders).filter(([key]) => key.toLowerCase() !== 'referer')), Referer: HYPER_YOUTUBE_APP_REFERRER };
  } catch { return request.requestHeaders; }
}
export function hyperInstallYouTubeClient(session: Pick<Session, 'webRequest'>, owner: () => HyperPlayerOwner | null) {
  session.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (request, callback) => {
    let headers = request.requestHeaders;
    try { headers = hyperYouTubeClientHeaders(request, owner()); } catch { /* The window may have closed during frame lookup. */ }
    callback({ requestHeaders: headers });
  });
}

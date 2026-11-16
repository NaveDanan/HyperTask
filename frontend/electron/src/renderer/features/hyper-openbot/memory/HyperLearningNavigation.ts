export interface HyperLearningSelection { tab?: string; proposalId?: string; skill?: string; agentId?: string; container?: string }
export function hyperLearningSelectionFromPath(path?: string): HyperLearningSelection {
  if (!path) return {};
  try {
    const url = new URL(path, 'https://native.invalid');
    if (url.origin !== 'https://native.invalid') return {};
    const match = /^\/(?:admin\/|settings\/)?learning(?:\/(proposals|skills|runs|recordings)(?:\/([^/]+))?)?$/.exec(url.pathname);
    if (!match) return {};
    return { tab: match[1], ...(match[1] === 'proposals' && match[2] ? { proposalId: decodeURIComponent(match[2]) } : {}), ...(match[1] === 'skills' && match[2] ? { skill: decodeURIComponent(match[2]) } : {}), agentId: url.searchParams.get('agentId') ?? undefined, container: url.searchParams.get('container') ?? undefined };
  } catch { return {}; }
}

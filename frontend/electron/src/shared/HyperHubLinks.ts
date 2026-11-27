import type { HyperHubDate, HyperHubLinkSuggestion, HyperHubTaskView } from './HyperTaskHub';

export interface HyperHubIssueAlias { evidenceId: string; instance: string; key: string; url: string }
export function hyperHubMentions(text: string, issues: HyperHubIssueAlias[]): string[] {
  const ids = new Set<string>();
  const instances = new Set(issues.map(i => i.instance));
  // Consume whole URLs before matching bare keys. A key inside an unrelated URL is not a citation.
  const prose = text.replace(/https?:\/\/[^\s<>"']+/gi, raw => {
    try {
      const url = new URL(raw.replace(/[).,;!?]+$/, ''));
      for (const issue of issues) {
        const expected = new URL(issue.url);
        if (!url.username && !url.password && url.origin === expected.origin && url.pathname === expected.pathname) ids.add(issue.evidenceId);
      }
    } catch { /* Malformed text cannot resolve an issue. */ }
    return ' ';
  });
  if (instances.size === 1) {
    const keys = new Set(prose.match(/\b[A-Z][A-Z0-9_]*-\d+\b/g));
    for (const issue of issues) if (keys.has(issue.key)) ids.add(issue.evidenceId);
  }
  return [...ids].sort();
}
export const hyperHubPair = (a: string, b: string) => JSON.stringify([a, b].sort());
const dateKey = (date?: HyperHubDate) => date && (date.kind === 'instant' ? Date.parse(date.iso) : date.date + '/' + date.zone);
export function hyperHubLinkSuggestions(tasks: HyperHubTaskView[], negatives: Record<string, boolean>, aliases: string[]): HyperHubLinkSuggestion[] {
  const result: HyperHubLinkSuggestion[] = [];
  const names = new Set(aliases.map(a => a.toLowerCase()));
  const owner = (t: HyperHubTaskView) => t.people.some(p => p.role === 'owner' || (p.role === 'assignee' && names.has(p.name.toLowerCase())));
  const participants = (t: HyperHubTaskView) => t.people.filter(p => p.role === 'requester' || p.role === 'participant');
  const candidates = tasks.filter(t => t.state !== 'dismissed' && t.state !== 'done');
  const buckets = new Map<string, HyperHubTaskView[]>();
  for (const task of candidates) {
    const keys = participants(task).map(p => 'participant:' + p.id);
    if (task.due) keys.push('deadline:' + dateKey(task.due));
    for (const key of new Set(keys)) {
      const members = buckets.get(key) ?? [];
      members.push(task);
      buckets.set(key, members);
    }
  }
  const visited = new Set<string>();
  for (const members of buckets.values()) for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
    const [a, b] = members[j].reviewSpan && !members[i].reviewSpan ? [members[j], members[i]] : [members[i], members[j]];
    const key = hyperHubPair(a.id, b.id);
    if (visited.has(key) || negatives[key]) continue;
    visited.add(key);
    const sharedOwner = owner(a) && owner(b), sharedProject = a.projectId && a.projectId === b.projectId;
    if (!sharedOwner && !sharedProject) continue;
    if (Math.abs(Date.parse((a.createdAt ?? a.firstSeenAt).iso) - Date.parse((b.createdAt ?? b.firstSeenAt).iso)) > 7 * 86400000) continue;
    const deadline = !!a.due && dateKey(a.due) === dateKey(b.due);
    const people = participants(a).filter(p => participants(b).some(q => q.id === p.id));
    if (!deadline && !people.length) continue;
    result.push({ targetId: a.id, otherTaskId: b.id, facts: [
      ...(sharedOwner ? ['Same owner'] : []), ...(sharedProject ? ['Project: ' + a.projectId] : []), 'Within seven days',
      ...(deadline ? ['Same deadline'] : []), ...people.map(p => 'Participant: ' + p.name),
    ] });
  }
  return result;
}

/** A merge overlays the original assignments. Splitting removes only that overlay. */
export interface HyperHubMerge { from: string; into: string }
export function hyperHubMergedIds(merges: Record<string, HyperHubMerge>) {
  const parents = new Map(Object.values(merges).map(m => [m.from, m.into]));
  return (id: string) => {
    const visited = new Set<string>();
    while (parents.has(id) && !visited.has(id)) { visited.add(id); id = parents.get(id)!; }
    return id;
  };
}

// Copyright (c) 2026 CopilotKit. MIT. See ../LICENSE and REUSE.md.
// Adapted from shared/standing-rule.ts and shared/tool-name.ts.
export function HyperOffersStandingRule(action: { policy?: { source: string; behaviour?: string; closed?: boolean } }): boolean {
  return action.policy?.source !== 'task' && action.policy?.closed !== true && action.policy?.behaviour !== 'hand_off';
}
export function HyperApprovalDetails({ args }: { args: unknown }) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const hidden = new Set(['ref', 'snapshotId', 'toolCallId', 'signal']);
  const entries = Object.entries(args).filter(([key, value]) => !hidden.has(key) && value != null);
  if (!entries.length) return null;
  return <dl aria-label="What it would send" className="max-h-52 space-y-1 overflow-auto rounded-lg bg-muted p-3 text-xs">{entries.map(([key, value]) => <div key={key}><dt className="font-medium">{key.replace(/[_-]+/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2').trim().split(' ').filter(Boolean).map(word => ['url', 'id'].includes(word.toLowerCase()) ? word.toUpperCase() : word.toLowerCase()).join(' ').replace(/^./, letter => letter.toUpperCase())}</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{typeof value === 'string' ? value : typeof value === 'boolean' ? value ? 'Yes' : 'No' : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join(', ') : JSON.stringify(value, null, 2)}</dd></div>)}</dl>;
}

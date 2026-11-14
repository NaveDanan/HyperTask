// Adapted from OpenBot f8af37ab73e96784f174a11104505a965e722cab. MIT, Copyright (c) 2026 CopilotKit.
export type HyperRuntimeFacts = {
  profile?: { visibility: string; canManage: boolean };
  capabilities?: { cloudBrowser?: boolean; cloudNetwork?: boolean; cloudComputer?: boolean };
};
export function hyperRuntimeToolAllowed(name: string, facts: HyperRuntimeFacts): boolean {
  if (!facts.profile || !(facts.profile.visibility === 'public' || facts.profile.canManage)) return false;
  const cap = facts.capabilities;
  if (['computer_list_files', 'computer_read_file', 'computer_write_file', 'computer_run_command'].includes(name)) return cap?.cloudComputer !== false;
  return cap?.cloudBrowser !== false && (name !== 'computer_navigate' || cap?.cloudNetwork !== false);
}
export function hyperRuntimeBotOf(agent: { runtimeAgentId?: string; agentId?: string } | undefined): string | undefined {
  return [agent?.runtimeAgentId, agent?.agentId].find(id => typeof id === 'string' && id.trim() !== '' && id !== 'default' && !id.startsWith('channel:'));
}
export function hyperRuntimeFailure(status: number, body: Record<string, unknown> | null) {
  return { ok: false, reason: typeof body?.error === 'string' ? body.error : 'The computer action did not complete.',
    ...(body?.starting === true ? { starting: true, notPerformed: true } : {}),
    ...(body?.needsConversation === true ? { needsConversation: true, notPerformed: true } : {}),
    ...(status === 403 ? { refused: true, rule: body?.rule ?? null } : {}),
    ...(status === 409 ? body?.humanHasControl === true ? { humanHasControl: true, requestId: body.requestId, handoff: body.handoff } : { staleRefs: true, ...(body?.snapshotRequired === true ? { snapshotRequired: true } : {}) } : {}),
  };
}

/** Apply to the calling agent's outgoing tool list before every SDK run. */
export function hyperFilterRuntimeTools<T extends { name: string }>(tools: readonly T[], facts: HyperRuntimeFacts): T[] {
  return tools.filter(tool => !tool.name.startsWith('computer_') || hyperRuntimeToolAllowed(tool.name, facts));
}

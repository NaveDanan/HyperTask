// Adapted from OpenBot at f8af37ab73e96784f174a11104505a965e722cab.
// MIT License. Copyright (c) 2026 CopilotKit. See ../LICENSE.
import { useCopilotKit, useFrontendTool, type ReactFrontendTool } from '@copilotkit/react-core/v2';
import { useRef } from 'react';
import { HYPER_OPENBOT_ORIGIN, hyperOpenBotFetch } from '../transport';
import { hyperFrontendApprovalSnapshot, HYPER_WAITING_FOR_PERSON } from './HyperApprovalContext';
import { hyperInStepOrder } from './HyperStepOrder';
import { HYPER_COMPUTER_TOOLS } from './HyperToolDefinitions';

import { hyperRuntimeBotOf, hyperRuntimeFailure, hyperRuntimeToolAllowed, type HyperRuntimeFacts } from './HyperRuntimePolicy';
export type HyperRuntimeToolsProps = {
  /** Fetch current server-derived facts for the CALLING bot, never the selected screen. */
  resolveFacts: (botId: string) => Promise<HyperRuntimeFacts>;
  /** Invalidate the approval inbox immediately. The server owns execution and continuation. */
  onApprovalPending?: () => void;
};

function HyperRuntimeTool({ definition, options }: { definition: ReactFrontendTool; options: HyperRuntimeToolsProps }) {
  const { copilotkit } = useCopilotKit();
  const current = useRef(options);
  current.current = options;
  useFrontendTool({ ...definition,
    handler: async (_args, context) => {
      try {
        context.signal?.throwIfAborted();
        const botId = hyperRuntimeBotOf(context.agent);
        if (!botId) return { ok: false, refused: true, reason: 'This action needs a Bot conversation.' };
        const facts = await current.current.resolveFacts(botId);
        if (!hyperRuntimeToolAllowed(definition.name, facts)) return { ok: false, refused: true, reason: 'This computer tool is not available to this Bot.' };
        const snapshot = hyperFrontendApprovalSnapshot(context);
        return await hyperInStepOrder({ computerId: botId, messages: context.agent?.messages, toolCallId: context.toolCall.id }, async () => {
        // All calls use the durable gate, including reads. No policy fallback to direct execution.
        const response = await hyperOpenBotFetch(`${HYPER_OPENBOT_ORIGIN}/api/approvals/computer/${encodeURIComponent(botId)}`, {
          method: 'POST', body: JSON.stringify(snapshot), signal: context.signal,
        });
        const payload = await response.json().catch(() => null);
        if (response.status === 202) {
          if (!context.agent) return { ok: false, reason: 'The conversation is unavailable.' };
          copilotkit.stopAgent({ agent: context.agent });
          current.current.onApprovalPending?.();
          return HYPER_WAITING_FOR_PERSON;
        }
        if (!response.ok) return hyperRuntimeFailure(response.status, payload);
        if (!payload || typeof payload !== 'object' || !('result' in payload)) return { ok: false, reason: 'The computer action returned no result.' };
        return payload.result;
        });
      } catch (error) {
        return { ok: false, ...(context.signal?.aborted ? { stopped: true } : {}), reason: error instanceof Error ? error.message : 'The computer could not be reached.' };
      }
    },
    // The transcript owns full result rendering. Never echo typed text or file contents here.
    render: ({ status, result }) => {
      let outcome: { ok?: boolean; waiting?: boolean; refused?: boolean; starting?: boolean; stopped?: boolean; doneByPerson?: boolean } = {};
      try { outcome = JSON.parse(result ?? '{}'); } catch { /* Some server results are plain text. */ }
      const label = outcome.waiting ? 'Waiting for approval' : outcome.refused ? 'Computer action blocked' : outcome.starting ? 'Computer is starting. Action not performed.' : outcome.stopped ? 'Computer action stopped' : outcome.doneByPerson ? 'Completed by you' : outcome.ok === false ? 'Computer action failed' : status !== 'complete' ? 'Computer action in progress' : 'Computer action finished';
      return <p className="my-2 text-xs text-muted-foreground" role="status">{label}</p>;
    },
  });
  return null;
}

/** Mount once under HyperOpenBotProvider; observe every agent before running its conversation. */
export function HyperRuntimeTools(props: HyperRuntimeToolsProps) {
  return <>{HYPER_COMPUTER_TOOLS.map(definition => <HyperRuntimeTool key={definition.name} definition={definition} options={props} />)}</>;
}

// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { readSubagentResult, subagentThreadId } from './HyperSubagentContract';
import { readThreadMessages } from '../HyperThreadMessages';
import { hyperMessageContent } from '../HyperMessageContent';
import { HyperMarkdown } from '../transcript/HyperMarkdown';
import { HyperToolMessage, type HyperToolMessageProps } from '../transcript/HyperTranscript';
import { hyperToolOutcome } from '../HyperToolOutcome';
export function HyperSubagentSteps({ toolCallId, parentThreadId, agentId, result, live }: { toolCallId: string; parentThreadId: string; agentId: string; result?: string; live: boolean }) {
  const parsed = result ? readSubagentResult(result) : null;
  const [steps, setSteps] = useState<{ id: string; text: string; tools: HyperToolMessageProps[] }[]>([]); const [error, setError] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => { let current = true; let timer: ReturnType<typeof setTimeout>; const read = async () => { try { const id = parsed?.threadId ?? await subagentThreadId(parentThreadId, toolCallId); const thread = await readThreadMessages(id, agentId); if (!current) return; if (thread.availability === 'unavailable') throw new Error('Unavailable'); setSteps(thread.messages.filter(message => message.role === 'assistant').map(message => ({ id: message.id, text: hyperMessageContent(message.content).text, tools: (message.toolCalls ?? []).map(call => { const answer = thread.messages.find(row => row.role === 'tool' && row.toolCallId === call.id); const result = answer ? hyperMessageContent(answer.content).text : undefined; return { id: call.id, label: call.function.name, arguments: call.function.arguments, result, status: hyperToolOutcome(result, live) }; }) }))); setError(false); } catch { if (current) setError(true); } finally { if (current && live) timer = setTimeout(() => void read(), 1500); } }; void read(); return () => { current = false; clearTimeout(timer); }; }, [toolCallId, parentThreadId, agentId, parsed?.threadId, live, revision]);
  return <section aria-label="Subagent steps" className="space-y-2 border-l pl-3"><p>{live ? 'Subagent working' : parsed && 'handedBack' in parsed ? `Handed back: ${parsed.handedBack.reason}` : parsed && 'error' in parsed ? parsed.error : 'Subagent completed'}</p>{parsed && 'handedBack' in parsed && <p>{parsed.next}</p>}{error && <p role="alert">Could not read subagent steps. <Button variant="ghost" onClick={() => setRevision(value => value + 1)}>Retry</Button></p>}{steps.map(step => <div key={step.id}><HyperMarkdown content={step.text} />{step.tools.map(tool => <HyperToolMessage key={tool.id} {...tool} />)}</div>)}</section>;
}

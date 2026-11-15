// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { createContext, useContext, useEffect, useState } from 'react';
import { hyperScreensApi } from './HyperScreensApi';
export const HyperReportContext = createContext<{botId: string; ask?: (text: string) => void}>({botId: ''});
export const useHyperReportBot = () => useContext(HyperReportContext).botId;
export const useHyperReportConversation = () => useContext(HyperReportContext);
export function useHyperBotNames() {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {let live = true; void Promise.all([hyperScreensApi.bots(), hyperScreensApi.bots(true).catch(() => [])]).then(([shown, hidden]) => {if (live) setNames(new Map([...hidden, ...shown].map(bot => [bot.id, bot.name])));}).catch(() => undefined); return () => {live = false;};}, []);
  return (id: string) => names.get(id) ?? id;
}
export async function hyperCallComponentFunction(component: string, fn: string, args: Record<string, unknown>, agentId: string): Promise<{allowed: boolean; data?: unknown; reason?: string; error?: string}> {
  try {return await hyperScreensApi.call(component, agentId, fn, args) as {allowed: boolean; data?: unknown; reason?: string};}
  catch {return {allowed: false, reason: "OpenBot couldn't be reached to read that data."};}
}

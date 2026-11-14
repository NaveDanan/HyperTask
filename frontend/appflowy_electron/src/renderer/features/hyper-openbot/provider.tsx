// Adapted from OpenBot app/src/lib/copilot/provider.tsx at f8af37a. MIT, Copyright (c) 2026 CopilotKit.
import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import { useEffect, useState, type ReactNode } from 'react';
import { HYPER_OPENBOT_ORIGIN } from './transport';
import { acquireHyperOpenBotTransport } from './HyperSdkTransport';
export function HyperOpenBotProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const release = acquireHyperOpenBotTransport(); setReady(true); return release; }, []);
  return ready ? <CopilotKitProvider enableInspector={false} runtimeUrl={`${HYPER_OPENBOT_ORIGIN}/api/copilotkit`} credentials="include" properties={{ openbotTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }}>{children}</CopilotKitProvider> : <p role="status" className="p-4 text-sm text-muted-foreground">Connecting to OpenBot…</p>;
}

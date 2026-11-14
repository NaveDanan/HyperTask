// Adapted from OpenBot app/src/lib/copilot/provider.tsx at f8af37a. MIT, Copyright (c) 2026 CopilotKit.
import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import type { ReactNode } from 'react';
import { HYPER_OPENBOT_ORIGIN, hyperOpenBotFetch } from './transport';

let installed = false;
function installTransport() {
  if (installed) return;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return url.startsWith(`${HYPER_OPENBOT_ORIGIN}/`) ? hyperOpenBotFetch(input, init) : original(input, init);
  };
  installed = true;
}
export function HyperOpenBotProvider({ children }: { children: ReactNode }) {
  installTransport();
  return <CopilotKitProvider enableInspector={false} runtimeUrl={`${HYPER_OPENBOT_ORIGIN}/api/copilotkit`} credentials="include" properties={{ openbotTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }}>{children}</CopilotKitProvider>;
}

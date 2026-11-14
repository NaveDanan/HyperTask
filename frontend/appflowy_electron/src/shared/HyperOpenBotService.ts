/** Main-owned development backend; no renderer-supplied hosts, paths, credentials or commands. */
export const HYPER_OPENBOT_SERVICE_ACTIONS = ['ensure', 'check', 'start', 'stop', 'restart'] as const;
export type HyperOpenBotServiceAction = typeof HYPER_OPENBOT_SERVICE_ACTIONS[number];
export const HYPER_OPENBOT_CHECKS = ['docker', 'deployment', 'postgres', 'computer', 'harness', 'server', 'worker', 'runtime', 'license', 'provider'] as const;
export type HyperOpenBotCheck = typeof HYPER_OPENBOT_CHECKS[number];
export type HyperOpenBotCheckState = 'ready' | 'stopped' | 'missing' | 'unhealthy' | 'unknown';
export type HyperOpenBotServiceProblem = 'none' | 'signed_out' | 'profile_required' | 'unsupported' | 'ssh_unavailable' | 'docker_unavailable' | 'setup_required' | 'unsafe_deployment' | 'services_stopped' | 'services_unhealthy' | 'runtime_unavailable' | 'license_required' | 'provider_required' | 'operation_failed' | 'timeout';
export interface HyperOpenBotBackendReport {
  version: 1;
  ready: boolean;
  problem: HyperOpenBotServiceProblem;
  checks: { id: HyperOpenBotCheck; state: HyperOpenBotCheckState }[];
}
export interface HyperOpenBotServiceState {
  backend: 'mmems-personal';
  phase: 'idle' | 'checking' | 'starting' | 'stopping' | 'restarting';
  ready: boolean;
  problem: HyperOpenBotServiceProblem;
  checks: HyperOpenBotBackendReport['checks'];
  autoStart: boolean;
  checkedAt: string | null;
}
export const HYPER_OPENBOT_SERVICE_MESSAGES: Record<HyperOpenBotServiceProblem, string> = {
  none: 'AI services are ready.', signed_out: 'Sign in to the connected HyperTask profile before using AI.',
  profile_required: 'This AI connection requires its original local HyperTask profile. Switch back to that profile and retry. Remote profiles and ownership transfer are not supported by this development connection.',
  unsupported: 'This development connection currently requires Linux and a supported native profile.',
  ssh_unavailable: 'The configured backend cannot be reached. Check the VM, Tailscale and your SSH access, then retry.',
  docker_unavailable: 'Docker is unavailable on the backend. Start its Docker engine or restore access, then retry.',
  setup_required: 'The backend needs the documented OpenBot and Intelligence installation. Provision it on the VM before starting AI.',
  unsafe_deployment: 'The backend does not match the private deployment. Check its ownership and loopback bindings before retrying.',
  services_stopped: 'AI services are stopped. Start them to use chat.',
  services_unhealthy: 'An AI service is not healthy. Retry readiness or restart the owned AI services.',
  runtime_unavailable: 'The original Intelligence runtime is unavailable. Retry readiness or restart the owned AI services.',
  license_required: 'CopilotKit sign-in, entitlement or agreement needs attention on the backend. Complete the official account workflow personally, then retry.',
  provider_required: 'Model sign-in is missing on the backend. Complete its ChatGPT OAuth flow, then retry.',
  operation_failed: 'The AI service operation failed. Check the private backend diagnostics and retry. Existing data is preserved.',
  timeout: 'The AI service operation took too long. Check readiness before retrying; it may still be finishing on the backend.',
};

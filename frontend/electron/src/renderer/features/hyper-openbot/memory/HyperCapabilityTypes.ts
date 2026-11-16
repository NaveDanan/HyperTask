// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
export type CapabilityKey =
  | "useBots"
  | "cloudBrowser"
  | "cloudNetwork"
  | "cloudComputer"
  | "localComputer"
  | "customRules"
  | "passwordManager"
  | "slackTeams"
  | "teamBots"
  | "ownerApps"
  | "isolatedComputers"
  | "proactive";

/** One switch as the server stored it at each scope. `null` means no row: the scope inherits. */
export type CapabilitySetting = {
  capability: CapabilityKey;
  title: string;
  description: string;
  default: boolean;
  organization: boolean | null;
  roles: Partial<Record<"admin" | "user", boolean>>;
  groups: Record<string, boolean>;
};


export type HyperEnterpriseControls = { capabilities: CapabilitySetting[]; groups: string[]; settings: { skillSharing: boolean } };

/** Codes survive localization and nested PowerShell COM exception wrappers. */
export function hyperOutlookDisconnected(message: string): boolean {
  return /(?:80010108|800706ba|800706be|800401fd|80010007|80010012|RPC_E_DISCONNECTED|RPC_S_SERVER_UNAVAILABLE|RPC_S_CALL_FAILED|CO_E_OBJNOTCONNECTED|RPC_E_SERVER_DIED|RPC_E_SERVER_DIED_DNE|object invoked has disconnected|RPC server is unavailable|Outlook is closed)/i.test(message);
}

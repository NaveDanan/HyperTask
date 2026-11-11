import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel as C, type CompanyCertificate, type CustomThemeFiles, type JiraCredentials, type OpenAIEndpointDiscoveryRequest, type OpenAIEndpointTestRequest } from '@shared/api';
import { CompanyCertificateStore } from './certificates';
import { installCustomTheme, listCustomThemes, readPluginDirectory, removeCustomTheme } from './custom-themes';
import { protect } from './dpapi';
import { loadGoogleFont } from './google-fonts';
import { JiraCredentialFiles } from './jira-credentials';
import { discoverEndpoint, testEndpoint, writeEndpointSettings } from './openai-endpoint';
import { toIpcResult } from './settings-error';
import type { HyperAICredentials } from './HyperAICredentials';

export interface SettingsIpcDeps {
  /** Flutter's getApplicationSupportDirectory(). */
  supportDirectory: () => string;
  /** getApplicationDocumentsDirectory(): where `.flowy_plugin` themes live. */
  documentsDirectory: () => string;
  getWindow?: () => BrowserWindow | null;
  aiCredentials?: Pick<HyperAICredentials, 'protect' | 'unprotect'>;
}

/** IPC for the settings dialog: DPAPI, AI endpoint, company certificates, custom themes, fonts. */
export function registerSettingsIpc(deps: SettingsIpcDeps): void {
  const certificates = new CompanyCertificateStore(deps.supportDirectory);

  ipcMain.handle(C.DpapiProtect, (_, value: string) => toIpcResult(() => deps.aiCredentials ? deps.aiCredentials.protect(value) : protect(value)));

  const jira = new JiraCredentialFiles(deps.supportDirectory);
  ipcMain.handle(C.JiraReadCredentials, (_, accountId: string) => toIpcResult(() => jira.read(accountId)));
  ipcMain.handle(C.JiraWriteCredentials, (_, accountId: string, credentials: JiraCredentials) =>
    toIpcResult(() => jira.write(accountId, credentials)),
  );
  ipcMain.handle(C.JiraDeleteCredentials, (_, accountId: string) => toIpcResult(() => jira.delete(accountId)));
  ipcMain.handle(C.JiraCredentialsPersistent, () => jira.isPersistent);

  ipcMain.handle(C.AiEndpointWriteSettings, (_, json: string) =>
    toIpcResult(() => writeEndpointSettings(deps.supportDirectory(), json)),
  );
  ipcMain.handle(C.AiEndpointTest, (_, request: OpenAIEndpointTestRequest) => toIpcResult(() => testEndpoint(request, deps.aiCredentials ? value => deps.aiCredentials!.unprotect(value) : undefined)));
  const discoveries = new Map<number, AbortController>();
  ipcMain.handle(C.AiEndpointDiscover, (event, request: OpenAIEndpointDiscoveryRequest) => toIpcResult(async () => {
    const senderId = event.sender.id;
    discoveries.get(senderId)?.abort();
    const controller = new AbortController();
    discoveries.set(senderId, controller);
    const destroyed = () => controller.abort();
    event.sender.once('destroyed', destroyed);
    try { return await discoverEndpoint(request, controller.signal, deps.aiCredentials ? value => deps.aiCredentials!.unprotect(value) : undefined); }
    finally {
      event.sender.removeListener('destroyed', destroyed);
      if (discoveries.get(senderId) === controller) discoveries.delete(senderId);
    }
  }));

  ipcMain.handle(C.CertificatesList, () => toIpcResult(() => certificates.list()));
  ipcMain.handle(C.CertificatesInspectFile, (_, filePath: string) => toIpcResult(() => certificates.inspectFile(filePath)));
  ipcMain.handle(C.CertificatesImport, (_, certificate: CompanyCertificate) =>
    toIpcResult(() => certificates.importCertificate(certificate)),
  );
  ipcMain.handle(C.CertificatesRemove, (_, certificate: CompanyCertificate) =>
    toIpcResult(() => certificates.removeCertificate(certificate)),
  );

  ipcMain.handle(C.ThemesList, () => listCustomThemes(deps.documentsDirectory()));
  ipcMain.handle(C.ThemesReadPluginDirectory, (_, directory: string) => toIpcResult(() => readPluginDirectory(directory)));
  ipcMain.handle(C.ThemesInstall, (_, theme: CustomThemeFiles) => installCustomTheme(deps.documentsDirectory(), theme));
  ipcMain.handle(C.ThemesRemove, (_, name: string) => removeCustomTheme(deps.documentsDirectory(), name));

  ipcMain.handle(C.FontsLoadGoogleFont, (_, family: string, text?: string) => loadGoogleFont(family, text));
}

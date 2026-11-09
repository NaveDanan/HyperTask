import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel as C, type CompanyCertificate, type CustomThemeFiles, type OpenAIEndpointTestRequest } from '@shared/api';
import { CompanyCertificateStore } from './certificates';
import { installCustomTheme, listCustomThemes, readPluginDirectory, removeCustomTheme } from './custom-themes';
import { protect } from './dpapi';
import { loadGoogleFont } from './google-fonts';
import { testEndpoint, writeEndpointSettings } from './openai-endpoint';
import { toIpcResult } from './settings-error';

export interface SettingsIpcDeps {
  /** Flutter's getApplicationSupportDirectory(). */
  supportDirectory: () => string;
  /** getApplicationDocumentsDirectory(): where `.flowy_plugin` themes live. */
  documentsDirectory: () => string;
  getWindow?: () => BrowserWindow | null;
}

/** IPC for the settings dialog: DPAPI, AI endpoint, company certificates, custom themes, fonts. */
export function registerSettingsIpc(deps: SettingsIpcDeps): void {
  const certificates = new CompanyCertificateStore(deps.supportDirectory);

  ipcMain.handle(C.DpapiProtect, (_, value: string) => toIpcResult(() => protect(value)));

  ipcMain.handle(C.AiEndpointWriteSettings, (_, json: string) =>
    toIpcResult(() => writeEndpointSettings(deps.supportDirectory(), json)),
  );
  ipcMain.handle(C.AiEndpointTest, (_, request: OpenAIEndpointTestRequest) => toIpcResult(() => testEndpoint(request)));

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

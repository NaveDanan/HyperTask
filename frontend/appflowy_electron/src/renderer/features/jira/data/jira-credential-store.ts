import { JiraCredentials } from './models/jira-config';
import { JiraServerException } from './jira-exception';
import type { IpcResult } from '@shared/api';
export interface JiraCredentialStore {
  isPersistent(): Promise<boolean>;
  read(accountId: string): Promise<JiraCredentials | null>;
  write(accountId: string, credentials: JiraCredentials): Promise<void>;
  delete(accountId: string): Promise<void>;
}
/** Main process owns Flutter-compatible UUID v5 filenames and Windows DPAPI. */
export class HyperJiraCredentialStore implements JiraCredentialStore {
  isPersistent(): Promise<boolean> { return window.appflowy.jira.isPersistent(); }
  async read(id: string): Promise<JiraCredentials | null> {
    const r = await window.appflowy.jira.readCredentials(id);
    if (!r.ok && r.kind === 'format') return null;
    const v = this.unwrap(r); return v ? new JiraCredentials(v) : null;
  }
  async write(id: string, c: JiraCredentials): Promise<void> { this.unwrap(await window.appflowy.jira.writeCredentials(id, { username: c.username, secret: c.secret })); }
  async delete(id: string): Promise<void> { this.unwrap(await window.appflowy.jira.deleteCredentials(id)); }
  private unwrap<T>(r: IpcResult<T>): T {
    if (!r.ok) throw new JiraServerException('Jira credential storage is unavailable. Please re-enter your credentials.');
    return r.value;
  }
}
export class HyperSessionJiraCredentialStore implements JiraCredentialStore {
  static readonly instance = new HyperSessionJiraCredentialStore();
  private readonly values = new Map<string, JiraCredentials>();
  async isPersistent(): Promise<boolean> { return false; }
  async read(id: string): Promise<JiraCredentials | null> { return this.values.get(id) ?? null; }
  async write(id: string, c: JiraCredentials): Promise<void> { this.values.set(id, c); }
  async delete(id: string): Promise<void> { this.values.delete(id); }
}
export { HyperJiraCredentialStore as WindowsJiraCredentialStore, HyperSessionJiraCredentialStore as SessionJiraCredentialStore };

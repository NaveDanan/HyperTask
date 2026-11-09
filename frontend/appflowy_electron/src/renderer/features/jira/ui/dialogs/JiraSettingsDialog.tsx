import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { JiraAuthType, jiraAuthLabels, JiraConfig, JiraCredentials, asJiraException, type JiraException } from '../..';
import { HyperJiraError, HyperJiraField, HyperJiraIconButton, HyperJiraModal, HyperJiraNotice, type HyperJiraStoreHook } from '../jira-ui';

export function HyperJiraSettingsDialog({ store, onClose }: { store: HyperJiraStoreHook; onClose: () => void }) {
  const [initial] = useState(() => store.getState());
  return <HyperJiraSettingsForm config={initial.config} hasCredentials={initial.hasCredentials} credentialsPersist={initial.credentialsPersist} actions={store.getState()} onClose={onClose} />;
}

export function HyperJiraSettingsForm({ config, hasCredentials, credentialsPersist, actions, onClose }: {
  config: JiraConfig | null; hasCredentials: boolean; credentialsPersist: boolean;
  actions: Pick<ReturnType<HyperJiraStoreHook['getState']>, 'testConnection' | 'saveSettings'>; onClose: () => void;
}) {
  const id = useId();
  const suggested = JiraConfig.fromUserUrl('https://jira.example.com/projects/DEMO/');
  const [url, setUrl] = useState(config?.baseUrl || suggested.baseUrl);
  const [project, setProject] = useState(config?.projectKey || suggested.projectKey);
  const [authType, setAuthType] = useState(config?.authType ?? JiraAuthType.personalAccessToken);
  const [username, setUsername] = useState(config?.username ?? '');
  const [secret, setSecret] = useState('');
  const [visible, setVisible] = useState(false);
  const [jql, setJql] = useState(config?.customJql ?? '');
  const [viewId, setViewId] = useState(config?.databaseViewId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<JiraException | null>(null);
  const basic = authType === JiraAuthType.basic;
  const control = (name: string) => ({ id: id + name, 'aria-invalid': !!errors[name], 'aria-describedby': errors[name] || name === 'url' || name === 'secret' ? id + name + '-help' : undefined });
  function buildConfig() {
    const parsed = JiraConfig.parseJiraUrl(url);
    const key = project.trim().toUpperCase() || parsed.projectKey || '';
    const nextErrors: Record<string, string> = {};
    if (!parsed.baseUrl) nextErrors.url = 'Enter a valid Jira URL.';
    if (!key) nextErrors.project = 'Enter the project key, e.g. DEMO.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return null;
    return (config ?? suggested).copyWith({ baseUrl: parsed.baseUrl, projectKey: key, authType, username: basic ? username.trim() : '', customJql: jql.trim(), databaseViewId: viewId.trim() });
  }
  function credentials() { return secret.trim() ? new JiraCredentials({ secret: secret.trim(), username: basic ? username.trim() : '' }) : null; }
  async function test() {
    const next = buildConfig(); if (!next) return;
    setTesting(true); setResult(null); setError(null);
    try {
      const { user, project: connectedProject } = await actions.testConnection(next, credentials());
      setResult(`Connected as ${user.displayName || user.name} · ${connectedProject.key} – ${connectedProject.name}`);
    } catch (e) { setError(asJiraException(e)); } finally { setTesting(false); }
  }
  function save() {
    const next = buildConfig(); if (!next) return;
    const value = credentials();
    const keepsSecret = hasCredentials && config?.scopeId === next.scopeId && config.authType === next.authType && config.username === next.username;
    if (!value && !keepsSecret) { setErrors({ secret: 'Enter a token to connect.' }); return; }
    if (basic && !next.username) { setErrors({ secret: 'Basic auth needs a username.' }); return; }
    // Close immediately, as Dart does; sync progress/errors remain on the dashboard.
    void actions.saveSettings(next, value);
    onClose();
  }
  return <HyperJiraModal title="Jira connection" onClose={onClose} footer={<>
    <Button type="button" variant="outline" className="sm:mr-auto" disabled={testing} onClick={() => void test()}>{testing ? 'Testing…' : 'Test connection'}</Button>
    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
    <Button type="submit" form={id + '-form'}>Save</Button>
  </>}>
    <form id={id + '-form'} className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <HyperJiraField id={id + 'url'} label="Jira URL" required error={errors.url} helper="Server or Data Center URL, including any context path. Pasting a project or issue link works too.">
        <Input {...control('url')} data-testid="jira-settings-url" className="font-mono text-xs" placeholder="https://jira.example.com/projects/KEY" value={url} onChange={event => { const value = event.target.value; setUrl(value); if (!project.trim()) setProject(JiraConfig.parseJiraUrl(value).projectKey ?? ''); }} />
      </HyperJiraField>
      <HyperJiraField id={id + 'project'} label="Project key" required error={errors.project}>
        <Input {...control('project')} data-testid="jira-settings-project" placeholder="DEMO" value={project} onChange={event => setProject(event.target.value)} />
      </HyperJiraField>
      <HyperJiraField id={id + 'auth'} label="Authentication">
        <ToggleGroup id={id + 'auth'} aria-labelledby={id + 'auth-label'} variant="outline" className="flex-wrap" value={[authType]} onValueChange={values => { const value = values[0]; if (value) setAuthType(value as JiraAuthType); }}>
          {Object.values(JiraAuthType).map(type => <ToggleGroupItem key={type} value={type} className="h-auto whitespace-normal py-2 text-xs">{jiraAuthLabels[type]}</ToggleGroupItem>)}
        </ToggleGroup>
      </HyperJiraField>
      {basic && <HyperJiraField id={id + 'username'} label="Username" required><Input id={id + 'username'} autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></HyperJiraField>}
      <HyperJiraField id={id + 'secret'} label={basic ? 'Password or token' : 'Personal access token'} required={!hasCredentials} error={errors.secret} helper={[hasCredentials ? 'Leave empty to keep the current one.' : '', credentialsPersist ? 'Stored in the OS secure storage.' : 'Kept in memory for this session only; re-enter after restarting AppFlowy.', 'Only sent to your Jira server.'].filter(Boolean).join(' ')}>
        <InputGroup><InputGroupInput {...control('secret')} data-testid="jira-settings-secret" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder={hasCredentials ? '••••••••' : undefined} value={secret} onChange={event => setSecret(event.target.value)} />
          <InputGroupAddon align="inline-end"><HyperJiraIconButton label={visible ? 'Hide password' : 'Show password'} size="icon-xs" aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</HyperJiraIconButton></InputGroupAddon>
        </InputGroup>
      </HyperJiraField>
      <HyperJiraField id={id + 'jql'} label="Custom JQL (optional)" helper={'Defaults to: project = "<key>". Ordering is applied automatically for stable paging.'}>
        <Textarea id={id + 'jql'} aria-describedby={id + 'jql-help'} className="font-mono text-xs" value={jql} onChange={event => setJql(event.target.value)} />
      </HyperJiraField>
      <HyperJiraField id={id + 'database'} label="Mirror into AppFlowy database (optional)" helper={'View id of an existing Grid/Board. Issues are mirrored one-way (Jira → AppFlowy) into "Jira …" columns; rows are never deleted.'}>
        <Input id={id + 'database'} aria-describedby={id + 'database-help'} className="font-mono text-xs" value={viewId} onChange={event => setViewId(event.target.value)} />
      </HyperJiraField>
      {result && <HyperJiraNotice variant="success" message={result} />}
      {error && <HyperJiraError error={error} />}
    </form>
  </HyperJiraModal>;
}
export { HyperJiraSettingsDialog as JiraSettingsDialog };

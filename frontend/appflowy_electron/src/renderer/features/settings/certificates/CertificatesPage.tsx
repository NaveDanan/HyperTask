import { useEffect, useRef, useState } from 'react';
import type { CompanyCertificate, IpcResult } from '@shared/api';
import { showDialog } from '@/ui';
import { ShieldCheck, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import { useAppStore } from '@/startup/app-store';
import type { SettingsPageProps } from '../page-props';
import { localIsoDate } from '../workspace/appearance-utils';

class CertificateError extends Error {
  constructor(
    message: string,
    readonly kind: 'format' | 'state' | 'unsupported' | 'other',
  ) {
    super(message);
  }
}

function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.value;
  throw new CertificateError(result.message, result.kind);
}

/** _failed: FormatException → message; anything else → 'Could not update certificates. ${error.toString()}'. */
function errorText(error: unknown): string {
  if (error instanceof CertificateError) {
    if (error.kind === 'format') return error.message;
    // Dart toString(): StateError → "Bad state: …", UnsupportedError → "Unsupported operation: …".
    const prefix = error.kind === 'state' ? 'Bad state: ' : error.kind === 'unsupported' ? 'Unsupported operation: ' : '';
    return `Could not update certificates. ${prefix}${error.message}`;
  }
  return `Could not update certificates. ${error instanceof Error ? error.message : String(error)}`;
}

/** AlertDialog('Remove company certificate?') → true when Remove is pressed. */
function confirmRemove(certificate: CompanyCertificate): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    showDialog(
      (close) => {
        const answer = (value: boolean) => {
          answered = true;
          resolve(value);
          close();
        };
        return (
          <div className="flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-4 rounded-xl bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-foreground/10">
            <h2 className="text-base font-medium">Remove company certificate?</h2>
            <p className="text-sm text-muted-foreground">{certificate.installedByApp
              ? `This removes ${certificate.subject} from your Windows account’s trusted certificates. Restart HyperTask afterward.`
              : `This removes ${certificate.subject} from AppFlowy’s imported list. The certificate was already trusted in Windows and will remain there.`}</p>
            <div className="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4">
              <Button variant="outline" onClick={() => answer(false)}>Cancel</Button>
              <Button className="bg-destructive text-white hover:bg-destructive/90" onClick={() => answer(true)}>Remove</Button>
            </div>
          </div>
        );
      },
      { onClosed: () => !answered && resolve(false) },
    );
  });
}

/** _CertificateDetails */
function CertificateDetails({ certificate }: { certificate: CompanyCertificate }) {
  return <CollapsibleContent className="px-4 pb-3"><dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 font-mono text-xs">
    <dt>SHA-256 fingerprint</dt><dd className="break-all select-text">{certificate.sha256}</dd>
  </dl></CollapsibleContent>;
}

function HyperCertificateRow({ certificate, busy, onRemove }: { certificate: CompanyCertificate; busy: boolean; onRemove?: () => void }) {
  const expired = new Date(certificate.notAfter).getTime() < Date.now();
  return <Collapsible>
    <SettingsRow label={<span className="flex min-w-0 items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><ShieldCheck className="size-4 text-muted-foreground" /></span><span className="min-w-0 break-words">{certificate.subject}</span></span>}
      description={<><div>{`Issued by: ${certificate.issuer}`}</div><div className={expired ? 'text-destructive' : undefined}>{`${expired ? 'Expired' : 'Expires'}: ${localIsoDate(certificate.notAfter)}`}</div></>}
      control={<><CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>Details</CollapsibleTrigger>{onRemove && <Button variant="ghost" size="icon-sm" aria-label="Remove" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={onRemove}><Trash2 className="size-4" /></Button>}</>} />
    <CertificateDetails certificate={certificate} />
  </Collapsible>;
}

/**
 * CompanyCertificatesSettingsView (features/company_certificates/company_certificates_settings_view.dart)
 * [CUSTOM]: hard-coded English; a divider between every child (autoSeparate).
 */
export function CertificatesPage(_: SettingsPageProps) {
  const isWindows = useAppStore((s) => s.info?.platform === 'win32');
  const [certificates, setCertificates] = useState<CompanyCertificate[]>([]);
  const [selected, setSelected] = useState<CompanyCertificate[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);

  const failed = (e: unknown) => {
    if (!mounted.current) return;
    setBusy(false);
    setError(errorText(e));
  };

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const list = unwrap(await window.appflowy.certificates.list());
        if (mounted.current) {
          setCertificates(list);
          setBusy(false);
        }
      } catch (e) {
        failed(e);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  const choose = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setSelected([]);
    try {
      const [file] = await window.appflowy.dialog.pickFiles({
        title: 'Choose a public company CA certificate',
        filters: [{ name: 'Certificates', extensions: ['cer', 'crt', 'pem'] }],
      });
      const chosen = file ? unwrap(await window.appflowy.certificates.inspectFile(file)) : [];
      if (mounted.current) {
        setSelected(chosen);
        setBusy(false);
      }
    } catch (e) {
      failed(e);
    }
  };

  const importSelected = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const certificate of selected) unwrap(await window.appflowy.certificates.importCertificate(certificate));
      const list = unwrap(await window.appflowy.certificates.list());
      if (!mounted.current) return;
      setCertificates(list);
      setSelected([]);
      setBusy(false);
      setMessage('Certificate imported. Restart HyperTask to refresh all connections.');
    } catch (e) {
      failed(e);
    }
  };

  const remove = async (certificate: CompanyCertificate) => {
    if (!(await confirmRemove(certificate)) || !mounted.current) return;
    setBusy(true);
    setError(null);
    try {
      unwrap(await window.appflowy.certificates.removeCertificate(certificate));
      const list = unwrap(await window.appflowy.certificates.list());
      if (mounted.current) {
        setCertificates(list);
        setBusy(false);
        setMessage('Certificate removed. Restart HyperTask to refresh all connections.');
      }
    } catch (e) {
      failed(e);
    }
  };

  return (
    <>
      <SettingsPageHeader title="Company certificates" description="Import the root or intermediate CA certificate provided by your IT team for Jira, your collaboration server, and AI endpoints." />
      <SettingsSection title="Imported certificates" actions={isWindows && <Button variant="outline" size="sm" disabled={busy} onClick={() => void choose()}><Plus className="size-4" />Choose certificate file</Button>}>
        <p className="text-sm text-muted-foreground">Certificates are trusted for your Windows account and other apps using that account. No administrator permission is needed.</p>
        {!isWindows && <p className="text-sm text-muted-foreground">Certificate import is available in the Windows desktop app.</p>}
        {busy && <Spinner />}
        {error !== null && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {message !== null && <Alert variant="success"><AlertDescription>{message}</AlertDescription></Alert>}
        <SettingsGroup>{!busy && certificates.length === 0 && <SettingsRow label="No company certificates imported yet." />}
          {certificates.map((certificate) => <HyperCertificateRow key={certificate.thumbprint} certificate={certificate} busy={busy} onRemove={() => void remove(certificate)} />)}
        </SettingsGroup>
      </SettingsSection>
      {selected.length > 0 && <SettingsSection title="Review before importing"><SettingsGroup>
        {selected.map((certificate) => <HyperCertificateRow key={`sel-${certificate.thumbprint}`} certificate={certificate} busy={busy} />)}
      </SettingsGroup><div><Button disabled={busy} onClick={() => void importSelected()}><ShieldCheck className="size-4" />{selected.length === 1 ? 'Trust certificate' : 'Trust certificates'}</Button></div></SettingsSection>}
    </>
  );
}

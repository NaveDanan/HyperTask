import { useEffect, useRef, useState } from 'react';
import type { CompanyCertificate, IpcResult } from '@shared/api';
import { showDialog, MaterialDialog } from '@/ui';
import { useAppStore } from '@/startup/app-store';
import type { SettingsPageProps } from '../page-props';
import { SettingsBody } from '../shared';
import { LinearProgress, MaterialIcon, MdButton, MdText } from '../material';
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
          <MaterialDialog width={560} style={{ padding: '24px 24px 8px' }}>
            <MdText size={20} weight={500}>
              Remove company certificate?
            </MdText>
            <div style={{ height: 20 }} />
            <MdText size={16} color="var(--afx-secondary-text)">
              {certificate.installedByApp
                ? `This removes ${certificate.subject} from your Windows account’s trusted certificates. Restart HyperTask afterward.`
                : `This removes ${certificate.subject} from AppFlowy’s imported list. The certificate was already trusted in Windows and will remain there.`}
            </MdText>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 0 0' }}>
              <MdButton variant="text" onPressed={() => answer(false)}>
                Cancel
              </MdButton>
              <MdButton variant="text" onPressed={() => answer(true)}>
                Remove
              </MdButton>
            </div>
          </MaterialDialog>
        );
      },
      { onClosed: () => !answered && resolve(false) },
    );
  });
}

/** _CertificateDetails */
function CertificateDetails({ certificate }: { certificate: CompanyCertificate }) {
  const expired = new Date(certificate.notAfter).getTime() < Date.now();
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <MdText weight={500}>{certificate.subject}</MdText>
      <div style={{ height: 6 }} />
      <MdText>{`Issued by: ${certificate.issuer}`}</MdText>
      <MdText color={expired ? 'var(--cs-error)' : undefined}>{`${expired ? 'Expired' : 'Expires'}: ${localIsoDate(certificate.notAfter)}`}</MdText>
      <div style={{ height: 6 }} />
      <MdText>SHA-256 fingerprint</MdText>
      <MdText size={12} selectable>
        {certificate.sha256}
      </MdText>
    </div>
  );
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
    <SettingsBody title="Company certificates">
      <MdText key="intro1">
        Import the root or intermediate CA certificate provided by your IT team for Jira, your collaboration server, and AI endpoints.
      </MdText>
      <MdText key="intro2">
        Certificates are trusted for your Windows account and other apps using that account. No administrator permission is needed.
      </MdText>
      {!isWindows ? (
        <MdText key="notice">Certificate import is available in the Windows desktop app.</MdText>
      ) : (
        <div key="choose">
          <MdButton variant="outlined" icon={MaterialIcon.folderOpen()} disabled={busy} onPressed={() => void choose()}>
            Choose certificate file
          </MdButton>
        </div>
      )}
      {busy && <LinearProgress key="busy" />}
      {error !== null && (
        <MdText key="error" color="var(--cs-error)">
          {error}
        </MdText>
      )}
      {message !== null && <MdText key="result">{message}</MdText>}
      {selected.length > 0 && [
        <MdText key="review" size={16} weight={500}>
          Review before importing
        </MdText>,
        ...selected.map((certificate) => <CertificateDetails key={`sel-${certificate.thumbprint}`} certificate={certificate} />),
        <div key="trust">
          <MdButton variant="filled" icon={MaterialIcon.verifiedUserOutlined(18, 'currentColor')} disabled={busy} onPressed={() => void importSelected()}>
            {selected.length === 1 ? 'Trust certificate' : 'Trust certificates'}
          </MdButton>
        </div>,
      ]}
      <MdText key="imported" size={16} weight={500}>
        Imported certificates
      </MdText>
      {!busy && certificates.length === 0 && <MdText key="empty">No company certificates imported yet.</MdText>}
      {certificates.map((certificate) => (
        <div key={certificate.thumbprint} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <CertificateDetails certificate={certificate} />
          <MdButton variant="text" disabled={busy} onPressed={() => void remove(certificate)}>
            Remove
          </MdButton>
          <div style={{ alignSelf: 'stretch', height: 16, display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--th-divider)' }} />
          </div>
        </div>
      ))}
    </SettingsBody>
  );
}

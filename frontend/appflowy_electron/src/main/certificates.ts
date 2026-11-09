import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CompanyCertificate } from '@shared/api';
import {
  CERTIFICATE_SCRIPT,
  MAX_CERTIFICATE_FILE_BYTES,
  certificateFileName,
  certificateFromJson,
  certificateToJson,
  dartBase64Decode,
  decodeCompanyCertificates,
  sortCertificates,
} from './certificates-core';
import { runPowerShell } from './powershell';
import { SettingsError } from './settings-error';

// CompanyCertificateStore + WindowsCompanyCertificatePlatform
// (lib/features/company_certificates/company_certificate_store.dart). Trust is applied by
// the Windows CurrentUser Root store; Chromium's network stack (net.fetch, the renderer)
// reads it natively, so there is no SecurityContext step.

type Action = 'inspect' | 'install' | 'remove';

async function isWithin(parent: string, child: string): Promise<boolean> {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** WindowsCompanyCertificatePlatform._run. */
async function runCertificateScript(action: Action, der: Uint8Array): Promise<Record<string, unknown>> {
  if (process.platform !== 'win32') {
    throw new SettingsError('unsupported', 'Company certificate import requires Windows.');
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'appflowy-cert-'));
  const file = path.join(temporary, 'certificate.cer');
  let failure: unknown = null;
  let output: Record<string, unknown> | null = null;
  try {
    await fs.writeFile(file, der, { flush: true });
    const result = await runPowerShell({
      script: CERTIFICATE_SCRIPT,
      env: { APPFLOWY_CERT_ACTION: action, APPFLOWY_CERT_FILE: file },
      timeoutMs: 30_000,
    });
    // The script only reports certificate validation/store errors; no secrets pass through it.
    if (result.exitCode !== 0) throw new SettingsError('format', result.stderr.trim());
    const parsed: unknown = JSON.parse(result.stdout.trim());
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SettingsError('other', 'The certificate tool returned an unexpected result.');
    }
    output = parsed as Record<string, unknown>;
  } catch (error) {
    failure = error;
  } finally {
    const resolved = await fs.realpath(temporary);
    const tempRoot = await fs.realpath(os.tmpdir());
    if (!(await isWithin(tempRoot, resolved))) {
      // eslint-disable-next-line no-unsafe-finally
      throw new SettingsError('state', 'Unexpected certificate temporary directory.');
    }
    await fs.rm(temporary, { recursive: true, force: true });
  }
  if (failure !== null) throw failure;
  return output!;
}

const inspect = async (der: Uint8Array) => certificateFromJson(await runCertificateScript('inspect', der));

async function install(der: Uint8Array): Promise<boolean> {
  const owned = (await runCertificateScript('install', der)).installedByApp;
  if (typeof owned !== 'boolean') throw new SettingsError('other', "type 'Null' is not a subtype of type 'bool' in type cast");
  return owned;
}

async function remove(der: Uint8Array): Promise<void> {
  await runCertificateScript('remove', der);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export class CompanyCertificateStore {
  constructor(private readonly supportDirectory: () => string) {}

  private root(): string {
    return path.join(this.supportDirectory(), 'company_certificates');
  }

  private file(certificate: Pick<CompanyCertificate, 'thumbprint'>): string {
    return path.join(this.root(), certificateFileName(certificate));
  }

  async list(): Promise<CompanyCertificate[]> {
    const root = this.root();
    if (!(await exists(root))) return [];
    const certificates: CompanyCertificate[] = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        const text = await fs.readFile(path.join(root, entry.name), 'utf8');
        certificates.push(certificateFromJson(JSON.parse(text)));
      }
    }
    return sortCertificates(certificates);
  }

  async inspectFile(filePath: string): Promise<CompanyCertificate[]> {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_CERTIFICATE_FILE_BYTES) {
      throw new SettingsError('format', 'Choose a certificate file smaller than 1 MB.');
    }
    const chunks = decodeCompanyCertificates(new Uint8Array(await fs.readFile(filePath)));
    const certificates: CompanyCertificate[] = [];
    for (const der of chunks) certificates.push(await inspect(der));
    return certificates;
  }

  async importCertificate(certificate: CompanyCertificate): Promise<void> {
    const file = this.file(certificate);
    if (await exists(file)) return;
    const der = dartBase64Decode(certificate.der);
    const owned = await install(der);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      await fs.writeFile(temporary, certificateToJson({ ...certificate, installedByApp: owned }), { encoding: 'utf8', flush: true });
      await fs.rename(temporary, file);
    } catch (error) {
      if (owned) await remove(der);
      throw error;
    }
  }

  async removeCertificate(certificate: CompanyCertificate): Promise<void> {
    const file = this.file(certificate);
    if (!(await exists(file))) return;
    const saved = certificateFromJson(JSON.parse(await fs.readFile(file, 'utf8')));
    if (saved.installedByApp) await remove(dartBase64Decode(saved.der));
    await fs.unlink(file);
  }
}

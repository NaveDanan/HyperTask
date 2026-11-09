import type { CompanyCertificate } from '@shared/api';
import { SettingsError } from './settings-error';

// Pure parts of lib/features/company_certificates/company_certificate_store.dart.

/** The PowerShell script, verbatim from the Dart `_certificateScript`. */
export const CERTIFICATE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $certificateBytes = [IO.File]::ReadAllBytes($env:APPFLOWY_CERT_FILE)
  $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (,$certificateBytes)
  if ($certificate.HasPrivateKey) { throw 'Choose a public CA certificate without a private key.' }
  $action = $env:APPFLOWY_CERT_ACTION
  if ($action -ne 'remove') {
    $constraints = $certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' } | Select-Object -First 1
    if ($null -eq $constraints) { throw 'This is a server certificate. Choose the company root or intermediate CA certificate.' }
    $basic = New-Object Security.Cryptography.X509Certificates.X509BasicConstraintsExtension
    $basic.CopyFrom($constraints)
    if (-not $basic.CertificateAuthority) { throw 'This is a server certificate. Choose a CA certificate.' }
    if ($certificate.NotAfter -le [DateTime]::Now) { throw 'This certificate has expired. Ask your IT team for the current CA certificate.' }
    if ($certificate.NotBefore -gt [DateTime]::Now) { throw 'This certificate is not valid yet. Check your PC clock or ask your IT team.' }
  }
  $owned = $false
  if ($action -eq 'install' -or $action -eq 'remove') {
    $store = New-Object Security.Cryptography.X509Certificates.X509Store -ArgumentList 'Root','CurrentUser'
    try {
      $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
      $existing = $store.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $certificate.Thumbprint, $false)
      if ($action -eq 'install' -and $existing.Count -eq 0) { $store.Add($certificate); $owned = $true }
      if ($action -eq 'remove') { foreach ($match in $existing) { $store.Remove($match) } }
    } finally { $store.Close() }
  }
  $hash = [Security.Cryptography.SHA256]::Create()
  $sha256 = [BitConverter]::ToString($hash.ComputeHash($certificate.RawData)).Replace('-','')
  $hash.Dispose()
  @{
    subject = $certificate.Subject; issuer = $certificate.Issuer;
    thumbprint = $certificate.Thumbprint; sha256 = $sha256;
    notBefore = $certificate.NotBefore.ToUniversalTime().ToString('o');
    notAfter = $certificate.NotAfter.ToUniversalTime().ToString('o');
    der = [Convert]::ToBase64String($certificate.RawData); installedByApp = $owned
  } | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

export const MAX_CERTIFICATE_FILE_BYTES = 1024 * 1024;

const pad = (value: number, width: number) => String(value).padStart(width, '0');

const ISO = /^([+-]?\d{4,6})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d)(?:[.,](\d+))?)?\s?(Z|z|[+-]\d\d(?::?\d\d)?)?$/;

/**
 * DateTime.parse(text).toUtc().toIso8601String(): fractions are truncated to microseconds,
 * and the microsecond digits are printed only when non-zero (`2030-01-02T03:04:05.000Z`).
 */
export function dartIsoUtc(text: string): string {
  const match = ISO.exec(text.trim());
  if (!match) throw new SettingsError('format', 'Invalid date format');
  const [, y, mo, d, h, mi, s = '0', fraction = '', zone] = match;
  const micros = Number(fraction.slice(0, 6).padEnd(6, '0'));
  const [year0, month0, day0, hour0, minute0, second0] = [y, mo, d, h, mi, s].map(Number);
  const date = new Date(0);
  if (zone === undefined) {
    // No zone: a local time, as DateTime.parse reads it.
    date.setFullYear(year0, month0 - 1, day0);
    date.setHours(hour0, minute0, second0, 0);
  } else {
    date.setUTCFullYear(year0, month0 - 1, day0);
    date.setUTCHours(hour0, minute0, second0, 0);
    if (zone !== 'Z' && zone !== 'z') {
      const sign = zone.startsWith('-') ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      const offset = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || '0');
      date.setTime(date.getTime() - sign * offset * 60_000);
    }
  }
  const year = date.getUTCFullYear();
  const yearText = year >= 0 && year <= 9999 ? pad(year, 4) : `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}`;
  const milli = Math.floor(micros / 1000);
  const micro = micros % 1000;
  return (
    `${yearText}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}` +
    `T${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}` +
    `.${pad(milli, 3)}${micro === 0 ? '' : pad(micro, 3)}Z`
  );
}

const BASE64_CHARS = /^[A-Za-z0-9+/\-_]*$/;

/** Dart base64Decode: both alphabets, length a multiple of four, `=` padding only at the end. */
export function dartBase64Decode(text: string): Uint8Array {
  const source = text.replace(/%3D/gi, '=');
  const body = source.replace(/=+$/, '');
  if (!BASE64_CHARS.test(body) || source.length - body.length > 2) {
    throw new SettingsError('format', 'Invalid character');
  }
  if (source.length % 4 !== 0) throw new SettingsError('format', 'Invalid length, must be multiple of four');
  return new Uint8Array(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

/** decodeCompanyCertificates: one DER, or every CERTIFICATE block of a PEM file. */
export function decodeCompanyCertificates(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length === 0) throw new SettingsError('format', 'The certificate file is empty.');
  const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes);
  if (text.includes('PRIVATE KEY')) {
    throw new SettingsError('format', 'Choose a public CA certificate, without a private key.');
  }
  if (!text.includes('-----BEGIN')) return [bytes];
  const matches = [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)];
  if (matches.length === 0) throw new SettingsError('format', 'No public certificate was found in this PEM file.');
  return matches.map((match) => dartBase64Decode(match[1].replace(/\s/g, '')));
}

const THUMBPRINT = /^[A-Fa-f0-9]{40}$/;

/** The metadata file name: `<THUMBPRINT_UPPER>.json`. */
export function certificateFileName(certificate: Pick<CompanyCertificate, 'thumbprint'>): string {
  if (typeof certificate.thumbprint !== 'string' || !THUMBPRINT.test(certificate.thumbprint)) {
    throw new SettingsError('format', 'Invalid certificate fingerprint.');
  }
  return `${certificate.thumbprint.toUpperCase()}.json`;
}

function field(json: Record<string, unknown>, key: string): string {
  const value = json[key];
  if (typeof value !== 'string') {
    throw new SettingsError('other', `type '${value === undefined || value === null ? 'Null' : typeof value}' is not a subtype of type 'String' in type cast`);
  }
  return value;
}

/** CompanyCertificate.fromJson, with dates normalized as toJson writes them. */
export function certificateFromJson(value: unknown): CompanyCertificate {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SettingsError('other', 'The certificate record is not a JSON object.');
  }
  const json = value as Record<string, unknown>;
  const installed = json.installedByApp;
  if (installed !== undefined && installed !== null && typeof installed !== 'boolean') {
    throw new SettingsError('other', "type is not a subtype of type 'bool?' in type cast");
  }
  const der = field(json, 'der');
  dartBase64Decode(der);
  return {
    subject: field(json, 'subject'),
    issuer: field(json, 'issuer'),
    thumbprint: field(json, 'thumbprint'),
    sha256: field(json, 'sha256'),
    notBefore: dartIsoUtc(field(json, 'notBefore')),
    notAfter: dartIsoUtc(field(json, 'notAfter')),
    der,
    installedByApp: installed ?? false,
  };
}

/** CompanyCertificate.toJson: the stored file content (jsonEncode, compact, this key order). */
export function certificateToJson(certificate: CompanyCertificate): string {
  return JSON.stringify({
    subject: certificate.subject,
    issuer: certificate.issuer,
    thumbprint: certificate.thumbprint,
    sha256: certificate.sha256,
    notBefore: dartIsoUtc(certificate.notBefore),
    notAfter: dartIsoUtc(certificate.notAfter),
    der: certificate.der,
    installedByApp: certificate.installedByApp,
  });
}

/** list() order: Dart String.compareTo, i.e. UTF-16 code units. */
export function sortCertificates(certificates: CompanyCertificate[]): CompanyCertificate[] {
  return [...certificates].sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
}

/** `-----BEGIN CERTIFICATE-----` PEM of a stored certificate (CompanyCertificate.pemBytes). */
export const certificatePem = (certificate: Pick<CompanyCertificate, 'der'>) =>
  `-----BEGIN CERTIFICATE-----\n${certificate.der}\n-----END CERTIFICATE-----\n`;

import { describe, expect, it } from 'vitest';
import {
  certificateFileName,
  certificateFromJson,
  certificatePem,
  certificateToJson,
  dartBase64Decode,
  dartIsoUtc,
  decodeCompanyCertificates,
  sortCertificates,
} from './certificates-core';
import type { CompanyCertificate } from '@shared/api';

const utf8 = (text: string) => new TextEncoder().encode(text);

function thrown(run: () => unknown): { kind?: string; message: string } {
  try {
    run();
  } catch (error) {
    return error as { kind?: string; message: string };
  }
  throw new Error('expected an error');
}

describe('decodeCompanyCertificates', () => {
  it('rejects an empty file', () => {
    expect(thrown(() => decodeCompanyCertificates(new Uint8Array()))).toMatchObject({
      kind: 'format',
      message: 'The certificate file is empty.',
    });
  });

  it('rejects files containing a private key', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n';
    expect(thrown(() => decodeCompanyCertificates(utf8(pem)))).toMatchObject({
      kind: 'format',
      message: 'Choose a public CA certificate, without a private key.',
    });
  });

  it('passes a DER file through unchanged', () => {
    const der = new Uint8Array([0x30, 0x82, 0x01, 0x0a, 0xff, 0x00, 0x80]);
    const [result] = decodeCompanyCertificates(der);
    expect(result).toBe(der);
  });

  it('decodes every CERTIFICATE block of a PEM bundle, ignoring whitespace', () => {
    const pem = [
      'subject=CN=Root',
      '-----BEGIN CERTIFICATE-----',
      'AQID',
      'BA==',
      '-----END CERTIFICATE-----',
      '-----BEGIN CERTIFICATE-----\r\n  BQYH\r\n-----END CERTIFICATE-----',
    ].join('\n');
    const result = decodeCompanyCertificates(utf8(pem));
    expect(result.map((bytes) => [...bytes])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7],
    ]);
  });

  it('rejects a PEM file without certificate blocks', () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n';
    expect(thrown(() => decodeCompanyCertificates(utf8(pem)))).toMatchObject({
      kind: 'format',
      message: 'No public certificate was found in this PEM file.',
    });
  });

  it('rejects malformed base64 like Dart base64Decode', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nAQI\n-----END CERTIFICATE-----';
    expect(thrown(() => decodeCompanyCertificates(utf8(pem))).kind).toBe('format');
    expect(thrown(() => dartBase64Decode('AQ*D')).message).toBe('Invalid character');
    expect([...dartBase64Decode('-_8=')]).toEqual([0xfb, 0xff]);
  });
});

describe('dartIsoUtc', () => {
  it('normalizes PowerShell round-trip dates to Dart toIso8601String', () => {
    expect(dartIsoUtc('2030-01-02T03:04:05.0000000Z')).toBe('2030-01-02T03:04:05.000Z');
    expect(dartIsoUtc('2030-01-02T03:04:05.1234567Z')).toBe('2030-01-02T03:04:05.123456Z');
    expect(dartIsoUtc('2030-01-02T03:04:05.120Z')).toBe('2030-01-02T03:04:05.120Z');
    expect(dartIsoUtc('2030-01-02T03:04:05Z')).toBe('2030-01-02T03:04:05.000Z');
  });

  it('applies zone offsets', () => {
    expect(dartIsoUtc('2030-01-02T03:04:05+02:00')).toBe('2030-01-02T01:04:05.000Z');
    expect(dartIsoUtc('2030-01-01T23:30:00-01:00')).toBe('2030-01-02T00:30:00.000Z');
  });

  it('rejects text that is not a date', () => {
    expect(thrown(() => dartIsoUtc('tomorrow')).kind).toBe('format');
  });
});

const sample: CompanyCertificate = {
  subject: 'CN=Contoso Root CA, O=Contoso',
  issuer: 'CN=Contoso Root CA, O=Contoso',
  thumbprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  sha256: 'AB'.repeat(32),
  notBefore: '2020-05-06T07:08:09.0000000Z',
  notAfter: '2040-05-06T07:08:09.0000000Z',
  der: 'AQIDBA==',
  installedByApp: true,
};

describe('certificate JSON', () => {
  it('writes the Dart toJson key order and date format', () => {
    expect(certificateToJson(sample)).toBe(
      '{"subject":"CN=Contoso Root CA, O=Contoso","issuer":"CN=Contoso Root CA, O=Contoso",' +
        `"thumbprint":"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678","sha256":"${'AB'.repeat(32)}",` +
        '"notBefore":"2020-05-06T07:08:09.000Z","notAfter":"2040-05-06T07:08:09.000Z","der":"AQIDBA==","installedByApp":true}',
    );
  });

  it('round-trips through fromJson', () => {
    const parsed = certificateFromJson(JSON.parse(certificateToJson(sample)));
    expect(parsed).toEqual({ ...sample, notBefore: '2020-05-06T07:08:09.000Z', notAfter: '2040-05-06T07:08:09.000Z' });
    expect(certificateToJson(parsed)).toBe(certificateToJson(sample));
  });

  it('defaults installedByApp to false and parses PowerShell inspect output', () => {
    const fromScript = certificateFromJson({ ...sample, installedByApp: undefined });
    expect(fromScript.installedByApp).toBe(false);
  });

  it('rejects records with missing fields', () => {
    expect(thrown(() => certificateFromJson({ ...sample, subject: undefined })).kind).toBe('other');
    expect(thrown(() => certificateFromJson([])).kind).toBe('other');
  });

  it('builds the PEM text', () => {
    expect(certificatePem(sample)).toBe('-----BEGIN CERTIFICATE-----\nAQIDBA==\n-----END CERTIFICATE-----\n');
  });
});

describe('certificateFileName', () => {
  it('uses the upper-cased SHA-1 thumbprint', () => {
    expect(certificateFileName(sample)).toBe('A1B2C3D4E5F60718293A4B5C6D7E8F9012345678.json');
  });

  it('rejects anything but 40 hex characters', () => {
    for (const thumbprint of ['', 'abc', '../../etc/passwd', 'G'.repeat(40), 'a'.repeat(41)]) {
      expect(thrown(() => certificateFileName({ thumbprint }))).toMatchObject({
        kind: 'format',
        message: 'Invalid certificate fingerprint.',
      });
    }
  });
});

describe('sortCertificates', () => {
  it('orders by subject with String.compareTo semantics (code units, case-sensitive)', () => {
    const subjects = ['CN=b', 'CN=B', 'CN=a', 'CN=Ä', 'CN=A'];
    const sorted = sortCertificates(subjects.map((subject) => ({ ...sample, subject })));
    expect(sorted.map((c) => c.subject)).toEqual(['CN=A', 'CN=B', 'CN=a', 'CN=b', 'CN=Ä']);
  });
});

import { describe, expect, it } from 'vitest';
import { isVendorHost, validateServerUrl } from './self-hosted-policy';

describe('self-hosted policy', () => {
  it('recognizes vendor hosts and their subdomains', () => {
    expect(isVendorHost('appflowy.com')).toBe(true);
    expect(isVendorHost('beta.appflowy.cloud.')).toBe(true);
    expect(isVendorHost('collaboration.example.com')).toBe(false);
    expect(isVendorHost('notappflowy.com')).toBe(false);
  });

  it('accepts a bare origin and rejects paths, credentials and vendor hosts', () => {
    expect(() => validateServerUrl('http://collaboration.example.com:8080')).not.toThrow();
    expect(() => validateServerUrl('https://appflowy.internal/')).not.toThrow();
    expect(() => validateServerUrl('https://host/path')).toThrow(/without a path/);
    expect(() => validateServerUrl('https://user:pw@host')).toThrow(/without a path/);
    expect(() => validateServerUrl('ftp://host')).toThrow(/without a path/);
    expect(() => validateServerUrl('https://beta.appflowy.cloud')).toThrow(/hosted services are disabled/);
  });
});

// The self-hosted network policy of this checkout (env/self_hosted_policy.dart): Hypertask
// hosted services are disabled, so vendor hosts are refused everywhere.

const VENDOR_DOMAINS = ['hypertask.com', 'hypertask.io', 'hypertask.cloud'];

export function isVendorHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  return VENDOR_DOMAINS.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

export function isVendorUrl(url: string): boolean {
  try {
    return isVendorHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * SelfHostedPolicy.validateServerUrl: an http(s) origin without credentials, query,
 * fragment or path, and not a vendor host. Throws with the Flutter app's messages.
 */
export function validateServerUrl(value: string): void {
  let uri: URL;
  try {
    uri = new URL(value.trim());
  } catch {
    throw new Error('Enter your server origin, such as https://hypertask.internal, without a path or credentials.');
  }
  const valid =
    (uri.protocol === 'http:' || uri.protocol === 'https:') &&
    uri.hostname !== '' &&
    uri.username === '' &&
    uri.password === '' &&
    uri.search === '' &&
    uri.hash === '' &&
    (uri.pathname === '' || uri.pathname === '/') &&
    !/[?#]/.test(value.trim());
  if (!valid) {
    throw new Error('Enter your server origin, such as https://hypertask.internal, without a path or credentials.');
  }
  if (isVendorHost(uri.hostname)) {
    throw new Error('Hypertask hosted services are disabled. Enter your own server address.');
  }
}

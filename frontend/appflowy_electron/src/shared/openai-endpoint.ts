// Pure parts of OpenAIEndpointSettings (lib/ai/service/openai_endpoint_settings.dart),
// shared by the renderer (validation before Save) and the main process (Test endpoint).
// No node or electron imports.

export type EndpointErrorKind = 'format' | 'state' | 'other';

/** FormatException ('format'), StateError ('state') or another failure ('other'). */
export class EndpointError extends Error {
  readonly kind: EndpointErrorKind;

  constructor(kind: EndpointErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'EndpointError';
  }
}

const VENDOR_DOMAINS = ['appflowy.com', 'appflowy.io', 'appflowy.cloud'];

/** RFC 3986 appendix B split, the structure Dart's Uri.tryParse recognises. */
const URI_PARTS = /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/;

interface ParsedEndpointUri {
  scheme: string;
  host: string;
  userInfo: string;
  hasQuery: boolean;
  hasFragment: boolean;
}

/** Dart Uri.tryParse for the fields validate() reads; null when the text is not a URI. */
export function parseEndpointUri(text: string): ParsedEndpointUri | null {
  const parts = URI_PARTS.exec(text);
  if (!parts) return null;
  const [, scheme = '', authority, , query, fragment] = parts;
  let whatwg: URL | null = null;
  try {
    whatwg = new URL(text);
  } catch {
    // Not parseable as an absolute URL (e.g. invalid port or host characters).
  }
  if (authority === undefined) {
    return { scheme: scheme.toLowerCase(), host: '', userInfo: '', hasQuery: query !== undefined, hasFragment: fragment !== undefined };
  }
  if (!whatwg) return null;
  const at = authority.lastIndexOf('@');
  const userInfo = at >= 0 ? authority.slice(0, at) : '';
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const rawHost = hostPort.startsWith('[') ? hostPort.slice(0, hostPort.indexOf(']') + 1) : hostPort.replace(/:\d*$/, '');
  return {
    scheme: scheme.toLowerCase(),
    // Dart lowercases and percent-decodes reg-name hosts; WHATWG's hostname does the same.
    host: rawHost === '' ? '' : whatwg.hostname,
    userInfo,
    hasQuery: query !== undefined,
    hasFragment: fragment !== undefined,
  };
}

/** SelfHostedPolicy-style vendor check: all trailing dots removed, then the domain or a subdomain. */
export function isEndpointVendorHost(host: string): boolean {
  let normalized = host.toLowerCase();
  while (normalized.endsWith('.')) normalized = normalized.slice(0, -1);
  return VENDOR_DOMAINS.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

/** OpenAIEndpointSettings.validate(): throws an EndpointError of kind 'format'. */
export function validateEndpoint(baseUrl: string, model: string): void {
  const uri = parseEndpointUri(baseUrl);
  if (
    uri === null ||
    !['http', 'https'].includes(uri.scheme) ||
    uri.host === '' ||
    uri.userInfo !== '' ||
    uri.hasQuery ||
    uri.hasFragment
  ) {
    throw new EndpointError(
      'format',
      'Enter an absolute HTTP or HTTPS API base URL without credentials, query parameters, or fragments.',
    );
  }
  if (isEndpointVendorHost(uri.host)) {
    throw new EndpointError('format', 'AppFlowy hosted services are disabled. Use your own AI endpoint.');
  }
  if (model.trim() === '') {
    throw new EndpointError('format', "Enter the endpoint's chat model ID.");
  }
}

/** apiUri(resource): trailing slashes of the base URL are dropped. */
export function endpointApiUrl(baseUrl: string, resource: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${resource}`;
}

/** The test request body, keys in the order Dart's jsonEncode writes them. */
export function completionTestBody(model: string): string {
  return JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: 'Reply with OK.' }] });
}

export const httpStatusMessage = (status: number) =>
  `Endpoint returned HTTP ${status}. Check the base URL, credential, and model ID.`;

export const unreachableMessage = 'Cannot reach the endpoint. Check the network and TLS certificate.';

/**
 * The body checks of testConnection(): not JSON → FormatException (the parser's message);
 * not an object, or `choices` not a list → a TypeError ('other'); no choices → FormatException.
 */
export function parseCompletionBody(text: string): void {
  const body: unknown = JSON.parse(text);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new EndpointError('other', 'The endpoint response is not a JSON object.');
  }
  const choices = (body as Record<string, unknown>).choices;
  if (choices !== undefined && choices !== null && !Array.isArray(choices)) {
    throw new EndpointError('other', 'The endpoint response has an invalid choices field.');
  }
  if (!choices || choices.length === 0) {
    throw new EndpointError('format', 'Endpoint returned no chat completion.');
  }
}

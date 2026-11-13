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
export function validateEndpointBaseUrl(baseUrl: string): void {
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
}

export function validateEndpoint(baseUrl: string, model: string): void {
  validateEndpointBaseUrl(baseUrl);
  if (model.trim() === '') {
    throw new EndpointError('format', "Enter the endpoint's chat model ID.");
  }
}

export interface EndpointModelPage { models: string[]; nextUrl: string | null }
/** Validate each page without echoing a provider body, which could contain credentials. */
export function parseEndpointModelPage(text: string, currentUrl: string, baseUrl: string): EndpointModelPage {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new EndpointError('format', 'The models endpoint did not return valid JSON.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray((raw as Record<string, unknown>).data)) throw new EndpointError('format', 'The models endpoint must return an object with a data array.');
  const body = raw as Record<string, unknown>;
  const models = (body.data as unknown[]).map(entry => {
    const id = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>).id : undefined;
    if (typeof id !== 'string' || !id.trim() || id.length > 1024 || /[\u0000-\u001f\u007f]/.test(id)) throw new EndpointError('format', 'The models endpoint returned an invalid model ID.');
    return id;
  });
  if (body.has_more !== undefined && typeof body.has_more !== 'boolean') throw new EndpointError('format', 'The models endpoint returned invalid pagination.');
  const explicit = body.next ?? (body.links && typeof body.links === 'object' && !Array.isArray(body.links) ? (body.links as Record<string, unknown>).next : undefined);
  let nextUrl: string | null = null;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    if (typeof explicit !== 'string') throw new EndpointError('format', 'The models endpoint returned invalid pagination.');
    nextUrl = safeEndpointModelPageUrl(explicit, currentUrl, baseUrl);
  } else if (body.has_more === true) {
    const cursor = body.last_id ?? models.at(-1);
    if (typeof cursor !== 'string' || !cursor || cursor.length > 1024 || /[\u0000-\u001f\u007f]/.test(cursor)) throw new EndpointError('format', 'The models endpoint did not provide a valid next-page cursor.');
    const url = new URL(currentUrl); url.searchParams.set('after', cursor); nextUrl = url.href;
  }
  return { models: [...new Set(models)].sort(), nextUrl };
}

/** A server-provided next link may only address the configured models resource. */
export function safeEndpointModelPageUrl(next: string, currentUrl: string, baseUrl: string): string {
  const first = new URL(endpointApiUrl(baseUrl, 'models'));
  let url: URL;
  try { url = new URL(next, currentUrl); } catch { throw new EndpointError('format', 'The models endpoint returned an invalid next-page URL.'); }
  if (url.origin !== first.origin || url.pathname.replace(/\/+$/, '') !== first.pathname.replace(/\/+$/, '') || url.username || url.password || url.hash || url.href.length > 8192) throw new EndpointError('state', 'The models endpoint returned an unsafe next-page URL. Credentials were not forwarded.');
  return url.href;
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
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new SyntaxError('The endpoint did not return valid JSON.'); }
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

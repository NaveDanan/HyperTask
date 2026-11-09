import { describe, expect, it } from 'vitest';
import {
  completionTestBody,
  endpointApiUrl,
  isEndpointVendorHost,
  parseCompletionBody,
  validateEndpoint,
} from './openai-endpoint';

const URL_ERROR = 'Enter an absolute HTTP or HTTPS API base URL without credentials, query parameters, or fragments.';
const VENDOR_ERROR = 'AppFlowy hosted services are disabled. Use your own AI endpoint.';
const MODEL_ERROR = "Enter the endpoint's chat model ID.";

function failure(run: () => unknown): { kind?: string; message: string } | null {
  try {
    run();
    return null;
  } catch (error) {
    return error as { kind?: string; message: string };
  }
}

describe('validateEndpoint', () => {
  it('accepts http(s) origins with or without an API path', () => {
    for (const url of ['http://localhost:8000/v1', 'https://ai.internal', 'https://ai.internal/api/v1/', 'HTTP://Example.COM:443/v1']) {
      expect(failure(() => validateEndpoint(url, 'llama3'))).toBeNull();
    }
  });

  it('rejects relative, non-http, credential, query and fragment URLs', () => {
    for (const url of [
      '',
      'localhost:8000/v1',
      '/v1',
      'ftp://ai.internal',
      'http:///v1',
      'https://user:pass@ai.internal/v1',
      'https://user@ai.internal/v1',
      'https://ai.internal/v1?',
      'https://ai.internal/v1?key=1',
      'https://ai.internal/v1#chat',
      'https://ai.internal:notaport/v1',
    ]) {
      expect(failure(() => validateEndpoint(url, 'llama3')), url).toMatchObject({ kind: 'format', message: URL_ERROR });
    }
  });

  it('rejects vendor hosts and their subdomains, ignoring case and trailing dots', () => {
    for (const url of ['https://appflowy.com/v1', 'https://AI.AppFlowy.Cloud', 'https://appflowy.io../v1', 'http://x.appflowy.com.:8080']) {
      expect(failure(() => validateEndpoint(url, 'm')), url).toMatchObject({ kind: 'format', message: VENDOR_ERROR });
    }
    expect(failure(() => validateEndpoint('https://appflowy.com.internal/v1', 'm'))).toBeNull();
    expect(failure(() => validateEndpoint('https://myappflowy.com/v1', 'm'))).toBeNull();
    expect(isEndpointVendorHost('appflowy.cloud...')).toBe(true);
  });

  it('requires a chat model after the URL checks', () => {
    expect(failure(() => validateEndpoint('https://ai.internal/v1', '   '))).toMatchObject({ kind: 'format', message: MODEL_ERROR });
    expect(failure(() => validateEndpoint('ftp://ai.internal', ''))?.message).toBe(URL_ERROR);
  });
});

describe('endpointApiUrl', () => {
  it('strips every trailing slash before the resource', () => {
    expect(endpointApiUrl('http://localhost:8000/v1', 'chat/completions')).toBe('http://localhost:8000/v1/chat/completions');
    expect(endpointApiUrl('http://localhost:8000/v1///', 'chat/completions')).toBe('http://localhost:8000/v1/chat/completions');
    expect(endpointApiUrl('https://ai.internal', 'embeddings')).toBe('https://ai.internal/embeddings');
  });
});

describe('completionTestBody', () => {
  it('matches the Dart jsonEncode output', () => {
    expect(completionTestBody('gpt-x')).toBe(
      '{"model":"gpt-x","stream":false,"messages":[{"role":"user","content":"Reply with OK."}]}',
    );
  });
});

describe('parseCompletionBody', () => {
  it('accepts a completion with choices', () => {
    expect(failure(() => parseCompletionBody('{"choices":[{"message":{"content":"OK"}}]}'))).toBeNull();
  });

  it('reports an empty or missing choices list', () => {
    for (const body of ['{"choices":[]}', '{}', '{"choices":null}']) {
      expect(failure(() => parseCompletionBody(body))).toMatchObject({
        kind: 'format',
        message: 'Endpoint returned no chat completion.',
      });
    }
  });

  it('throws a JSON syntax error for non-JSON bodies', () => {
    expect(failure(() => parseCompletionBody('<html>'))).toBeInstanceOf(SyntaxError);
    expect(failure(() => parseCompletionBody(''))).toBeInstanceOf(SyntaxError);
  });

  it('treats non-object bodies and a non-list choices field as type errors', () => {
    for (const body of ['[]', '"OK"', 'null', '{"choices":"OK"}']) {
      expect(failure(() => parseCompletionBody(body))?.kind, body).toBe('other');
    }
  });
});

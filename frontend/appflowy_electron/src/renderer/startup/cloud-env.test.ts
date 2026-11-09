import { describe, expect, it } from 'vitest';
import { AuthenticatorType, configurationFromUri } from './cloud-env';

// Reference values from the Flutter app (docs/parity/01-startup-auth.md §4).
describe('configurationFromUri', () => {
  it('builds the self-hosted configuration exactly as Dart does', () => {
    expect(configurationFromUri(AuthenticatorType.AppFlowyCloudSelfHost, 'http://collaboration.example.com:8080', 'http://collaboration.example.com:8080')).toEqual({
      base_url: 'http://collaboration.example.com:8080',
      ws_base_url: 'ws://collaboration.example.com:8080/ws/v1',
      gotrue_url: 'http://collaboration.example.com:8080/gotrue',
      enable_sync_trace: false,
      base_web_domain: 'http://collaboration.example.com:8080',
    });
  });

  it('uses wss for https and omits a default port', () => {
    const config = configurationFromUri(AuthenticatorType.AppFlowyCloudSelfHost, 'https://appflowy.internal', '');
    expect(config.ws_base_url).toBe('wss://appflowy.internal/ws/v1');
  });
});

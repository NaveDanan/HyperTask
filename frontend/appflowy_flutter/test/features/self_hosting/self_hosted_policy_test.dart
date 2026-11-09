import 'dart:io';
import 'package:appflowy/core/config/kv.dart';
import 'package:appflowy/core/config/kv_keys.dart';
import 'package:appflowy/env/cloud_env.dart';
import 'package:appflowy/env/self_hosted_policy.dart';
import 'package:appflowy/startup/startup.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late _MemoryStorage storage;
  setUp(() {
    storage = _MemoryStorage();
    getIt.registerSingleton<KeyValueStorage>(storage);
  });
  tearDown(() async {
    await getIt.reset();
  });
  test('fresh settings select local with no server URLs', () async {
    final env = await AppFlowyCloudSharedEnv.fromEnv();
    expect(env.authenticatorType, AuthenticatorType.local);
    expect(env.appflowyCloudConfig.isValid, false);
    expect(await getAppFlowyCloudUrl(), '');
  });
  test('saved vendor login never restores hosted service', () async {
    await storage.set(KVKeys.kCloudType, '2');
    await storage.set(
      KVKeys.kAppflowyCloudBaseURL,
      'https://beta.appflowy.cloud',
    );
    expect(await getAuthenticatorType(), AuthenticatorType.local);
    expect(await getAppFlowyCloudUrl(), '');
  });
  test('vendor URL pretending to be selfhost is rejected', () async {
    await storage.set(KVKeys.kCloudType, '3');
    await storage.set(KVKeys.kAppflowyCloudBaseURL, 'https://appflowy.com.');
    expect(await getAuthenticatorType(), AuthenticatorType.local);
  });
  test('explicit owned server persists and builds TLS websocket/auth URLs',
      () async {
    await useAppFlowyBetaCloudWithURL(
      'https://appflowy.internal',
      AuthenticatorType.appflowyCloudSelfHost,
    );
    final env = await AppFlowyCloudSharedEnv.fromEnv();
    expect(env.authenticatorType, AuthenticatorType.appflowyCloudSelfHost);
    expect(
      env.appflowyCloudConfig.ws_base_url,
      'wss://appflowy.internal/ws/v1',
    );
    expect(
      env.appflowyCloudConfig.gotrue_url,
      'https://appflowy.internal/gotrue',
    );
  });
  test('server validation rejects vendor and credential-bearing origins', () {
    for (final value in [
      'https://BETA.APPFLOWY.CLOUD',
      'https://appflowy.com.',
      'https://u:p@internal',
      'https://internal/path',
      'ftp://internal',
    ]) {
      expect(
        () => SelfHostedPolicy.validateServerUrl(value),
        throwsFormatException,
      );
    }
    SelfHostedPolicy.validateServerUrl('http://collaboration.example.com:8080');
    SelfHostedPolicy.validateServerUrl('https://appflowy.com.internal');
  });
  test('redirects cannot escape to a hosted AppFlowy service', () async {
    final previous = HttpOverrides.current;
    SelfHostedPolicy.installNetworkPolicy();
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final client = HttpClient();
    final serving = server.first.then((request) async {
      request.response.statusCode = HttpStatus.found;
      request.response.headers
          .set(HttpHeaders.locationHeader, 'https://beta.appflowy.cloud/api');
      await request.response.close();
    });
    try {
      final request =
          await client.getUrl(Uri.parse('http://127.0.0.1:${server.port}'));
      await expectLater(request.close(), throwsA(isA<HttpException>()));
      await serving;
    } finally {
      client.close(force: true);
      await server.close(force: true);
      HttpOverrides.global = previous;
    }
  });
  test('network policy blocks vendor before connection', () async {
    final previous = HttpOverrides.current;
    SelfHostedPolicy.installNetworkPolicy();
    final client = HttpClient();
    try {
      await expectLater(
        client.getUrl(Uri.parse('https://beta.appflowy.cloud/api')),
        throwsA(isA<HttpException>()),
      );
    } finally {
      client.close(force: true);
      HttpOverrides.global = previous;
    }
  });
}

class _MemoryStorage implements KeyValueStorage {
  final Map<String, String> values = {};
  @override
  Future<void> set(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<String?> get(String key) async => values[key];
  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }

  @override
  Future<void> clear() async => values.clear();
  @override
  Future<T?> getWithFormat<T>(String key, T Function(String) formatter) async {
    final value = values[key];
    return value == null ? null : formatter(value);
  }
}

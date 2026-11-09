import 'dart:io';

import 'package:appflowy/env/self_hosted_policy.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const fixtureRoot = 'test/features/self_hosting/fixtures';
  late HttpServer server;
  late HttpOverrides? previous;

  setUp(() async {
    previous = HttpOverrides.current;
    final serverContext = SecurityContext()
      ..useCertificateChain('$fixtureRoot/localhost-cert.pem')
      ..usePrivateKey('$fixtureRoot/localhost-key.pem');
    server = await HttpServer.bindSecure(
      InternetAddress.loopbackIPv4,
      0,
      serverContext,
    );
    server.listen((request) async {
      request.response.write('encrypted response');
      await request.response.close();
    }, onError: (Object error) {
      // An untrusted or plain-text client is intentionally rejected.
    });
    SelfHostedPolicy.installNetworkPolicy();
  });

  tearDown(() async {
    await server.close(force: true);
    HttpOverrides.global = previous;
  });

  test('direct HTTPS uses TLS with the supplied trusted context', () async {
    final context = SecurityContext()
      ..setTrustedCertificates('$fixtureRoot/localhost-cert.pem');
    final client = HttpClient(context: context)
      ..connectionTimeout = const Duration(seconds: 3);
    try {
      final request = await client.getUrl(
        Uri.parse('https://127.0.0.1:${server.port}/'),
      );
      final response = await request.close();
      expect(response.statusCode, HttpStatus.ok);
      expect(response.certificate, isNotNull);
      await response.drain<void>();
    } finally {
      client.close(force: true);
    }
  });

  test('direct HTTPS still rejects an untrusted certificate', () async {
    final client = HttpClient(context: SecurityContext())
      ..connectionTimeout = const Duration(seconds: 3);
    try {
      await expectLater(
        () async {
          final request = await client.getUrl(
            Uri.parse('https://127.0.0.1:${server.port}/'),
          );
          await request.close();
        },
        throwsA(isA<HandshakeException>()),
      );
    } finally {
      client.close(force: true);
    }
  });
}

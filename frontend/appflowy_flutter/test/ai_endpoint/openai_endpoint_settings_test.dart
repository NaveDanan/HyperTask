import 'dart:convert';
import 'dart:io';
import 'package:appflowy/ai/service/openai_endpoint_settings.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Rejects credential-bearing URLs and hosted AppFlowy endpoints', () {
    for (final url in [
      'https://beta.appflowy.cloud/v1',
      'https://appflowy.io/v1',
      'https://appflowy.com/v1',
      'https://appflowy.com./v1',
      'https://user:secret@localhost/v1',
      'http://localhost/v1?token=secret',
      'ftp://localhost/v1',
    ]) {
      expect(
        () => OpenAIEndpointSettings(baseUrl: url, model: 'model').validate(),
        throwsFormatException,
      );
    }
  });
  test('Preserves user-supplied API prefix and encrypted key serialization',
      () {
    const settings = OpenAIEndpointSettings(
      baseUrl: 'http://localhost:8000/api/v1/',
      model: 'local-model',
      protectedKey: 'encrypted',
      enabled: true,
    );
    settings.validate();
    expect(
      settings.apiUri('chat/completions').toString(),
      'http://localhost:8000/api/v1/chat/completions',
    );
    expect(
      OpenAIEndpointSettings.fromJson(settings.toJson()).protectedKey,
      'encrypted',
    );
    expect(settings.toJson().containsKey('api_key'), isFalse);
  });
  test(
    'Windows DPAPI encrypts and restores a credential',
    () {
      final protected = encryptKey('test-only-credential');
      expect(protected, isNot(contains('test-only-credential')));
      expect(decryptKey(protected), 'test-only-credential');
    },
    skip: !Platform.isWindows,
  );
  test('Empty credentials remain optional', () {
    expect(encryptKey(''), '');
    expect(decryptKey(''), '');
  });

  test('Tests exactly the configured API prefix and model', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final requests = <String>[];
    server.listen((request) async {
      requests.add(request.uri.path);
      final body = jsonDecode(await utf8.decoder.bind(request).join())
          as Map<String, dynamic>;
      expect(body['model'], 'test-model');
      expect(body['stream'], false);
      expect(request.headers.value('Authorization'), isNull);
      request.response.headers.contentType = ContentType.json;
      request.response.write(
        jsonEncode({
          'choices': [
            {
              'message': {'content': 'OK'},
            },
          ],
        }),
      );
      await request.response.close();
    });
    try {
      await OpenAIEndpointSettings(
        baseUrl: 'http://127.0.0.1:${server.port}/api/v1/',
        model: 'test-model',
      ).testConnection();
      expect(requests, ['/api/v1/chat/completions']);
    } finally {
      await server.close(force: true);
    }
  });
  test('Refuses an endpoint redirect instead of forwarding requests', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var requests = 0;
    server.listen((request) async {
      requests++;
      await request.drain<void>();
      request.response.statusCode = 302;
      request.response.headers.set('Location', '/other-service');
      await request.response.close();
    });
    try {
      await expectLater(
        OpenAIEndpointSettings(
          baseUrl: 'http://127.0.0.1:${server.port}/v1',
          model: 'test-model',
        ).testConnection(),
        throwsStateError,
      );
      expect(requests, 1);
    } finally {
      await server.close(force: true);
    }
  });
}

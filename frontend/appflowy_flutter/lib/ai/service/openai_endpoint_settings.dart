import 'dart:convert';
import 'dart:ffi';
import 'dart:io';

import 'package:appflowy_backend/dispatch/dispatch.dart';
import 'package:appflowy_backend/protobuf/flowy-ai/protobuf.dart';
import 'package:ffi/ffi.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';
import 'package:win32/win32.dart';

const openAIConfigPrefix = 'openai+file:';

/// Contains encrypted credential material, never the plaintext key.
class OpenAIEndpointSettings {
  factory OpenAIEndpointSettings.fromJson(Map<String, dynamic> json) =>
      OpenAIEndpointSettings(
        baseUrl: json['base_url'] as String,
        model: json['model'] as String,
        embeddingModel: json['embedding_model'] as String? ?? '',
        imageModel: json['image_model'] as String? ?? '',
        protectedKey: json['protected_key'] as String? ?? '',
        enabled: json['enabled'] as bool? ?? false,
      );
  const OpenAIEndpointSettings({
    required this.baseUrl,
    required this.model,
    this.embeddingModel = '',
    this.imageModel = '',
    this.protectedKey = '',
    this.enabled = false,
  });
  final String baseUrl;
  final String model;
  final String embeddingModel;
  final String imageModel;
  final String protectedKey;
  final bool enabled;
  Map<String, dynamic> toJson() => {
        'base_url': baseUrl,
        'model': model,
        'embedding_model': embeddingModel,
        'image_model': imageModel,
        'protected_key': protectedKey,
        'enabled': enabled,
      };

  void validate() {
    final uri = Uri.tryParse(baseUrl);
    if (uri == null ||
        !['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw const FormatException(
        'Enter an absolute HTTP or HTTPS API base URL without credentials, query parameters, or fragments.',
      );
    }
    var host = uri.host.toLowerCase();
    while (host.endsWith('.')) {
      host = host.substring(0, host.length - 1);
    }
    if (['appflowy.com', 'appflowy.io', 'appflowy.cloud'].any(
      (domain) => host == domain || host.endsWith('.$domain'),
    )) {
      throw const FormatException(
        'AppFlowy hosted services are disabled. Use your own AI endpoint.',
      );
    }
    if (model.trim().isEmpty) {
      throw const FormatException('Enter the endpoint\'s chat model ID.');
    }
  }

  Uri apiUri(String resource) =>
      Uri.parse('${baseUrl.replaceAll(RegExp(r'/+$'), '')}/$resource');

  static Future<OpenAIEndpointSettings?> load() async {
    final result = await AIEventGetLocalAISetting().send();
    final pointer = result.fold((pb) => pb.serverUrl, (_) => '');
    if (!pointer.startsWith(openAIConfigPrefix)) return null;
    final file = File(pointer.substring(openAIConfigPrefix.length));
    if (!await file.exists()) return null;
    return OpenAIEndpointSettings.fromJson(
      jsonDecode(await file.readAsString()) as Map<String, dynamic>,
    );
  }

  Future<void> save() async {
    validate();
    final directory = Directory(
      path.join((await getApplicationSupportDirectory()).path, 'local_ai'),
    );
    await directory.create(recursive: true);
    final file = File(path.join(directory.path, 'openai-endpoint.json'));
    await file.writeAsString(jsonEncode(toJson()), flush: true);
    final result = await AIEventUpdateLocalAISetting(
      LocalAISettingPB(
        serverUrl: '$openAIConfigPrefix${file.path}',
        globalChatModel: model,
        embeddingModelName: embeddingModel,
      ),
    ).send();
    result.fold((_) {}, (error) {
      throw StateError('Could not apply AI endpoint settings: ${error.msg}');
    });
  }

  Future<void> testConnection() async {
    validate();
    final client = http.Client();
    try {
      // No redirects: a credential must never travel to an unconfigured host.
      final request = http.Request('POST', apiUri('chat/completions'))
        ..followRedirects = false
        ..headers['Content-Type'] = 'application/json'
        ..body = jsonEncode({
          'model': model,
          'stream': false,
          'messages': [
            {'role': 'user', 'content': 'Reply with OK.'},
          ],
        });
      final key = decryptKey(protectedKey);
      if (key.isNotEmpty) request.headers['Authorization'] = 'Bearer $key';
      final response = await client.send(request).timeout(
            const Duration(seconds: 30),
          );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError(
          'Endpoint returned HTTP ${response.statusCode}. Check the base URL, credential, and model ID.',
        );
      }
      final body = jsonDecode(
        await response.stream.bytesToString().timeout(
              const Duration(seconds: 30),
            ),
      ) as Map<String, dynamic>;
      final choices = body['choices'] as List<dynamic>?;
      if (choices == null || choices.isEmpty) {
        throw const FormatException('Endpoint returned no chat completion.');
      }
    } on http.ClientException {
      throw StateError(
        'Cannot reach the endpoint. Check the network and TLS certificate.',
      );
    } finally {
      client.close();
    }
  }
}

String encryptKey(String value) {
  if (value.isEmpty) return '';
  return base64Encode(_protect(utf8.encode(value), decrypt: false));
}

String decryptKey(String value) {
  if (value.isEmpty) return '';
  return utf8.decode(_protect(base64Decode(value), decrypt: true));
}

List<int> _protect(List<int> bytes, {required bool decrypt}) {
  if (!Platform.isWindows) {
    throw UnsupportedError(
      'Saved API credentials in this build require Windows.',
    );
  }
  final input = calloc<CRYPT_INTEGER_BLOB>();
  final output = calloc<CRYPT_INTEGER_BLOB>();
  final data = calloc<Uint8>(bytes.length);
  data.asTypedList(bytes.length).setAll(0, bytes);
  input.ref
    ..cbData = bytes.length
    ..pbData = data;
  try {
    final success = decrypt
        ? CryptUnprotectData(
            input,
            nullptr,
            nullptr,
            nullptr,
            nullptr,
            1,
            output,
          )
        : CryptProtectData(
            input,
            nullptr,
            nullptr,
            nullptr,
            nullptr,
            1,
            output,
          );
    if (success == 0) {
      throw StateError(
        'Windows could not ${decrypt ? 'read' : 'protect'} the AI credential. Re-enter the key.',
      );
    }
    return List<int>.from(output.ref.pbData.asTypedList(output.ref.cbData));
  } finally {
    if (output.ref.pbData != nullptr) LocalFree(output.ref.pbData);
    data.asTypedList(bytes.length).fillRange(0, bytes.length, 0);
    calloc.free(data);
    calloc.free(input);
    calloc.free(output);
  }
}

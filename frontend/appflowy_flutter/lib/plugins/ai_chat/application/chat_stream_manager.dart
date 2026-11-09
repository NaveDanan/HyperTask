import 'package:appflowy/ai/service/local_ai_sources.dart';
import 'package:appflowy/plugins/ai_chat/application/chat_message_service.dart';
import 'package:appflowy_backend/protobuf/flowy-error/code.pb.dart';
import 'dart:async';

import 'package:appflowy/ai/ai.dart';
import 'package:appflowy_backend/dispatch/dispatch.dart';
import 'package:appflowy_backend/protobuf/flowy-ai/entities.pb.dart';
import 'package:appflowy_backend/protobuf/flowy-error/errors.pb.dart';
import 'package:appflowy_result/appflowy_result.dart';
import 'package:fixnum/fixnum.dart';

import 'chat_message_stream.dart';

/// Manages chat streaming operations
class ChatStreamManager {
  ChatStreamManager(this.chatId);
  final String chatId;

  AnswerStream? answerStream;
  QuestionStream? questionStream;

  /// Dispose of all streams
  Future<void> dispose() async {
    await answerStream?.dispose();
    answerStream = null;

    await questionStream?.dispose();
    questionStream = null;
  }

  /// Prepare streams for a new message
  Future<void> prepareStreams() async {
    await dispose();
    answerStream = AnswerStream();
    questionStream = QuestionStream();
  }

  /// Build the payload for a streaming message
  StreamChatPayloadPB buildStreamPayload(
    String message,
    PredefinedFormat? format,
    String? promptId,
  ) {
    final payload = StreamChatPayloadPB(
      chatId: chatId,
      message: message,
      messageType: ChatMessageTypePB.User,
      questionStreamPort: Int64(questionStream!.nativePort),
      answerStreamPort: Int64(answerStream!.nativePort),
    );

    if (format != null) {
      payload.format = format.toPB();
    }

    if (promptId != null) {
      payload.promptId = promptId;
    }

    return payload;
  }

  /// Send a streaming message request to the server
  Future<FlowyResult<ChatMessagePB, FlowyError>> sendStreamRequest(
    String message,
    PredefinedFormat? format,
    String? promptId, {
    Map<String, dynamic>? metadata,
  }) async {
    try {
      final settings =
          await AIEventGetChatSettings(ChatId(value: chatId)).send();
      final ids = settings.fold((pb) => pb.ragIds, (_) => <String>[]);
      await prepareLocalAISources(chatId, ids);
      final attachments = await metadataPBFromMetadata(metadata);
      for (final attachment in attachments) {
        final result = attachment.source == appflowySource
            ? await AIEventCreateChatContext(
                CreateChatContextPB(
                  chatId: chatId,
                  contentType: 'text',
                  text: attachment.data.isEmpty
                      ? 'This page is empty.'
                      : attachment.data,
                  metadata: {
                    'id': 'attachment:${attachment.id}',
                    'name': attachment.name,
                  },
                ),
              ).send()
            : await AIEventChatWithFile(
                ChatFilePB(chatId: chatId, filePath: attachment.data),
              ).send();
        result.fold((_) {}, (error) {
          throw StateError(error.msg);
        });
      }
    } catch (error) {
      return FlowyResult.failure(
        FlowyError(
          code: ErrorCode.LocalAIError,
          msg: error is StateError
              ? error.message.toString()
              : 'Could not prepare the selected local sources.',
        ),
      );
    }
    final payload = buildStreamPayload(message, format, promptId);
    return AIEventStreamMessage(payload).send();
  }

  /// Build the payload for regenerating a response
  RegenerateResponsePB buildRegeneratePayload(
    Int64 answerMessageId,
    PredefinedFormat? format,
    AIModelPB? model,
  ) {
    final payload = RegenerateResponsePB(
      chatId: chatId,
      answerMessageId: answerMessageId,
      answerStreamPort: Int64(answerStream!.nativePort),
    );

    if (format != null) {
      payload.format = format.toPB();
    }

    if (model != null) {
      payload.model = model;
    }

    return payload;
  }

  /// Send a request to regenerate a response
  Future<FlowyResult<dynamic, FlowyError>> sendRegenerateRequest(
    Int64 answerMessageId,
    PredefinedFormat? format,
    AIModelPB? model,
  ) async {
    final payload = buildRegeneratePayload(answerMessageId, format, model);
    return AIEventRegenerateResponse(payload).send();
  }

  /// Stop the current streaming message
  Future<void> stopStream() async {
    if (answerStream == null) {
      return;
    }

    final payload = StopStreamPB(chatId: chatId);
    await AIEventStopStream(payload).send();
  }

  /// Check if the answer stream has started
  bool get hasAnswerStreamStarted =>
      answerStream != null && answerStream!.hasStarted;

  Future<void> disposeAnswerStream() async {
    if (answerStream == null) {
      return;
    }

    await answerStream!.dispose();
    answerStream = null;
  }
}

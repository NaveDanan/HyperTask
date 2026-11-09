import 'package:appflowy/workspace/application/settings/share/export_service.dart';
import 'package:appflowy/workspace/application/view/view_ext.dart';
import 'package:appflowy/workspace/application/view/view_service.dart';
import 'package:appflowy_backend/dispatch/dispatch.dart';
import 'package:appflowy_backend/protobuf/flowy-ai/protobuf.dart';
import 'package:appflowy_backend/protobuf/flowy-document/protobuf.dart';

/// Exports selected sources from the local workspace into the local text index.
Future<void> prepareLocalAISources(String objectId, List<String> ids) async {
  for (final id in ids.toSet()) {
    final view = (await ViewBackendService.getView(id)).toNullable();
    String? text;
    if (view?.layout.isDatabaseView ?? false) {
      final result = await BackendExportService.exportDatabaseAsCSV(id);
      text = result.fold((pb) => pb.data, (_) => null);
    } else {
      final result = await DocumentEventGetDocumentText(
        OpenDocumentPayloadPB(documentId: id),
      ).send();
      text = result.fold((pb) => pb.text, (_) => null);
    }
    if (text == null) {
      throw StateError(
        'A selected source cannot be read. Select a document or database page, or attach a text export.',
      );
    }
    final stored = await AIEventCreateChatContext(
      CreateChatContextPB(
        chatId: objectId,
        contentType: 'text',
        text: text.isEmpty ? 'This page is empty.' : text,
        metadata: {'id': id, 'name': view?.name ?? 'Page $id'},
      ),
    ).send();
    stored.fold((_) {}, (error) {
      throw StateError(error.msg);
    });
  }
}

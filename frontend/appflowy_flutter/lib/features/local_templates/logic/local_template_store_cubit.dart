import 'package:appflowy/features/local_templates/data/local_template_import_service.dart';
import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:appflowy/features/local_templates/data/local_template_repository.dart';
import 'package:appflowy/features/local_templates/logic/local_template_store_state.dart';
import 'package:appflowy_backend/log.dart';
import 'package:bloc/bloc.dart';

class LocalTemplateStoreCubit extends Cubit<LocalTemplateStoreState> {
  LocalTemplateStoreCubit({
    required LocalTemplateRepository repository,
    required LocalTemplateImporter importer,
    required this.userId,
    required Future<String> Function() resolveParentViewId,
  })  : _repository = repository,
        _importer = importer,
        _resolveParentViewId = resolveParentViewId,
        super(const LocalTemplateStoreState());

  final LocalTemplateRepository _repository;
  final LocalTemplateImporter _importer;

  /// Account the store is open for. Used to attribute failures in logs.
  final String userId;

  /// Top-level pages are created under the current workspace id, as the
  /// sidebar does. Resolved at import time so a workspace switch is honoured.
  final Future<String> Function() _resolveParentViewId;

  Future<void> load() async {
    try {
      final manifest = await _repository.loadManifest();
      if (isClosed) {
        return;
      }
      emit(
        state.copyWith(
          status: LocalTemplateStoreStatus.ready,
          manifest: manifest,
          message: () => null,
        ),
      );
    } catch (error, stackTrace) {
      Log.error('Failed to load local templates', error, stackTrace);
      if (isClosed) {
        return;
      }
      emit(
        state.copyWith(
          status: LocalTemplateStoreStatus.failure,
          message: () => 'Could not read the bundled template store.',
        ),
      );
    }
  }

  void selectCategory(String? categoryId) {
    emit(state.copyWith(selectedCategoryId: () => categoryId));
  }

  void search(String query) {
    emit(state.copyWith(query: query));
  }

  void clearMessage() {
    emit(state.copyWith(message: () => null, lastImportedName: () => null));
  }

  /// Imports one available template. Unavailable templates and templates
  /// already importing are ignored.
  Future<void> importTemplate(LocalTemplateEntry entry) async {
    if (!entry.isAvailable || state.isImporting(entry)) {
      return;
    }
    emit(
      state.copyWith(
        importingViewIds: {...state.importingViewIds, entry.viewId},
        message: () => null,
        lastImportedName: () => null,
      ),
    );

    String? importedName;
    String? errorMessage;
    try {
      final parentViewId = await _resolveParentViewId();
      final result = await _importer.importTemplate(
        entry: entry,
        parentViewId: parentViewId,
      );
      result.fold(
        (_) => importedName = entry.name,
        (error) {
          Log.error(
            'Import of ${entry.publishName} for user $userId failed: ${error.msg}',
          );
          errorMessage = 'Could not import "${entry.name}".';
        },
      );
    } catch (error, stackTrace) {
      Log.error(
        'Import of ${entry.publishName} for user $userId failed',
        error,
        stackTrace,
      );
      errorMessage = 'Could not import "${entry.name}".';
    }

    if (isClosed) {
      return;
    }
    emit(
      state.copyWith(
        importingViewIds: {...state.importingViewIds}..remove(entry.viewId),
        lastImportedName: () => importedName,
        message: () => errorMessage,
      ),
    );
  }
}

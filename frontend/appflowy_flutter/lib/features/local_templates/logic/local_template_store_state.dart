import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:equatable/equatable.dart';

enum LocalTemplateStoreStatus { loading, ready, failure }

class LocalTemplateStoreState extends Equatable {
  const LocalTemplateStoreState({
    this.status = LocalTemplateStoreStatus.loading,
    this.manifest,
    this.selectedCategoryId,
    this.query = '',
    this.importingViewIds = const {},
    this.lastImportedName,
    this.message,
  });

  final LocalTemplateStoreStatus status;
  final LocalTemplateManifest? manifest;

  /// Null means every category.
  final String? selectedCategoryId;
  final String query;

  /// Template view ids with an import in flight.
  final Set<String> importingViewIds;

  /// Name of the last template imported successfully, for feedback.
  final String? lastImportedName;

  /// Last load or import error, for feedback.
  final String? message;

  List<LocalTemplateEntry> get visibleTemplates =>
      manifest?.filter(categoryId: selectedCategoryId, query: query) ??
      const [];

  bool isImporting(LocalTemplateEntry entry) =>
      importingViewIds.contains(entry.viewId);

  LocalTemplateStoreState copyWith({
    LocalTemplateStoreStatus? status,
    LocalTemplateManifest? manifest,
    String? Function()? selectedCategoryId,
    String? query,
    Set<String>? importingViewIds,
    String? Function()? lastImportedName,
    String? Function()? message,
  }) {
    return LocalTemplateStoreState(
      status: status ?? this.status,
      manifest: manifest ?? this.manifest,
      selectedCategoryId: selectedCategoryId != null
          ? selectedCategoryId()
          : this.selectedCategoryId,
      query: query ?? this.query,
      importingViewIds: importingViewIds ?? this.importingViewIds,
      lastImportedName:
          lastImportedName != null ? lastImportedName() : this.lastImportedName,
      message: message != null ? message() : this.message,
    );
  }

  @override
  List<Object?> get props => [
        status,
        manifest,
        selectedCategoryId,
        query,
        importingViewIds,
        lastImportedName,
        message,
      ];
}

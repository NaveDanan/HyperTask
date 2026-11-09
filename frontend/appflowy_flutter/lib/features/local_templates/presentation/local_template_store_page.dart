import 'package:appflowy/features/local_templates/data/local_template_import_service.dart';
import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:appflowy/features/local_templates/data/local_template_repository.dart';
import 'package:appflowy/features/local_templates/logic/local_template_store_cubit.dart';
import 'package:appflowy/features/local_templates/logic/local_template_store_state.dart';
import 'package:appflowy/features/local_templates/presentation/local_template_card.dart';
import 'package:appflowy/user/application/user_service.dart';
import 'package:appflowy_backend/protobuf/flowy-user/protobuf.dart';
import 'package:flowy_infra_ui/flowy_infra_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

/// Browses and imports the downloaded template store.
///
/// Entry point: `LocalTemplateStorePage(user: userProfile)`. Templates are
/// imported under the current workspace, the same parent the sidebar uses for
/// top-level pages. Everything is read from the bundled assets, so it works
/// offline.
class LocalTemplateStorePage extends StatelessWidget {
  const LocalTemplateStorePage({
    super.key,
    required this.user,
  });

  final UserProfilePB user;

  @override
  Widget build(BuildContext context) {
    final repository = LocalTemplateRepository(
      source: const AssetLocalTemplateSource(),
    );
    return BlocProvider(
      create: (_) => LocalTemplateStoreCubit(
        repository: repository,
        importer: LocalTemplateImporter(repository: repository),
        userId: user.id.toString(),
        resolveParentViewId: _currentWorkspaceId,
      )..load(),
      child: _LocalTemplateStoreView(
        loadPreviewImage: repository.loadPreviewImage,
      ),
    );
  }
}

Future<String> _currentWorkspaceId() async {
  final result = await UserBackendService.getCurrentWorkspace();
  return result.fold(
    (workspace) => workspace.id,
    (error) => throw StateError('Current workspace not found: ${error.msg}'),
  );
}

class _LocalTemplateStoreView extends StatelessWidget {
  const _LocalTemplateStoreView({required this.loadPreviewImage});

  final LocalTemplatePreviewImageLoader loadPreviewImage;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BlocListener<LocalTemplateStoreCubit, LocalTemplateStoreState>(
        listenWhen: (previous, current) =>
            previous.lastImportedName != current.lastImportedName ||
            previous.message != current.message,
        listener: (context, state) {
          final messenger = ScaffoldMessenger.of(context);
          final imported = state.lastImportedName;
          final message = state.message;
          if (imported != null) {
            messenger.showSnackBar(
              SnackBar(content: Text('Imported "$imported".')),
            );
          } else if (message != null) {
            messenger.showSnackBar(SnackBar(content: Text(message)));
          } else {
            return;
          }
          context.read<LocalTemplateStoreCubit>().clearMessage();
        },
        child: BlocBuilder<LocalTemplateStoreCubit, LocalTemplateStoreState>(
          builder: (context, state) {
            switch (state.status) {
              case LocalTemplateStoreStatus.loading:
                return const Center(child: CircularProgressIndicator());
              case LocalTemplateStoreStatus.failure:
                return Center(
                  child: FlowyText.regular(
                    state.message ?? 'Could not load templates.',
                  ),
                );
              case LocalTemplateStoreStatus.ready:
                return _ReadyBody(
                  state: state,
                  loadPreviewImage: loadPreviewImage,
                );
            }
          },
        ),
      ),
    );
  }
}

class _ReadyBody extends StatelessWidget {
  const _ReadyBody({
    required this.state,
    required this.loadPreviewImage,
  });

  final LocalTemplateStoreState state;
  final LocalTemplatePreviewImageLoader loadPreviewImage;

  @override
  Widget build(BuildContext context) {
    final manifest = state.manifest!;
    final inventory = manifest.inventory;
    final cubit = context.read<LocalTemplateStoreCubit>();
    final templates = state.visibleTemplates;

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FlowyText.semibold('Template store', fontSize: 20),
          const SizedBox(height: 4),
          FlowyText.regular(
            '${inventory.availableCount} of ${inventory.catalogCount} templates '
            'downloaded (${inventory.documentCount} documents, '
            '${inventory.databaseCount} databases). Works offline.',
            color: Theme.of(context).hintColor,
          ),
          const SizedBox(height: 16),
          FlowyTextField(
            hintText: 'Search templates',
            onChanged: cubit.search,
          ),
          const SizedBox(height: 12),
          _CategoryBar(
            categories: manifest.categories,
            selectedCategoryId: state.selectedCategoryId,
            onSelected: cubit.selectCategory,
          ),
          const SizedBox(height: 16),
          Expanded(
            child: templates.isEmpty
                ? Center(
                    child: FlowyText.regular('No templates match.'),
                  )
                : GridView.builder(
                    padding: const EdgeInsets.only(bottom: 24),
                    gridDelegate:
                        const SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 320,
                      mainAxisExtent: 270,
                      crossAxisSpacing: 16,
                      mainAxisSpacing: 16,
                    ),
                    itemCount: templates.length,
                    itemBuilder: (context, index) {
                      final entry = templates[index];
                      return LocalTemplateCard(
                        entry: entry,
                        importing: state.isImporting(entry),
                        onImport: () => cubit.importTemplate(entry),
                        loadPreviewImage: loadPreviewImage,
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _CategoryBar extends StatelessWidget {
  const _CategoryBar({
    required this.categories,
    required this.selectedCategoryId,
    required this.onSelected,
  });

  final List<LocalTemplateCategory> categories;
  final String? selectedCategoryId;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        _CategoryChip(
          label: 'All',
          selected: selectedCategoryId == null,
          onTap: () => onSelected(null),
        ),
        for (final category in categories)
          _CategoryChip(
            label: category.name,
            selected: selectedCategoryId == category.id,
            onTap: () => onSelected(category.id),
          ),
      ],
    );
  }
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return FlowyButton(
      useIntrinsicWidth: true,
      isSelected: selected,
      radius: BorderRadius.circular(16),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      text: FlowyText.regular(label),
      onTap: onTap,
    );
  }
}

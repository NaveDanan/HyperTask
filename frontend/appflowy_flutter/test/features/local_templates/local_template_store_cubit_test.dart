import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:appflowy/features/local_templates/data/local_template_repository.dart';
import 'package:appflowy/features/local_templates/logic/local_template_store_cubit.dart';
import 'package:appflowy/features/local_templates/logic/local_template_store_state.dart';
import 'package:appflowy_backend/protobuf/flowy-error/errors.pb.dart';
import 'package:appflowy_result/appflowy_result.dart';
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';

import 'local_template_test_support.dart';

void main() {
  late LocalTemplateManifest manifest;
  late FakeImportPages fakeImport;

  setUpAll(() async {
    manifest = await loadBundledManifest();
  });

  setUp(() {
    fakeImport = FakeImportPages();
  });

  LocalTemplateStoreCubit buildCubit({
    String workspaceId = 'workspace-1',
  }) {
    final repository =
        LocalTemplateRepository(source: FileLocalTemplateSource());
    return LocalTemplateStoreCubit(
      repository: repository,
      importer: fakeImporter(repository: repository, pages: fakeImport),
      userId: 'user-1',
      resolveParentViewId: () async => workspaceId,
    );
  }

  group('LocalTemplateStoreCubit', () {
    blocTest<LocalTemplateStoreCubit, LocalTemplateStoreState>(
      'loads the manifest and shows every catalog entry',
      build: buildCubit,
      act: (cubit) => cubit.load(),
      verify: (cubit) {
        expect(cubit.state.status, LocalTemplateStoreStatus.ready);
        expect(cubit.state.manifest?.templates, hasLength(52));
        expect(cubit.state.visibleTemplates, hasLength(52));
      },
    );

    blocTest<LocalTemplateStoreCubit, LocalTemplateStoreState>(
      'narrows visible templates by category and by query',
      build: buildCubit,
      seed: () => LocalTemplateStoreState(
        status: LocalTemplateStoreStatus.ready,
        manifest: manifest,
      ),
      act: (cubit) {
        cubit.selectCategory('31042f6f-9e91-4c3b-a50c-8a735127598f');
        cubit.search('tracker');
      },
      verify: (cubit) {
        final visible = cubit.state.visibleTemplates;
        expect(visible, isNotEmpty);
        expect(
          visible.every(
            (t) =>
                t.categoryNames.contains('Project Management') &&
                t.matchesQuery('tracker'),
          ),
          isTrue,
        );
      },
    );

    blocTest<LocalTemplateStoreCubit, LocalTemplateStoreState>(
      'imports an available template under the resolved workspace',
      build: buildCubit,
      seed: () => LocalTemplateStoreState(
        status: LocalTemplateStoreStatus.ready,
        manifest: manifest,
      ),
      act: (cubit) => cubit.importTemplate(
        entryNamed(manifest, 'Weekly-To-Do-List'),
      ),
      expect: () => [
        isA<LocalTemplateStoreState>()
            .having((s) => s.importingViewIds, 'importing', hasLength(1)),
        isA<LocalTemplateStoreState>()
            .having((s) => s.importingViewIds, 'importing', isEmpty)
            .having((s) => s.lastImportedName, 'imported', 'Weekly To-Do List')
            .having((s) => s.message, 'message', isNull),
      ],
      verify: (_) {
        expect(fakeImport.parentViewIds, ['workspace-1']);
        expect(fakeImport.itemBatches.single.single.name, 'Weekly To-Do List');
      },
    );

    blocTest<LocalTemplateStoreCubit, LocalTemplateStoreState>(
      'reports a backend failure without leaving the template importing',
      build: buildCubit,
      setUp: () {
        fakeImport.result =
            FlowyResult.failure(FlowyError(msg: 'backend down'));
      },
      seed: () => LocalTemplateStoreState(
        status: LocalTemplateStoreStatus.ready,
        manifest: manifest,
      ),
      act: (cubit) => cubit.importTemplate(
        entryNamed(manifest, 'Weekly-To-Do-List'),
      ),
      verify: (cubit) {
        expect(cubit.state.importingViewIds, isEmpty);
        expect(cubit.state.lastImportedName, isNull);
        expect(cubit.state.message, 'Could not import "Weekly To-Do List".');
      },
    );

    blocTest<LocalTemplateStoreCubit, LocalTemplateStoreState>(
      'ignores templates that have no payload',
      build: buildCubit,
      seed: () => LocalTemplateStoreState(
        status: LocalTemplateStoreStatus.ready,
        manifest: manifest,
      ),
      act: (cubit) => cubit.importTemplate(
        manifest.templates.firstWhere((t) => !t.isAvailable),
      ),
      expect: () => const <LocalTemplateStoreState>[],
      verify: (_) {
        expect(fakeImport.itemBatches, isEmpty);
      },
    );

    blocTest<LocalTemplateStoreCubit, LocalTemplateStoreState>(
      'shows a failure when the workspace cannot be resolved',
      build: () => LocalTemplateStoreCubit(
        repository: LocalTemplateRepository(source: FileLocalTemplateSource()),
        importer: fakeImporter(
          repository:
              LocalTemplateRepository(source: FileLocalTemplateSource()),
          pages: fakeImport,
        ),
        userId: 'user-1',
        resolveParentViewId: () async => throw StateError('no workspace'),
      ),
      seed: () => LocalTemplateStoreState(
        status: LocalTemplateStoreStatus.ready,
        manifest: manifest,
      ),
      act: (cubit) => cubit.importTemplate(
        entryNamed(manifest, 'Weekly-To-Do-List'),
      ),
      verify: (cubit) {
        expect(cubit.state.importingViewIds, isEmpty);
        expect(cubit.state.message, 'Could not import "Weekly To-Do List".');
        expect(fakeImport.itemBatches, isEmpty);
      },
    );
  });
}

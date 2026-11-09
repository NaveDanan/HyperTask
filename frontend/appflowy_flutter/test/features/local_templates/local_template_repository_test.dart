import 'dart:io';

import 'package:appflowy/features/local_templates/data/local_template_models.dart';
import 'package:appflowy/features/local_templates/data/local_template_repository.dart';
import 'package:flutter_test/flutter_test.dart';

import 'local_template_test_support.dart';

void main() {
  group('bundled manifest', () {
    late LocalTemplateManifest manifest;

    setUpAll(() async {
      manifest = await loadBundledManifest();
    });

    test('matches the published catalog inventory', () {
      expect(manifest.schemaVersion, 3);
      expect(manifest.fetchedAt, isNotNull);
      expect(manifest.templates, hasLength(52));
      expect(manifest.inventory.catalogCount, 52);
      expect(manifest.inventory.availableCount, 50);
      expect(manifest.inventory.unavailableCount, 2);
      expect(manifest.inventory.documentCount, 25);
      expect(manifest.inventory.databaseCount, 25);
    });

    test('lists all 15 catalog categories with names and ids', () {
      expect(manifest.categories, hasLength(15));
      final projectManagement = manifest.categoryById(
        '31042f6f-9e91-4c3b-a50c-8a735127598f',
      );
      expect(projectManagement?.name, 'Project Management');
      expect(projectManagement?.categoryType, 0);
      final ai = manifest.categories.firstWhere((c) => c.name == 'AI-powered');
      expect(ai.categoryType, 1);
    });

    test('keeps provenance for every entry', () {
      for (final entry in manifest.templates) {
        expect(entry.viewId, isNotEmpty, reason: entry.name);
        expect(entry.viewUrl, startsWith('https://appflowy.com/'));
        expect(entry.publishName, isNotEmpty, reason: entry.name);
        expect(entry.categoryIds, isNotEmpty, reason: entry.name);
        expect(entry.categoryIds, hasLength(entry.categoryNames.length));
      }
    });

    test('marks unavailable templates with a blocker and no payload', () {
      final unavailable = manifest.templates.where((t) => !t.isAvailable);
      expect(unavailable, hasLength(2));
      for (final entry in unavailable) {
        expect(entry.payloadPath, isNull, reason: entry.name);
        expect(entry.kind, isNull, reason: entry.name);
        expect(entry.blocker, isNotEmpty, reason: entry.name);
      }
    });

    test('every available payload exists on disk and has a checksum', () {
      final available = manifest.availableTemplates;
      expect(available, hasLength(50));
      for (final entry in available) {
        final file = File('assets/local_templates/${entry.payloadPath}');
        expect(file.existsSync(), isTrue, reason: entry.payloadPath);
        expect(entry.payloadSha256, hasLength(64), reason: entry.name);
        expect(entry.blocker, isNull, reason: entry.name);
      }
    });

    test('filters by category and by free text', () {
      final projects = manifest.filter(
        categoryId: '31042f6f-9e91-4c3b-a50c-8a735127598f',
      );
      expect(projects, isNotEmpty);
      expect(
        projects.every((t) => t.categoryNames.contains('Project Management')),
        isTrue,
      );

      final byName = manifest.filter(query: '  WEEKLY ');
      expect(byName.map((t) => t.name), contains('Weekly To-Do List'));

      final byCategoryName = manifest.filter(query: 'kanban');
      expect(byCategoryName, isNotEmpty);
      expect(
        byCategoryName.every((t) => t.matchesQuery('kanban')),
        isTrue,
      );
      expect(
        byCategoryName.any((t) => t.categoryNames.contains('Kanban')),
        isTrue,
        reason: 'category names are searchable',
      );

      expect(manifest.filter(query: 'no-such-template-xyz'), isEmpty);
    });
  });

  group('LocalTemplateRepository', () {
    test('loads the manifest once and caches it', () async {
      final source = FileLocalTemplateSource();
      final repository = LocalTemplateRepository(source: source);

      final first = await repository.loadManifest();
      final second = await repository.loadManifest();

      expect(identical(first, second), isTrue);
      expect(source.manifestReads, 1);
    });

    test('loads a payload on demand and returns the stored envelope', () async {
      final source = FileLocalTemplateSource();
      final repository = LocalTemplateRepository(source: source);
      final manifest = await repository.loadManifest();
      expect(source.payloadReads, isEmpty);

      final entry = entryNamed(manifest, 'Weekly-To-Do-List');
      final payload = await repository.loadPayload(entry);

      expect(source.payloadReads, [entry.payloadPath]);
      final data = payload['data'] as Map<String, dynamic>;
      expect(data['kind'], 'document');
      expect(data['publishName'], 'Weekly-To-Do-List');
    });

    test('refuses to load a payload for an unavailable template', () async {
      final repository = LocalTemplateRepository(
        source: FileLocalTemplateSource(),
      );
      final manifest = await repository.loadManifest();
      final unavailable = manifest.templates.firstWhere((t) => !t.isAvailable);

      expect(
        () => repository.loadPayload(unavailable),
        throwsA(isA<LocalTemplateUnavailableException>()),
      );
    });
  });
}

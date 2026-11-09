import 'package:flutter/services.dart';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:appflowy_ui/appflowy_ui.dart';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:appflowy/features/company_certificates/company_certificate_store.dart';
import 'package:appflowy/features/company_certificates/company_certificates_settings_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget certificateTestHost(Widget child) => MaterialApp(
      theme: ThemeData(fontFamily: 'Poppins'),
      builder: (context, child) => AppFlowyTheme(
          data: AppFlowyDefaultTheme().light(fontFamily: 'Poppins'),
          child: child!),
      home: Scaffold(body: child),
    );

void main() {
  const fixture = 'test/features/self_hosting/fixtures/localhost-cert.pem';
  late Directory directory;
  late CompanyCertificate certificate;
  late _FakePlatform platform;
  late CompanyCertificateStore store;

  setUpAll(() async {
    final bytes = await File('assets/google_fonts/Poppins/Poppins-Regular.ttf')
        .readAsBytes();
    final loader = FontLoader('Poppins')
      ..addFont(Future.value(ByteData.view(bytes.buffer)));
    await loader.load();
  });

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('appflowy-cert-test-');
    certificate = CompanyCertificate(
      subject: 'CN=Company Test CA',
      issuer: 'CN=Company Test CA',
      thumbprint: 'A' * 40,
      sha256: 'B' * 64,
      notBefore: DateTime.utc(2020),
      notAfter: DateTime.utc(2036),
      der: decodeCompanyCertificates(await File(fixture).readAsBytes()).single,
    );
    platform = _FakePlatform(certificate);
    store = CompanyCertificateStore(directory: directory, platform: platform);
  });

  tearDown(() async {
    // Only the temporary directory created by this test may be removed.
    final resolved = await directory.resolveSymbolicLinks();
    final tempRoot = await Directory.systemTemp.resolveSymbolicLinks();
    expect(resolved.startsWith('$tempRoot${Platform.pathSeparator}'), true);
    await directory.delete(recursive: true);
  });

  test('parses a PEM chain and DER without including private keys', () async {
    final pem = await File(fixture).readAsString();
    expect(
        decodeCompanyCertificates(Uint8List.fromList('$pem\n$pem'.codeUnits)),
        hasLength(2));
    expect(decodeCompanyCertificates(certificate.der).single, certificate.der);
    expect(
        () => decodeCompanyCertificates(
            Uint8List.fromList('-----BEGIN PRIVATE KEY-----secret'.codeUnits)),
        throwsFormatException);
    expect(
        () => decodeCompanyCertificates(Uint8List(0)), throwsFormatException);
    expect(
        () => decodeCompanyCertificates(
            Uint8List.fromList('-----BEGIN UNKNOWN-----'.codeUnits)),
        throwsFormatException);
  });

  test('inspection does not trust a certificate', () async {
    expect(await store.inspectFile(File(fixture)), hasLength(1));
    expect(platform.installs, 0);
    expect(await store.list(), isEmpty);
  });

  test('import persists metadata and duplicate imports do not change ownership',
      () async {
    await store.importCertificate(certificate);
    await store.importCertificate(certificate);
    final saved = (await store.list()).single;
    expect(saved.subject, certificate.subject);
    expect(saved.der, certificate.der);
    expect(saved.installedByApp, true);
    expect(platform.installs, 1);
    await store.restoreTrust();
    await store.removeCertificate(saved);
    expect(platform.removes, 1);
    expect(await store.list(), isEmpty);
  });

  test('a pre-existing Windows root stays trusted when removed from the app',
      () async {
    platform.alreadyInstalled = true;
    await store.importCertificate(certificate);
    final saved = (await store.list()).single;
    expect(saved.installedByApp, false);
    await store.removeCertificate(saved);
    expect(platform.removes, 0);
  });

  test('rejects invalid certificate identity before changing trust', () async {
    final invalid = CompanyCertificate.fromJson(
        {...certificate.toJson(), 'thumbprint': '../root'});
    await expectLater(store.importCertificate(invalid), throwsFormatException);
    expect(platform.installs, 0);
  });

  test(
      'Windows inspection validates real CA bytes and rejects leaf certificates',
      () async {
    if (!Platform.isWindows) return;
    final windows = WindowsCompanyCertificatePlatform();
    final inspected = await windows.inspect(certificate.der);
    expect(inspected.subject, contains('127.0.0.1'));
    expect(inspected.sha256, hasLength(64));
    final leaf = decodeCompanyCertificates(await File(
                'test/features/self_hosting/fixtures/localhost-leaf-cert.pem')
            .readAsBytes())
        .single;
    await expectLater(windows.inspect(leaf), throwsFormatException);
    await expectLater(
        windows.inspect(Uint8List.fromList([1, 2, 3])), throwsFormatException);
  });

  testWidgets('choosing a certificate shows a review before importing',
      (tester) async {
    final widgetStore = _WidgetStore(certificate);
    await tester.pumpWidget(certificateTestHost(CompanyCertificatesSettingsView(
      store: widgetStore,
      pickFile: () async => File(fixture),
    )));
    await tester.pumpAndSettle();
    expect(find.text('No company certificates imported yet.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('choose-company-certificate')));
    await tester.pumpAndSettle();
    expect(find.text('Review before importing'), findsOneWidget);
    expect(find.text('CN=Company Test CA'), findsOneWidget);
    expect(widgetStore.imports, 0);
    await tester
        .ensureVisible(find.byKey(const ValueKey('trust-company-certificate')));
    await tester.tap(find.byKey(const ValueKey('trust-company-certificate')));
    await tester.pumpAndSettle();
    expect(widgetStore.imports, 1);
    expect(find.byKey(const ValueKey('certificate-result')), findsOneWidget);
  });

  testWidgets('review fits a narrow settings panel', (tester) async {
    await tester.binding.setSurfaceSize(const Size(336, 720));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final widgetStore = _WidgetStore(certificate);
    await tester.pumpWidget(certificateTestHost(RepaintBoundary(
      key: const ValueKey('certificate-review-render'),
      child: ColoredBox(
          color: Colors.white,
          child: CompanyCertificatesSettingsView(
              store: widgetStore, pickFile: () async => File(fixture))),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('choose-company-certificate')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.runAsync(() async {
      final boundary = tester.renderObject<RenderRepaintBoundary>(
          find.byKey(const ValueKey('certificate-review-render')));
      final image = await boundary.toImage();
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await File('.sandbox/company-certificates-review.png')
          .writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
    });
  });

  testWidgets('a cancelled file picker leaves trust unchanged', (tester) async {
    final widgetStore = _WidgetStore(certificate);
    await tester.pumpWidget(certificateTestHost(CompanyCertificatesSettingsView(
      store: widgetStore,
      pickFile: () async => null,
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('choose-company-certificate')));
    await tester.pumpAndSettle();
    expect(find.text('Review before importing'), findsNothing);
    expect(widgetStore.imports, 0);
  });
}

class _FakePlatform implements CompanyCertificatePlatform {
  _FakePlatform(this.certificate);
  final CompanyCertificate certificate;
  int installs = 0;
  int removes = 0;
  bool alreadyInstalled = false;
  @override
  Future<CompanyCertificate> inspect(Uint8List der) async => certificate;
  @override
  Future<bool> install(Uint8List der) async {
    installs++;
    return !alreadyInstalled;
  }

  @override
  Future<void> remove(Uint8List der) async {
    removes++;
  }
}

class _WidgetStore extends CompanyCertificateStore {
  _WidgetStore(this.certificate);
  final CompanyCertificate certificate;
  final List<CompanyCertificate> saved = [];
  int imports = 0;
  @override
  Future<List<CompanyCertificate>> list() async => [...saved];
  @override
  Future<List<CompanyCertificate>> inspectFile(File file) async =>
      [certificate];
  @override
  Future<void> importCertificate(CompanyCertificate certificate) async {
    imports++;
    saved.add(certificate);
  }
}

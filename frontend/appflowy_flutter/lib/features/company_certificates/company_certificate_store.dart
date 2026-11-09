import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';

class CompanyCertificate {
  const CompanyCertificate({
    required this.subject,
    required this.issuer,
    required this.thumbprint,
    required this.sha256,
    required this.notBefore,
    required this.notAfter,
    required this.der,
    this.installedByApp = false,
  });

  factory CompanyCertificate.fromJson(Map<String, dynamic> json) =>
      CompanyCertificate(
        subject: json['subject'] as String,
        issuer: json['issuer'] as String,
        thumbprint: json['thumbprint'] as String,
        sha256: json['sha256'] as String,
        notBefore: DateTime.parse(json['notBefore'] as String),
        notAfter: DateTime.parse(json['notAfter'] as String),
        der: base64Decode(json['der'] as String),
        installedByApp: json['installedByApp'] as bool? ?? false,
      );

  final String subject;
  final String issuer;
  final String thumbprint;
  final String sha256;
  final DateTime notBefore;
  final DateTime notAfter;
  final Uint8List der;
  final bool installedByApp;

  List<int> get pemBytes => utf8.encode(
        "-----BEGIN CERTIFICATE-----\n${base64Encode(der)}\n-----END CERTIFICATE-----\n",
      );

  CompanyCertificate withOwnership(bool owned) => CompanyCertificate(
        subject: subject,
        issuer: issuer,
        thumbprint: thumbprint,
        sha256: sha256,
        notBefore: notBefore,
        notAfter: notAfter,
        der: der,
        installedByApp: owned,
      );

  Map<String, dynamic> toJson() => {
        'subject': subject,
        'issuer': issuer,
        'thumbprint': thumbprint,
        'sha256': sha256,
        'notBefore': notBefore.toUtc().toIso8601String(),
        'notAfter': notAfter.toUtc().toIso8601String(),
        'der': base64Encode(der),
        'installedByApp': installedByApp,
      };
}

/// Operations on the current Windows account's trusted-root store. Tests use
/// a fake; certificate tests never install roots in the real Windows store.
abstract class CompanyCertificatePlatform {
  Future<CompanyCertificate> inspect(Uint8List der);
  Future<bool> install(Uint8List der);
  Future<void> remove(Uint8List der);
}

class WindowsCompanyCertificatePlatform implements CompanyCertificatePlatform {
  Future<Map<String, dynamic>> _run(String action, Uint8List der) async {
    if (!Platform.isWindows) {
      throw UnsupportedError('Company certificate import requires Windows.');
    }
    final temporary = await Directory.systemTemp.createTemp('appflowy-cert-');
    final file = File(path.join(temporary.path, 'certificate.cer'));
    try {
      await file.writeAsBytes(der, flush: true);
      final executable = path.join(
        Platform.environment['SystemRoot'] ?? r'C:\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      final result = await Process.run(
        executable,
        ['-NoProfile', '-NonInteractive', '-Command', _certificateScript],
        environment: {
          'APPFLOWY_CERT_ACTION': action,
          'APPFLOWY_CERT_FILE': file.path
        },
      ).timeout(const Duration(seconds: 30));
      if (result.exitCode != 0) {
        // This script only reports certificate validation/store errors; no
        // credentials or private keys are passed to it.
        throw FormatException(result.stderr.toString().trim());
      }
      return jsonDecode(result.stdout.toString().trim())
          as Map<String, dynamic>;
    } finally {
      final resolved = await temporary.resolveSymbolicLinks();
      final tempRoot = await Directory.systemTemp.resolveSymbolicLinks();
      if (!path.isWithin(tempRoot, resolved)) {
        throw StateError('Unexpected certificate temporary directory.');
      }
      await temporary.delete(recursive: true);
    }
  }

  @override
  Future<CompanyCertificate> inspect(Uint8List der) async =>
      CompanyCertificate.fromJson(await _run('inspect', der));

  @override
  Future<bool> install(Uint8List der) async =>
      (await _run('install', der))['installedByApp'] as bool;

  @override
  Future<void> remove(Uint8List der) async {
    await _run('remove', der);
  }
}

class CompanyCertificateStore {
  CompanyCertificateStore(
      {Directory? directory, CompanyCertificatePlatform? platform})
      : _directory = directory,
        _platform = platform ?? WindowsCompanyCertificatePlatform();

  final Directory? _directory;
  final CompanyCertificatePlatform _platform;

  Future<Directory> _root() async => Directory(path.join(
        (_directory ?? await getApplicationSupportDirectory()).path,
        'company_certificates',
      ));

  Future<File> _file(CompanyCertificate certificate) async {
    if (!RegExp(r'^[A-Fa-f0-9]{40}$').hasMatch(certificate.thumbprint)) {
      throw const FormatException('Invalid certificate fingerprint.');
    }
    return File(path.join(
        (await _root()).path, '${certificate.thumbprint.toUpperCase()}.json'));
  }

  Future<List<CompanyCertificate>> list() async {
    final root = await _root();
    if (!await root.exists()) return [];
    final certificates = <CompanyCertificate>[];
    await for (final file in root.list()) {
      if (file is File && file.path.endsWith('.json')) {
        final json =
            jsonDecode(await file.readAsString()) as Map<String, dynamic>;
        certificates.add(CompanyCertificate.fromJson(json));
      }
    }
    certificates.sort((a, b) => a.subject.compareTo(b.subject));
    return certificates;
  }

  Future<List<CompanyCertificate>> inspectFile(File file) async {
    if (await file.length() > 1024 * 1024) {
      throw const FormatException(
          'Choose a certificate file smaller than 1 MB.');
    }
    final chunks = decodeCompanyCertificates(await file.readAsBytes());
    final certificates = <CompanyCertificate>[];
    for (final der in chunks) {
      certificates.add(await _platform.inspect(der));
    }
    return certificates;
  }

  Future<void> importCertificate(CompanyCertificate certificate) async {
    final file = await _file(certificate);
    if (await file.exists()) return;
    final owned = await _platform.install(certificate.der);
    try {
      await file.parent.create(recursive: true);
      final temporary = File('${file.path}.tmp');
      await temporary.writeAsString(
          jsonEncode(certificate.withOwnership(owned).toJson()),
          flush: true);
      await temporary.rename(file.path);
    } catch (_) {
      if (owned) await _platform.remove(certificate.der);
      rethrow;
    }
    SecurityContext.defaultContext
        .setTrustedCertificatesBytes(certificate.pemBytes);
  }

  Future<void> removeCertificate(CompanyCertificate certificate) async {
    final file = await _file(certificate);
    if (!await file.exists()) return;
    final saved = CompanyCertificate.fromJson(
        jsonDecode(await file.readAsString()) as Map<String, dynamic>);
    if (saved.installedByApp) await _platform.remove(saved.der);
    await file.delete();
  }

  /// Dart may cache system roots. Restore the app's imported CA certificates
  /// before creating HTTPS clients on every start.
  Future<void> restoreTrust() async {
    for (final certificate in await list()) {
      if (certificate.notAfter.isAfter(DateTime.now())) {
        SecurityContext.defaultContext
            .setTrustedCertificatesBytes(certificate.pemBytes);
      }
    }
  }
}

List<Uint8List> decodeCompanyCertificates(Uint8List bytes) {
  if (bytes.isEmpty)
    throw const FormatException('The certificate file is empty.');
  final text = utf8.decode(bytes, allowMalformed: true);
  if (text.contains('PRIVATE KEY')) {
    throw const FormatException(
        'Choose a public CA certificate, without a private key.');
  }
  if (!text.contains('-----BEGIN')) return [bytes];
  final matches =
      RegExp(r'-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----')
          .allMatches(text)
          .toList();
  if (matches.isEmpty)
    throw const FormatException(
        'No public certificate was found in this PEM file.');
  return [
    for (final match in matches)
      base64Decode(match.group(1)!.replaceAll(RegExp(r'\s'), ''))
  ];
}

const _certificateScript = r'''
$ErrorActionPreference = 'Stop'
try {
  $certificateBytes = [IO.File]::ReadAllBytes($env:APPFLOWY_CERT_FILE)
  $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (,$certificateBytes)
  if ($certificate.HasPrivateKey) { throw 'Choose a public CA certificate without a private key.' }
  $action = $env:APPFLOWY_CERT_ACTION
  if ($action -ne 'remove') {
    $constraints = $certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' } | Select-Object -First 1
    if ($null -eq $constraints) { throw 'This is a server certificate. Choose the company root or intermediate CA certificate.' }
    $basic = New-Object Security.Cryptography.X509Certificates.X509BasicConstraintsExtension
    $basic.CopyFrom($constraints)
    if (-not $basic.CertificateAuthority) { throw 'This is a server certificate. Choose a CA certificate.' }
    if ($certificate.NotAfter -le [DateTime]::Now) { throw 'This certificate has expired. Ask your IT team for the current CA certificate.' }
    if ($certificate.NotBefore -gt [DateTime]::Now) { throw 'This certificate is not valid yet. Check your PC clock or ask your IT team.' }
  }
  $owned = $false
  if ($action -eq 'install' -or $action -eq 'remove') {
    $store = New-Object Security.Cryptography.X509Certificates.X509Store -ArgumentList 'Root','CurrentUser'
    try {
      $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
      $existing = $store.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $certificate.Thumbprint, $false)
      if ($action -eq 'install' -and $existing.Count -eq 0) { $store.Add($certificate); $owned = $true }
      if ($action -eq 'remove') { foreach ($match in $existing) { $store.Remove($match) } }
    } finally { $store.Close() }
  }
  $hash = [Security.Cryptography.SHA256]::Create()
  $sha256 = [BitConverter]::ToString($hash.ComputeHash($certificate.RawData)).Replace('-','')
  $hash.Dispose()
  @{
    subject = $certificate.Subject; issuer = $certificate.Issuer;
    thumbprint = $certificate.Thumbprint; sha256 = $sha256;
    notBefore = $certificate.NotBefore.ToUniversalTime().ToString('o');
    notAfter = $certificate.NotAfter.ToUniversalTime().ToString('o');
    der = [Convert]::ToBase64String($certificate.RawData); installedByApp = $owned
  } | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
''';

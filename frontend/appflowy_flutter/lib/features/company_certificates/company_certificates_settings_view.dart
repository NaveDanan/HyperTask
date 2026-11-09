import 'dart:io';

import 'package:appflowy/features/company_certificates/company_certificate_store.dart';
import 'package:appflowy/workspace/presentation/settings/shared/settings_body.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

class CompanyCertificatesSettingsView extends StatefulWidget {
  const CompanyCertificatesSettingsView({super.key, this.store, this.pickFile});
  final CompanyCertificateStore? store;
  final Future<File?> Function()? pickFile;

  @override
  State<CompanyCertificatesSettingsView> createState() =>
      _CompanyCertificatesSettingsViewState();
}

class _CompanyCertificatesSettingsViewState
    extends State<CompanyCertificatesSettingsView> {
  late final CompanyCertificateStore _store =
      widget.store ?? CompanyCertificateStore();
  List<CompanyCertificate> _certificates = [];
  List<CompanyCertificate> _selected = [];
  bool _busy = true;
  String? _error;
  String? _message;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final certificates = await _store.list();
      if (mounted)
        setState(() {
          _certificates = certificates;
          _busy = false;
        });
    } catch (error) {
      _failed(error);
    }
  }

  void _failed(Object error) {
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = error is FormatException
          ? error.message
          : 'Could not update certificates. ${error.toString()}';
    });
  }

  Future<File?> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      dialogTitle: 'Choose a public company CA certificate',
      type: FileType.custom,
      allowedExtensions: ['cer', 'crt', 'pem'],
    );
    final filePath = result?.files.single.path;
    return filePath == null ? null : File(filePath);
  }

  Future<void> _choose() async {
    setState(() {
      _busy = true;
      _error = null;
      _message = null;
      _selected = [];
    });
    try {
      final file = await (widget.pickFile ?? _pickFile)();
      final certificates = file == null
          ? <CompanyCertificate>[]
          : await _store.inspectFile(file);
      if (mounted)
        setState(() {
          _selected = certificates;
          _busy = false;
        });
    } catch (error) {
      _failed(error);
    }
  }

  Future<void> _import() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      for (final certificate in _selected) {
        await _store.importCertificate(certificate);
      }
      final certificates = await _store.list();
      if (!mounted) return;
      setState(() {
        _certificates = certificates;
        _selected = [];
        _busy = false;
        _message =
            'Certificate imported. Restart AppFlowy to refresh all connections.';
      });
    } catch (error) {
      _failed(error);
    }
  }

  Future<void> _remove(CompanyCertificate certificate) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove company certificate?'),
        content: Text(certificate.installedByApp
            ? 'This removes ${certificate.subject} from your Windows account’s trusted certificates. Restart AppFlowy afterward.'
            : 'This removes ${certificate.subject} from AppFlowy’s imported list. The certificate was already trusted in Windows and will remain there.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Remove')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _store.removeCertificate(certificate);
      final certificates = await _store.list();
      if (mounted)
        setState(() {
          _certificates = certificates;
          _busy = false;
          _message =
              'Certificate removed. Restart AppFlowy to refresh all connections.';
        });
    } catch (error) {
      _failed(error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SettingsBody(
      title: 'Company certificates',
      children: [
        const Text(
            'Import the root or intermediate CA certificate provided by your IT team for Jira, your collaboration server, and AI endpoints.'),
        const Text(
            'Certificates are trusted for your Windows account and other apps using that account. No administrator permission is needed.'),
        if (!Platform.isWindows)
          const Text(
              'Certificate import is available in the Windows desktop app.')
        else
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const ValueKey('choose-company-certificate'),
              onPressed: _busy ? null : _choose,
              icon: const Icon(Icons.folder_open),
              label: const Text('Choose certificate file'),
            ),
          ),
        if (_busy) const LinearProgressIndicator(),
        if (_error != null)
          Text(_error!,
              key: const ValueKey('certificate-error'),
              style: TextStyle(color: theme.colorScheme.error)),
        if (_message != null)
          Text(_message!, key: const ValueKey('certificate-result')),
        if (_selected.isNotEmpty) ...[
          Text('Review before importing', style: theme.textTheme.titleMedium),
          for (final certificate in _selected)
            _CertificateDetails(certificate: certificate),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              key: const ValueKey('trust-company-certificate'),
              onPressed: _busy ? null : _import,
              icon: const Icon(Icons.verified_user_outlined),
              label: Text(_selected.length == 1
                  ? 'Trust certificate'
                  : 'Trust certificates'),
            ),
          ),
        ],
        Text('Imported certificates', style: theme.textTheme.titleMedium),
        if (!_busy && _certificates.isEmpty)
          const Text('No company certificates imported yet.'),
        for (final certificate in _certificates)
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _CertificateDetails(certificate: certificate),
            TextButton(
              onPressed: _busy ? null : () => _remove(certificate),
              child: const Text('Remove'),
            ),
            const Divider(),
          ]),
      ],
    );
  }
}

class _CertificateDetails extends StatelessWidget {
  const _CertificateDetails({required this.certificate});
  final CompanyCertificate certificate;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final expired = certificate.notAfter.isBefore(DateTime.now());
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(certificate.subject, style: theme.textTheme.titleSmall),
      const SizedBox(height: 6),
      Text('Issued by: ${certificate.issuer}'),
      Text(
          '${expired ? "Expired" : "Expires"}: ${certificate.notAfter.toLocal().toIso8601String().split("T").first}',
          style: expired ? TextStyle(color: theme.colorScheme.error) : null),
      const SizedBox(height: 6),
      const Text('SHA-256 fingerprint'),
      SelectableText(certificate.sha256, style: theme.textTheme.bodySmall),
    ]);
  }
}

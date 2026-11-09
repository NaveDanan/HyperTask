import 'package:appflowy/env/cloud_env.dart';
import 'package:appflowy/env/self_hosted_policy.dart';
import 'package:appflowy/workspace/presentation/settings/shared/settings_body.dart';
import 'package:flutter/material.dart';

class SelfHostedSettingsView extends StatefulWidget {
  const SelfHostedSettingsView({super.key, required this.restartApp});
  final VoidCallback restartApp;
  @override
  State<SelfHostedSettingsView> createState() => _SelfHostedSettingsViewState();
}

class _SelfHostedSettingsViewState extends State<SelfHostedSettingsView> {
  final _server = TextEditingController();
  final _web = TextEditingController();
  bool _shared = false;
  bool _loading = true;
  bool _saving = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final type = await getAuthenticatorType();
    final url = await getAppFlowyCloudUrl();
    final web = await getAppFlowyShareDomain();
    if (!mounted) return;
    setState(() {
      _shared = !type.isLocal;
      _server.text = url;
      _web.text = web;
      _loading = false;
    });
  }

  @override
  void dispose() {
    _server.dispose();
    _web.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      if (_shared) {
        SelfHostedPolicy.validateServerUrl(_server.text.trim());
        final web =
            _web.text.trim().isEmpty ? _server.text.trim() : _web.text.trim();
        SelfHostedPolicy.validateServerUrl(web);
        await useBaseWebDomain(web);
        await useAppFlowyBetaCloudWithURL(
          _server.text.trim(),
          AuthenticatorType.appflowyCloudSelfHost,
        );
      } else {
        await useLocalServer();
      }
      widget.restartApp();
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error.toString();
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator.adaptive());
    }
    return SettingsBody(
      title: 'Storage & server',
      children: [
        Text(
          'Your data stays on this PC or your own collaboration server. AppFlowy hosted services and automatic vendor updates are disabled.',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        DropdownButtonFormField<bool>(
          value: _shared,
          decoration: const InputDecoration(labelText: 'Workspace storage'),
          items: const [
            DropdownMenuItem(
              value: false,
              child: Text('Local workspace on this PC'),
            ),
            DropdownMenuItem(
              value: true,
              child: Text('My collaboration server'),
            ),
          ],
          onChanged:
              _saving ? null : (value) => setState(() => _shared = value!),
        ),
        if (_shared) ...[
          TextField(
            controller: _server,
            enabled: !_saving,
            decoration: const InputDecoration(
              labelText: 'Server URL',
              hintText: 'https://appflowy.internal',
            ),
          ),
          TextField(
            controller: _web,
            enabled: !_saving,
            decoration: const InputDecoration(
              labelText: 'Web and shared-page URL',
              hintText: 'Same as server if left blank',
            ),
          ),
          const Text(
            'Sign in to your own server to collaborate. Local workspaces remain separate; export/import them to move existing content.',
          ),
        ],
        if (_error != null)
          Text(
            _error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Applying…' : 'Apply and restart'),
          ),
        ),
      ],
    );
  }
}

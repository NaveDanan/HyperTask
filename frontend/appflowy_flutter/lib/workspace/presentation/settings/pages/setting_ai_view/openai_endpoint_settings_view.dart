import 'package:appflowy/ai/service/openai_endpoint_settings.dart';
import 'package:appflowy/workspace/presentation/settings/shared/settings_body.dart';
import 'package:flutter/material.dart';

class OpenAIEndpointSettingsView extends StatefulWidget {
  const OpenAIEndpointSettingsView({super.key});

  @override
  State<OpenAIEndpointSettingsView> createState() =>
      _OpenAIEndpointSettingsViewState();
}

class _OpenAIEndpointSettingsViewState
    extends State<OpenAIEndpointSettingsView> {
  final _url = TextEditingController();
  final _model = TextEditingController();
  final _key = TextEditingController();
  final _embedding = TextEditingController();
  final _imageModel = TextEditingController();
  String _protectedKey = '';
  bool _enabled = false;
  bool _loading = true;
  bool _busy = false;
  bool _removeKey = false;
  String? _message;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final settings = await OpenAIEndpointSettings.load();
      if (!mounted) return;
      _url.text = settings?.baseUrl ?? '';
      _model.text = settings?.model ?? '';
      _embedding.text = settings?.embeddingModel ?? '';
      _imageModel.text = settings?.imageModel ?? '';
      _protectedKey = settings?.protectedKey ?? '';
      _enabled = settings?.enabled ?? false;
    } catch (_) {
      _message =
          'Could not load AI settings. Enter the endpoint settings again.';
      _failed = true;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _url.dispose();
    _model.dispose();
    _embedding.dispose();
    _imageModel.dispose();
    _key.clear();
    _key.dispose();
    super.dispose();
  }

  OpenAIEndpointSettings _settings() => OpenAIEndpointSettings(
        baseUrl: _url.text.trim(),
        model: _model.text.trim(),
        embeddingModel: _embedding.text.trim(),
        imageModel: _imageModel.text.trim(),
        enabled: _enabled,
        protectedKey: _removeKey
            ? ''
            : (_key.text.isEmpty ? _protectedKey : encryptKey(_key.text)),
      );

  Future<void> _act({required bool test}) async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final settings = _settings();
      if (test) {
        await settings.testConnection();
      } else {
        await settings.save();
        _protectedKey = settings.protectedKey;
        _key.clear();
        _removeKey = false;
      }
      if (!mounted) return;
      setState(() {
        _failed = false;
        _message = test
            ? 'Endpoint responded successfully.'
            : 'AI settings saved. Reopen existing chats to refresh their model.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _failed = true;
        _message = error is FormatException
            ? error.message
            : error is StateError
                ? error.message.toString()
                : 'Could not apply settings. Check the endpoint and try again.';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => SettingsBody(
        title: 'AI',
        description:
            'Use your own OpenAI-compatible API. Workspace storage stays local. AI prompts, selected sources, and enabled semantic-search inputs are sent only to this endpoint.',
        children: [
          if (_loading)
            const LinearProgressIndicator()
          else ...[
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              title: const Text('Enable AI endpoint'),
              value: _enabled,
              onChanged:
                  _busy ? null : (value) => setState(() => _enabled = value),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _url,
              enabled: !_busy,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'API base URL',
                hintText: 'http://localhost:8000/v1',
                helperText: 'Include the API prefix, usually /v1.',
              ),
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _model,
              enabled: !_busy,
              decoration: const InputDecoration(
                labelText: 'Chat model ID',
                helperText: 'Use the exact model ID provided by your endpoint.',
              ),
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _embedding,
              enabled: !_busy,
              decoration: const InputDecoration(
                labelText: 'Embeddings model ID (optional)',
                helperText:
                    'Leave empty for local text search. Semantic search sends workspace document text to this endpoint.',
                helperMaxLines: 3,
              ),
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _imageModel,
              enabled: !_busy,
              decoration: const InputDecoration(
                labelText: 'Image generation model ID (optional)',
                helperText:
                    'Requires POST /images/generations. Generated images are saved locally. Image attachments use your chat model and require vision support.',
                helperMaxLines: 3,
              ),
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _key,
              enabled: !_busy && !_removeKey,
              obscureText: true,
              enableSuggestions: false,
              autocorrect: false,
              decoration: InputDecoration(
                labelText: 'API key (optional)',
                helperText: _protectedKey.isEmpty
                    ? 'Leave empty if your endpoint does not require a key.'
                    : 'A key is saved using Windows account encryption. Leave empty to keep it.',
              ),
            ),
            if (_protectedKey.isNotEmpty)
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Remove saved API key'),
                value: _removeKey,
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _removeKey = value ?? false),
              ),
            const SizedBox(height: 20),
            const Text(
              'Chat, editor actions, summaries, translations, and selected-source answers use this model. Retrieval uses local text search, or your optional embeddings model for semantic workspace search. Image output uses the optional image model. Unsupported image or vision requests show a capability error.',
            ),
            const SizedBox(height: 20),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                FilledButton(
                  onPressed: _busy ? null : () => _act(test: false),
                  child: const Text('Save AI settings'),
                ),
                OutlinedButton(
                  onPressed: _busy ? null : () => _act(test: true),
                  child: const Text('Test endpoint'),
                ),
              ],
            ),
            if (_busy) ...[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
            ],
            if (_message != null) ...[
              const SizedBox(height: 12),
              Semantics(
                liveRegion: true,
                child: Text(
                  _message!,
                  style: TextStyle(
                    color: _failed ? Theme.of(context).colorScheme.error : null,
                  ),
                ),
              ),
            ],
          ],
        ],
      );
}

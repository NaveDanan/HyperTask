import 'package:appflowy/features/jira/data/jira_exception.dart';
import 'package:appflowy/features/jira/data/jira_repository.dart';
import 'package:appflowy/features/jira/data/models/jira_config.dart';
import 'package:appflowy/features/jira/presentation/widgets/jira_widgets.dart';
import 'package:appflowy_ui/appflowy_ui.dart';
import 'package:flutter/material.dart';

/// Default shown when no Jira configuration exists yet.
const kJiraSuggestedUrl = 'https://jira.example.com/projects/DEMO/';

class JiraSettingsResult {
  const JiraSettingsResult(this.config, this.credentials);

  final JiraConfig config;

  /// Null when the user kept the stored secret.
  final JiraCredentials? credentials;
}

Future<JiraSettingsResult?> showJiraSettingsDialog(
  BuildContext context, {
  required JiraRepository repository,
  JiraConfig? config,
  bool hasCredentials = false,
  bool credentialsPersist = false,
}) {
  return showDialog<JiraSettingsResult>(
    context: context,
    builder: (_) => JiraSettingsDialog(
      repository: repository,
      config: config,
      hasCredentials: hasCredentials,
      credentialsPersist: credentialsPersist,
    ),
  );
}

class JiraSettingsDialog extends StatefulWidget {
  const JiraSettingsDialog({
    super.key,
    required this.repository,
    this.config,
    this.hasCredentials = false,
    this.credentialsPersist = false,
  });

  final JiraRepository repository;
  final JiraConfig? config;
  final bool hasCredentials;
  final bool credentialsPersist;

  @override
  State<JiraSettingsDialog> createState() => _JiraSettingsDialogState();
}

class _JiraSettingsDialogState extends State<JiraSettingsDialog> {
  late final TextEditingController url;
  late final TextEditingController project;
  late final TextEditingController username;
  final TextEditingController secret = TextEditingController();
  late final TextEditingController jql;
  late final TextEditingController viewId;
  late JiraAuthType authType;

  bool testing = false;
  String? testResult;
  JiraException? testError;
  String? urlError;
  String? projectError;
  String? secretError;

  @override
  void initState() {
    super.initState();
    final config = widget.config;
    final suggested = JiraConfig.fromUserUrl(kJiraSuggestedUrl);
    url = TextEditingController(
      text: config?.baseUrl.isNotEmpty == true
          ? config!.baseUrl
          : suggested.baseUrl,
    );
    project = TextEditingController(
      text: config?.projectKey.isNotEmpty == true
          ? config!.projectKey
          : suggested.projectKey,
    );
    username = TextEditingController(text: config?.username ?? '');
    jql = TextEditingController(text: config?.customJql ?? '');
    viewId = TextEditingController(text: config?.databaseViewId ?? '');
    authType = config?.authType ?? JiraAuthType.personalAccessToken;
  }

  @override
  void dispose() {
    url.dispose();
    project.dispose();
    username.dispose();
    secret.dispose();
    jql.dispose();
    viewId.dispose();
    super.dispose();
  }

  JiraConfig? _buildConfig() {
    final parsed = JiraConfig.parseJiraUrl(url.text);
    final key = project.text.trim().isNotEmpty
        ? project.text.trim().toUpperCase()
        : (parsed.projectKey ?? '');
    setState(() {
      urlError = parsed.baseUrl.isEmpty ? 'Enter a valid Jira URL.' : null;
      projectError = key.isEmpty ? 'Enter the project key, e.g. DEMO.' : null;
    });
    if (urlError != null || projectError != null) {
      return null;
    }
    final base =
        widget.config ?? JiraConfig(baseUrl: parsed.baseUrl, projectKey: key);
    return base.copyWith(
      baseUrl: parsed.baseUrl,
      projectKey: key,
      authType: authType,
      username: authType == JiraAuthType.basic ? username.text.trim() : '',
      customJql: jql.text.trim(),
      databaseViewId: viewId.text.trim(),
    );
  }

  JiraCredentials? _buildCredentials() {
    final value = secret.text.trim();
    if (value.isEmpty) {
      return null;
    }
    return JiraCredentials(
      secret: value,
      username: authType == JiraAuthType.basic ? username.text.trim() : '',
    );
  }

  Future<void> _test() async {
    final config = _buildConfig();
    if (config == null) {
      return;
    }
    setState(() {
      testing = true;
      testResult = null;
      testError = null;
    });
    try {
      final (user, project) = await widget.repository.testConnection(
        config,
        _buildCredentials(),
      );
      if (!mounted) return;
      setState(() {
        testResult =
            'Connected as ${user.displayName.isEmpty ? user.name : user.displayName}'
            ' · ${project.key} – ${project.name}';
      });
    } on JiraException catch (e) {
      if (!mounted) return;
      setState(() => testError = e);
    } finally {
      if (mounted) {
        setState(() => testing = false);
      }
    }
  }

  void _save() {
    final config = _buildConfig();
    if (config == null) {
      return;
    }
    final credentials = _buildCredentials();
    final keepsSecret = widget.hasCredentials &&
        widget.config?.scopeId == config.scopeId &&
        widget.config?.authType == config.authType &&
        widget.config?.username == config.username;
    if (credentials == null && !keepsSecret) {
      setState(() => secretError = 'Enter a token to connect.');
      return;
    }
    if (config.authType == JiraAuthType.basic && config.username.isEmpty) {
      setState(() => secretError = 'Basic auth needs a username.');
      return;
    }
    Navigator.of(context).pop(JiraSettingsResult(config, credentials));
  }

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final isBasic = authType == JiraAuthType.basic;
    return JiraModal(
      title: 'Jira connection',
      footerLeading: [
        AFOutlinedTextButton.normal(
          text: testing ? 'Testing…' : 'Test connection',
          disabled: testing,
          onTap: _test,
        ),
      ],
      footerTrailing: [
        AFOutlinedTextButton.normal(
          text: 'Cancel',
          onTap: () => Navigator.of(context).pop(),
        ),
        AFFilledTextButton.primary(text: 'Save', onTap: _save),
      ],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          JiraFormField(
            label: 'Jira URL',
            isRequired: true,
            error: urlError,
            helper: 'Server or Data Center URL, including any context path. '
                'Pasting a project or issue link works too.',
            child: AFTextField(
              key: const Key('jira-settings-url'),
              controller: url,
              hintText: 'https://jira.example.com/projects/KEY',
              keyboardType: TextInputType.url,
              onChanged: (value) {
                final key = JiraConfig.parseJiraUrl(value).projectKey;
                if (key != null && project.text.trim().isEmpty) {
                  project.text = key;
                }
              },
            ),
          ),
          JiraFormField(
            label: 'Project key',
            isRequired: true,
            error: projectError,
            child: AFTextField(
              key: const Key('jira-settings-project'),
              controller: project,
              hintText: 'DEMO',
            ),
          ),
          JiraFormField(
            label: 'Authentication',
            child: Column(
              children: [
                for (final type in JiraAuthType.values)
                  JiraChoiceTile(
                    selected: authType == type,
                    onTap: () => setState(() => authType = type),
                    child: Text(
                      type.label,
                      style: theme.textStyle.body.standard(
                        color: theme.textColorScheme.primary,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (isBasic)
            JiraFormField(
              label: 'Username',
              isRequired: true,
              child: AFTextField(
                controller: username,
                autofillHints: const [AutofillHints.username],
              ),
            ),
          JiraFormField(
            label: isBasic ? 'Password or token' : 'Personal access token',
            isRequired: !widget.hasCredentials,
            error: secretError,
            helper: [
              if (widget.hasCredentials) 'Leave empty to keep the current one.',
              widget.credentialsPersist
                  ? 'Stored in the OS secure storage.'
                  : 'Kept in memory for this session only; re-enter after '
                      'restarting AppFlowy.',
              'Only sent to your Jira server.',
            ].join(' '),
            child: AFTextField(
              key: const Key('jira-settings-secret'),
              controller: secret,
              obscureText: true,
              autofillHints: const [AutofillHints.password],
              hintText: widget.hasCredentials ? '••••••••' : null,
            ),
          ),
          JiraFormField(
            label: 'Custom JQL (optional)',
            helper: 'Defaults to: project = "<key>". Ordering is applied '
                'automatically for stable paging.',
            child: AFTextField(controller: jql),
          ),
          JiraFormField(
            label: 'Mirror into AppFlowy database (optional)',
            helper: 'View id of an existing Grid/Board. Issues are mirrored '
                'one-way (Jira → AppFlowy) into "Jira …" columns; rows are '
                'never deleted.',
            child: AFTextField(controller: viewId),
          ),
          if (testResult != null)
            JiraBanner(kind: JiraBannerKind.success, message: testResult!),
          if (testError != null) JiraBanner.fromException(testError!),
        ],
      ),
    );
  }
}

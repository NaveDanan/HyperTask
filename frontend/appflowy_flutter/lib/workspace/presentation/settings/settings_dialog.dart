import 'package:appflowy/features/company_certificates/company_certificates_settings_view.dart';
import 'package:appflowy/workspace/presentation/settings/shared/af_dropdown_menu_entry.dart';
import 'package:appflowy/env/cloud_env.dart';
import 'package:appflowy/features/self_hosting/self_hosted_settings_view.dart';
import 'package:appflowy/features/workspace/logic/workspace_bloc.dart';
import 'package:appflowy/generated/locale_keys.g.dart';
import 'package:appflowy/shared/appflowy_cache_manager.dart';
import 'package:appflowy/startup/startup.dart';
import 'package:appflowy/util/share_log_files.dart';
import 'package:appflowy/workspace/application/settings/appearance/appearance_cubit.dart';
import 'package:appflowy/workspace/application/settings/settings_dialog_bloc.dart';
import 'package:appflowy/workspace/presentation/settings/pages/settings_account_view.dart';
import 'package:appflowy/workspace/presentation/settings/pages/settings_billing_view.dart';
import 'package:appflowy/workspace/presentation/settings/pages/settings_manage_data_view.dart';
import 'package:appflowy/workspace/presentation/settings/pages/settings_plan_view.dart';
import 'package:appflowy/workspace/presentation/settings/pages/settings_shortcuts_view.dart';
import 'package:appflowy/workspace/presentation/settings/pages/settings_workspace_view.dart';
import 'package:appflowy/workspace/presentation/settings/pages/sites/settings_sites_view.dart';
import 'package:appflowy/workspace/presentation/settings/shared/settings_category.dart';
import 'package:appflowy/workspace/presentation/settings/shared/settings_dropdown.dart';
import 'package:appflowy/workspace/presentation/settings/widgets/feature_flags/feature_flag_page.dart';
import 'package:appflowy/workspace/presentation/settings/widgets/members/workspace_member_page.dart';
import 'package:appflowy/workspace/presentation/settings/widgets/settings_menu.dart';
import 'package:appflowy/workspace/presentation/settings/widgets/settings_notifications_view.dart';
import 'package:appflowy/workspace/presentation/widgets/dialogs.dart';
import 'package:appflowy_backend/protobuf/flowy-user/protobuf.dart';
import 'package:appflowy_ui/appflowy_ui.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flowy_infra_ui/flowy_infra_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'pages/setting_ai_view/local_settings_ai_view.dart';
import 'widgets/setting_cloud.dart';

@visibleForTesting
const kSelfHostedTextInputFieldKey =
    ValueKey('self_hosted_url_input_text_field');
@visibleForTesting
const kSelfHostedWebTextInputFieldKey =
    ValueKey('self_hosted_web_url_input_text_field');

class SettingsDialog extends StatelessWidget {
  SettingsDialog(
    this.user, {
    required this.dismissDialog,
    required this.didLogout,
    required this.restartApp,
    this.initPage,
  }) : super(key: ValueKey(user.id));

  final UserProfilePB user;
  final SettingsPage? initPage;
  final VoidCallback dismissDialog;
  final VoidCallback didLogout;
  final VoidCallback restartApp;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.of(context).size.width * 0.6;
    final theme = AppFlowyTheme.of(context);
    final currentWorkspaceMemberRole =
        context.read<UserWorkspaceBloc>().state.currentWorkspace?.role;
    return BlocProvider<SettingsDialogBloc>(
      create: (context) => SettingsDialogBloc(
        user,
        currentWorkspaceMemberRole,
        initPage: initPage,
      )..add(const SettingsDialogEvent.initial()),
      child: BlocBuilder<SettingsDialogBloc, SettingsDialogState>(
        builder: (context, state) => FlowyDialog(
          width: width,
          constraints: const BoxConstraints(minWidth: 564),
          child: ScaffoldMessenger(
            child: Scaffold(
              backgroundColor: theme.backgroundColorScheme.primary,
              body: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 204,
                    child: SettingsMenu(
                      userProfile: user,
                      changeSelectedPage: (index) => context
                          .read<SettingsDialogBloc>()
                          .add(SettingsDialogEvent.setSelectedPage(index)),
                      currentPage:
                          context.read<SettingsDialogBloc>().state.page,
                      currentUserRole: currentWorkspaceMemberRole,
                      isBillingEnabled: state.isBillingEnabled,
                    ),
                  ),
                  AFDivider(
                    axis: Axis.vertical,
                    color: theme.borderColorScheme.primary,
                  ),
                  BlocBuilder<UserWorkspaceBloc, UserWorkspaceState>(
                    builder: (context, state) {
                      return Expanded(
                        child: getSettingsView(
                          state.currentWorkspace!,
                          context.read<SettingsDialogBloc>().state.page,
                          state.userProfile,
                          state.currentWorkspace?.role,
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget getSettingsView(
    UserWorkspacePB workspace,
    SettingsPage page,
    UserProfilePB user,
    AFRolePB? currentWorkspaceMemberRole,
  ) {
    switch (page) {
      case SettingsPage.account:
        return SettingsAccountView(
          userProfile: user,
          didLogout: didLogout,
          didLogin: dismissDialog,
        );
      case SettingsPage.workspace:
        return SettingsWorkspaceView(
          userProfile: user,
          currentWorkspaceMemberRole: currentWorkspaceMemberRole,
        );
      case SettingsPage.manageData:
        return SettingsManageDataView(
          userProfile: user,
          workspace: workspace,
        );
      case SettingsPage.notifications:
        return const SettingsNotificationsView();
      case SettingsPage.cloud:
        return SettingCloud(restartAppFlowy: () => restartApp());
      case SettingsPage.companyCertificates:
        return const CompanyCertificatesSettingsView();
      case SettingsPage.shortcuts:
        return const SettingsShortcutsView();
      case SettingsPage.ai:
        return LocalSettingsAIView(
          key: ValueKey(workspace.workspaceId),
          userProfile: user,
          workspaceId: workspace.workspaceId,
        );
      case SettingsPage.member:
        return WorkspaceMembersPage(
          userProfile: user,
          workspaceId: workspace.workspaceId,
        );
      case SettingsPage.plan:
        return SettingsPlanView(
          workspaceId: workspace.workspaceId,
          user: user,
        );
      case SettingsPage.billing:
        return SettingsBillingView(
          workspaceId: workspace.workspaceId,
          user: user,
        );
      case SettingsPage.sites:
        return SettingsSitesPage(
          workspaceId: workspace.workspaceId,
          user: user,
        );
      case SettingsPage.featureFlags:
        return const FeatureFlagsPage();
    }
  }
}

class SimpleSettingsDialog extends StatefulWidget {
  const SimpleSettingsDialog({super.key});

  @override
  State<SimpleSettingsDialog> createState() => _SimpleSettingsDialogState();
}

class _SimpleSettingsDialogState extends State<SimpleSettingsDialog> {
  SettingsPage page = SettingsPage.cloud;

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<AppearanceSettingsCubit>().state;

    return FlowyDialog(
      width: MediaQuery.of(context).size.width * 0.7,
      constraints: const BoxConstraints(maxWidth: 784, minWidth: 564),
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // header
              FlowyText(
                LocaleKeys.signIn_settings.tr(),
                fontSize: 36.0,
                fontWeight: FontWeight.w600,
              ),
              const VSpace(18.0),

              // language
              _LanguageSettings(key: ValueKey('language${settings.hashCode}')),
              const VSpace(22.0),

              // self-host cloud
              SelfHostedSettingsView(restartApp: () => runAppFlowy()),
              const VSpace(22.0),

              // support
              _SupportSettings(key: ValueKey('support${settings.hashCode}')),
            ],
          ),
        ),
      ),
    );
  }
}

class _LanguageSettings extends StatelessWidget {
  const _LanguageSettings({
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return SettingsCategory(
      title: LocaleKeys.settings_workspacePage_language_title.tr(),
      children: const [LanguageDropdown()],
    );
  }
}

@visibleForTesting
extension SettingsServerDropdownMenuExtension on AuthenticatorType {
  String get label {
    switch (this) {
      case AuthenticatorType.appflowyCloud:
        return LocaleKeys.settings_menu_cloudAppFlowy.tr();
      case AuthenticatorType.appflowyCloudSelfHost:
        return LocaleKeys.settings_menu_cloudAppFlowySelfHost.tr();
      default:
        throw Exception('Unsupported server type: $this');
    }
  }
}

@visibleForTesting
class SettingsServerDropdownMenu extends StatelessWidget {
  const SettingsServerDropdownMenu({
    super.key,
    required this.selectedServer,
    required this.onSelected,
  });

  final AuthenticatorType selectedServer;
  final void Function(AuthenticatorType type) onSelected;

  // in the settings page from sign in page, we only support appflowy cloud and self-hosted
  static final supportedServers = [
    AuthenticatorType.appflowyCloudSelfHost,
  ];

  @override
  Widget build(BuildContext context) {
    return SettingsDropdown<AuthenticatorType>(
      expandWidth: false,
      onChanged: onSelected,
      selectedOption: selectedServer,
      options: supportedServers
          .map(
            (serverType) => buildDropdownMenuEntry<AuthenticatorType>(
              context,
              selectedValue: selectedServer,
              value: serverType,
              label: serverType.label,
            ),
          )
          .toList(),
    );
  }
}

class _SupportSettings extends StatelessWidget {
  const _SupportSettings({
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return SettingsCategory(
      title: LocaleKeys.settings_mobile_support.tr(),
      children: [
        // export logs
        Row(
          children: [
            FlowyText(
              LocaleKeys.workspace_errorActions_exportLogFiles.tr(),
            ),
            const Spacer(),
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 78),
              child: OutlinedRoundedButton(
                text: LocaleKeys.settings_files_export.tr(),
                onTap: () {
                  shareLogFiles(context);
                },
              ),
            ),
          ],
        ),
        // clear cache
        Row(
          children: [
            FlowyText(
              LocaleKeys.settings_files_clearCache.tr(),
            ),
            const Spacer(),
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 78),
              child: OutlinedRoundedButton(
                text: LocaleKeys.button_clear.tr(),
                onTap: () async {
                  await getIt<FlowyCacheManager>().clearAllCache();
                  if (context.mounted) {
                    showToastNotification(
                      message: LocaleKeys
                          .settings_manageDataPage_cache_dialog_successHint
                          .tr(),
                    );
                  }
                },
              ),
            ),
          ],
        ),
      ],
    );
  }
}

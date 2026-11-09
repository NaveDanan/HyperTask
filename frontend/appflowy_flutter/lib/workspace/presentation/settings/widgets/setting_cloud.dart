import 'package:appflowy/workspace/presentation/widgets/dialogs.dart';
import 'package:collection/collection.dart';
import 'package:go_router/go_router.dart';
import 'package:appflowy/env/cloud_env.dart';
import 'package:appflowy/features/self_hosting/self_hosted_settings_view.dart';
import 'package:appflowy/generated/flowy_svgs.g.dart';
import 'package:appflowy/generated/locale_keys.g.dart';
import 'package:appflowy/mobile/presentation/bottom_sheet/bottom_sheet.dart';
import 'package:appflowy/mobile/presentation/widgets/widgets.dart';
import 'package:appflowy/workspace/presentation/settings/shared/af_dropdown_menu_entry.dart';
import 'package:appflowy/workspace/presentation/settings/shared/settings_dropdown.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flowy_infra_ui/flowy_infra_ui.dart';
import 'package:flutter/material.dart';
import 'package:universal_platform/universal_platform.dart';

class SettingCloud extends StatelessWidget {
  const SettingCloud({
    super.key,
    required this.restartAppFlowy,
  });

  final VoidCallback restartAppFlowy;

  @override
  Widget build(BuildContext context) =>
      SelfHostedSettingsView(restartApp: restartAppFlowy);
}

class CloudTypeSwitcher extends StatelessWidget {
  const CloudTypeSwitcher({
    super.key,
    required this.cloudType,
    required this.onSelected,
  });

  final AuthenticatorType cloudType;
  final Function(AuthenticatorType) onSelected;

  @override
  Widget build(BuildContext context) {
    // Only show the appflowyCloudDevelop in develop mode
    final values = AuthenticatorType.values.where((element) {
      return element == AuthenticatorType.local ||
          element == AuthenticatorType.appflowyCloudSelfHost;
    }).toList();
    return UniversalPlatform.isDesktopOrWeb
        ? SettingsDropdown(
            selectedOption: cloudType,
            onChanged: (type) {
              if (type != cloudType) {
                NavigatorAlertDialog(
                  title: LocaleKeys.settings_menu_changeServerTip.tr(),
                  confirm: () async {
                    onSelected(type);
                  },
                  hideCancelButton: true,
                ).show(context);
              }
            },
            options: values
                .map(
                  (type) => buildDropdownMenuEntry(
                    context,
                    value: type,
                    label: titleFromCloudType(type),
                  ),
                )
                .toList(),
          )
        : FlowyButton(
            text: FlowyText(
              titleFromCloudType(cloudType),
            ),
            useIntrinsicWidth: true,
            rightIcon: const Icon(
              Icons.chevron_right,
            ),
            onTap: () => showMobileBottomSheet(
              context,
              showHeader: true,
              showDragHandle: true,
              showDivider: false,
              title: LocaleKeys.settings_menu_cloudServerType.tr(),
              builder: (context) => Column(
                children: values
                    .mapIndexed(
                      (i, e) => FlowyOptionTile.checkbox(
                        text: titleFromCloudType(values[i]),
                        isSelected: cloudType == values[i],
                        onTap: () {
                          onSelected(e);
                          context.pop();
                        },
                        showBottomBorder: i == values.length - 1,
                      ),
                    )
                    .toList(),
              ),
            ),
          );
  }
}

class CloudTypeItem extends StatelessWidget {
  const CloudTypeItem({
    super.key,
    required this.cloudType,
    required this.currentCloudType,
    required this.onSelected,
  });

  final AuthenticatorType cloudType;
  final AuthenticatorType currentCloudType;
  final Function(AuthenticatorType) onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 32,
      child: FlowyButton(
        text: FlowyText.medium(
          titleFromCloudType(cloudType),
        ),
        rightIcon: currentCloudType == cloudType
            ? const FlowySvg(FlowySvgs.check_s)
            : null,
        onTap: () {
          if (currentCloudType != cloudType) {
            NavigatorAlertDialog(
              title: LocaleKeys.settings_menu_changeServerTip.tr(),
              confirm: () async {
                onSelected(cloudType);
              },
              hideCancelButton: true,
            ).show(context);
          }
          PopoverContainer.of(context).close();
        },
      ),
    );
  }
}

String titleFromCloudType(AuthenticatorType type) => type.isLocal ? 'Local workspace' : 'My collaboration server';

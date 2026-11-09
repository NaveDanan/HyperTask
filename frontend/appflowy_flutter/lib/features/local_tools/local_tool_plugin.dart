import 'package:appflowy/startup/plugin/plugin.dart';
import 'package:appflowy/workspace/presentation/home/home_stack.dart';
import 'package:appflowy_backend/protobuf/flowy-user/protobuf.dart';
import 'package:flowy_infra_ui/flowy_infra_ui.dart';
import 'package:flutter/material.dart';

/// Non-document tools participate in the existing tab stack with stable ids.
class LocalToolPlugin extends Plugin {
  LocalToolPlugin({
    required this.toolId,
    required this.title,
    required this.page,
    required this.user,
  });
  final String toolId;
  final String title;
  final Widget Function(UserProfilePB) page;
  final UserProfilePB user;
  @override
  String get id => 'local-tool:$toolId';
  @override
  PluginType get pluginType => PluginType.blank;
  @override
  PluginWidgetBuilder get widgetBuilder => _ToolBuilder(title, page(user));
}

class _ToolBuilder extends PluginWidgetBuilder {
  _ToolBuilder(this.title, this.page);
  final String title;
  final Widget page;
  @override
  String get viewName => title;
  @override
  Widget get leftBarItem => FlowyText.medium(title);
  @override
  EdgeInsets get contentPadding => EdgeInsets.zero;
  @override
  NavigationCallback get action => (_) {};
  @override
  Widget tabBarItem(String pluginId, [bool shortForm = false]) => leftBarItem;
  @override
  List<NavigationItem> get navigationItems => [this];
  @override
  Widget buildWidget({
    required PluginContext context,
    required bool shrinkWrap,
    Map<String, dynamic>? data,
  }) =>
      page;
}

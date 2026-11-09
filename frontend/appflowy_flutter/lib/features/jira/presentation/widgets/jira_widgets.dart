import 'package:appflowy/generated/flowy_svgs.g.dart';
import 'package:appflowy/features/jira/data/jira_exception.dart';
import 'package:appflowy/features/jira/data/models/jira_issue.dart';
import 'package:appflowy_ui/appflowy_ui.dart';
import 'package:flutter/material.dart';

/// Background/foreground colors for a status category.
(Color, Color) jiraCategoryColors(
  AppFlowyThemeData theme,
  JiraStatusCategory category,
) {
  return switch (category) {
    JiraStatusCategory.toDo => (
        theme.fillColorScheme.contentHover,
        theme.textColorScheme.secondary,
      ),
    JiraStatusCategory.inProgress => (
        theme.fillColorScheme.infoLight,
        theme.textColorScheme.info,
      ),
    JiraStatusCategory.done => (
        theme.fillColorScheme.successLight,
        theme.textColorScheme.success,
      ),
    JiraStatusCategory.unknown => (
        theme.fillColorScheme.warningLight,
        theme.textColorScheme.warning,
      ),
  };
}

class JiraStatusBadge extends StatelessWidget {
  const JiraStatusBadge({
    super.key,
    required this.label,
    required this.category,
  });

  final String label;
  final JiraStatusCategory category;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final (bg, fg) = jiraCategoryColors(theme, category);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(theme.borderRadius.s),
      ),
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: theme.spacing.s,
          vertical: theme.spacing.xs / 2,
        ),
        child: Text(
          label.isEmpty ? category.label : label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: theme.textStyle.caption.enhanced(color: fg),
        ),
      ),
    );
  }
}

enum JiraBannerKind { error, warning, info, success }

class JiraBanner extends StatelessWidget {
  const JiraBanner({
    super.key,
    required this.kind,
    required this.message,
    this.title,
    this.actions = const [],
    this.onDismiss,
  });

  factory JiraBanner.fromException(
    JiraException error, {
    Key? key,
    List<Widget> actions = const [],
    VoidCallback? onDismiss,
  }) {
    return JiraBanner(
      key: key,
      kind: error is JiraConflictException
          ? JiraBannerKind.warning
          : JiraBannerKind.error,
      title: error.statusCode == null
          ? error.title
          : '${error.title} (HTTP ${error.statusCode})',
      message: error.message,
      actions: actions,
      onDismiss: onDismiss,
    );
  }

  final JiraBannerKind kind;
  final String? title;
  final String message;
  final List<Widget> actions;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    final (bg, fg, border) = switch (kind) {
      JiraBannerKind.error => (
          theme.fillColorScheme.errorLight,
          theme.textColorScheme.error,
          theme.borderColorScheme.errorThick,
        ),
      JiraBannerKind.warning => (
          theme.fillColorScheme.warningLight,
          theme.textColorScheme.warning,
          theme.borderColorScheme.warningThick,
        ),
      JiraBannerKind.info => (
          theme.fillColorScheme.infoLight,
          theme.textColorScheme.info,
          theme.borderColorScheme.infoThick,
        ),
      JiraBannerKind.success => (
          theme.fillColorScheme.successLight,
          theme.textColorScheme.success,
          theme.borderColorScheme.successThick,
        ),
    };
    return Semantics(
      liveRegion: kind == JiraBannerKind.error,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: bg,
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(theme.borderRadius.m),
        ),
        child: Padding(
          padding: EdgeInsets.all(theme.spacing.m),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: theme.spacing.xs,
                  children: [
                    if (title != null)
                      Text(
                        title!,
                        style: theme.textStyle.body.enhanced(color: fg),
                      ),
                    SelectableText(
                      message,
                      style: theme.textStyle.caption.standard(
                        color: theme.textColorScheme.primary,
                      ),
                    ),
                    if (actions.isNotEmpty)
                      Wrap(
                        spacing: theme.spacing.s,
                        runSpacing: theme.spacing.xs,
                        children: actions,
                      ),
                  ],
                ),
              ),
              if (onDismiss != null)
                JiraIconButton(
                  tooltip: 'Dismiss',
                  onTap: onDismiss!,
                  icon: const FlowySvg(FlowySvgs.toast_close_s),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class JiraIconButton extends StatelessWidget {
  const JiraIconButton({
    super.key,
    required this.tooltip,
    required this.onTap,
    required this.icon,
    this.disabled = false,
  });

  final String tooltip;
  final VoidCallback onTap;
  final Widget icon;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    return Tooltip(
      message: tooltip,
      child: Semantics(
        button: true,
        label: tooltip,
        child: AFGhostButton.normal(
          onTap: onTap,
          disabled: disabled,
          padding: EdgeInsets.all(theme.spacing.xs),
          builder: (context, isHovering, disabled) => IconTheme(
            data: IconThemeData(
              size: 18,
              color: disabled
                  ? theme.iconColorScheme.tertiary
                  : theme.iconColorScheme.primary,
            ),
            child: SizedBox.square(dimension: 20, child: Center(child: icon)),
          ),
        ),
      ),
    );
  }
}

/// AFModal with the standard header (title + close) and footer.
class JiraModal extends StatelessWidget {
  const JiraModal({
    super.key,
    required this.title,
    required this.child,
    this.footerLeading = const [],
    this.footerTrailing = const [],
    this.maxWidth = 560,
  });

  final String title;
  final Widget child;
  final List<Widget> footerLeading;
  final List<Widget> footerTrailing;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    return AFModal(
      constraints: BoxConstraints(maxWidth: maxWidth, maxHeight: 720),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AFModalHeader(
            leading: Text(
              title,
              style: theme.textStyle.heading4.prominent(
                color: theme.textColorScheme.primary,
              ),
            ),
            trailing: [
              JiraIconButton(
                tooltip: 'Close',
                onTap: () => Navigator.of(context).pop(),
                icon: const FlowySvg(FlowySvgs.toast_close_s),
              ),
            ],
          ),
          Flexible(
            child: SingleChildScrollView(
              child: AFModalBody(child: child),
            ),
          ),
          AFModalFooter(leading: footerLeading, trailing: footerTrailing),
        ],
      ),
    );
  }
}

/// Label + control + optional helper/error text.
class JiraFormField extends StatelessWidget {
  const JiraFormField({
    super.key,
    required this.label,
    required this.child,
    this.helper,
    this.error,
    this.isRequired = false,
  });

  final String label;
  final Widget child;
  final String? helper;
  final String? error;
  final bool isRequired;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: theme.spacing.l),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: theme.spacing.xs,
        children: [
          Text.rich(
            TextSpan(
              text: label,
              children: [
                if (isRequired)
                  TextSpan(
                    text: ' *',
                    style: TextStyle(color: theme.textColorScheme.error),
                  ),
              ],
            ),
            style: theme.textStyle.caption.enhanced(
              color: theme.textColorScheme.secondary,
            ),
          ),
          child,
          if (error != null)
            Text(
              error!,
              style: theme.textStyle.caption.standard(
                color: theme.textColorScheme.error,
              ),
            )
          else if (helper != null)
            Text(
              helper!,
              style: theme.textStyle.caption.standard(
                color: theme.textColorScheme.tertiary,
              ),
            ),
        ],
      ),
    );
  }
}

/// Multi-line input styled like [AFTextField] (which is single-line).
class JiraMultilineField extends StatelessWidget {
  const JiraMultilineField({
    super.key,
    required this.controller,
    this.hintText,
    this.minLines = 4,
  });

  final TextEditingController controller;
  final String? hintText;
  final int minLines;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    OutlineInputBorder border(Color color) => OutlineInputBorder(
          borderRadius: BorderRadius.circular(theme.borderRadius.m),
          borderSide: BorderSide(color: color),
        );
    return TextField(
      controller: controller,
      minLines: minLines,
      maxLines: 12,
      keyboardType: TextInputType.multiline,
      style: theme.textStyle.body.standard(
        color: theme.textColorScheme.primary,
      ),
      decoration: InputDecoration(
        isDense: true,
        hintText: hintText,
        hintStyle: theme.textStyle.body.standard(
          color: theme.textColorScheme.tertiary,
        ),
        contentPadding: EdgeInsets.all(theme.spacing.m),
        enabledBorder: border(theme.borderColorScheme.primary),
        focusedBorder: border(theme.borderColorScheme.themeThick),
        border: border(theme.borderColorScheme.primary),
      ),
    );
  }
}

/// Simple selectable option row used for single-choice lists.
class JiraChoiceTile extends StatelessWidget {
  const JiraChoiceTile({
    super.key,
    required this.selected,
    required this.onTap,
    required this.child,
    this.disabled = false,
  });

  final bool selected;
  final VoidCallback onTap;
  final Widget child;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    final theme = AppFlowyTheme.of(context);
    return Semantics(
      selected: selected,
      button: true,
      child: AFGhostButton.normal(
        onTap: onTap,
        disabled: disabled,
        padding: EdgeInsets.symmetric(
          horizontal: theme.spacing.m,
          vertical: theme.spacing.s,
        ),
        builder: (context, isHovering, disabled) => DecoratedBox(
          decoration: BoxDecoration(
            border: Border.all(
              color: selected
                  ? theme.borderColorScheme.themeThick
                  : Colors.transparent,
            ),
            borderRadius: BorderRadius.circular(theme.borderRadius.s),
          ),
          child: Padding(
            padding: EdgeInsets.all(theme.spacing.xs),
            child: Row(
              spacing: theme.spacing.m,
              children: [
                Icon(
                  selected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  size: 16,
                  color: selected
                      ? theme.iconColorScheme.featuredThick
                      : theme.iconColorScheme.secondary,
                ),
                Expanded(child: child),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Adapter so plain strings can be used with [AFDropDownMenu].
class JiraMenuItem<T> with AFDropDownMenuMixin {
  JiraMenuItem(this.value, this.label);

  final T value;

  @override
  final String label;

  @override
  bool operator ==(Object other) =>
      other is JiraMenuItem<T> && other.value == value;

  @override
  int get hashCode => value.hashCode;
}

String formatJiraRelative(DateTime? time, {DateTime? now}) {
  if (time == null) {
    return 'never';
  }
  final diff = (now ?? DateTime.now()).difference(time);
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  if (diff.inDays < 30) return '${diff.inDays} d ago';
  final local = time.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-'
      '${local.day.toString().padLeft(2, '0')}';
}

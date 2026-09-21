import 'package:flutter/material.dart';

import '../../../app_responsive.dart';
import '../../../design/tokens.dart';

/// Shows [builder] as a bottom sheet on a compact width (< 600) and as a
/// centred dialog (max 480 wide) from 600 up. Esc / the back gesture close
/// either; the route is announced as its own scope so focus stays inside.
Future<T?> showAdaptiveSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
  String? semanticLabel,
  bool isDismissible = true,
}) {
  final compact = MediaQuery.sizeOf(context).width < AppBreakpoints.tablet;

  Widget scoped(BuildContext context, Widget child) => Semantics(
        scopesRoute: true,
        namesRoute: semanticLabel != null,
        explicitChildNodes: true,
        label: semanticLabel,
        child: child,
      );

  if (compact) {
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      isDismissible: isDismissible,
      enableDrag: isDismissible,
      backgroundColor: BlynkColors.paper,
      barrierColor: BlynkColors.scrim,
      shape: const RoundedRectangleBorder(borderRadius: BlynkRadius.lgTop),
      builder: (sheetContext) => scoped(
        sheetContext,
        Padding(
          // Lift the sheet above the keyboard.
          padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheetContext).bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const _DragHandle(),
              Flexible(child: builder(sheetContext)),
            ],
          ),
        ),
      ),
    );
  }

  return showDialog<T>(
    context: context,
    barrierDismissible: isDismissible,
    barrierColor: BlynkColors.scrim,
    builder: (dialogContext) => Dialog(
      backgroundColor: BlynkColors.paper,
      shape: const RoundedRectangleBorder(borderRadius: BlynkRadius.lgAll),
      insetPadding: const EdgeInsets.all(BlynkSpace.s24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: scoped(dialogContext, builder(dialogContext)),
      ),
    ),
  );
}

class _DragHandle extends StatelessWidget {
  const _DragHandle();

  @override
  Widget build(BuildContext context) {
    return const ExcludeSemantics(
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: BlynkSpace.s12),
        child: SizedBox(
          width: BlynkSpace.s32,
          height: BlynkSpace.s4,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: BlynkColors.lineStrong,
              borderRadius: BlynkRadius.full,
            ),
          ),
        ),
      ),
    );
  }
}

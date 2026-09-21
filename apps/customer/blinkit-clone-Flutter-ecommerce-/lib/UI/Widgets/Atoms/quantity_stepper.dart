import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../design/tokens.dart';

/// "- n +" for a cart line. The pill is 40 dp tall but each button's hit area
/// is 48 x 48, and pressing changes colour only, never layout, so it can sit
/// where an ADD button morphs into it.
///
/// Decrement is offered while [quantity] is above [min]; increment while it is
/// below [max] (no upper limit when [max] is null).
class QuantityStepper extends StatelessWidget {
  const QuantityStepper({
    super.key,
    required this.quantity,
    required this.onIncrement,
    required this.onDecrement,
    required this.productName,
    this.min = 0,
    this.max,
  });

  final int quantity;
  final VoidCallback? onIncrement;
  final VoidCallback? onDecrement;
  final String productName;
  final int min;
  final int? max;

  static const double _hit = 48;
  static const double _visual = 40;

  void _haptic() {
    // Selection click is the Android convention; iOS/desktop stay quiet.
    if (defaultTargetPlatform == TargetPlatform.android) {
      HapticFeedback.selectionClick();
    }
  }

  @override
  Widget build(BuildContext context) {
    final canAdd = onIncrement != null && (max == null || quantity < max!);
    final canRemove = onDecrement != null && quantity > min;

    return SizedBox(
      height: _hit,
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Positioned.fill(
            top: (_hit - _visual) / 2,
            bottom: (_hit - _visual) / 2,
            child: DecoratedBox(
              decoration: BoxDecoration(color: BlynkColors.signal, borderRadius: BlynkRadius.full),
            ),
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _StepButton(
                icon: Icons.remove,
                label: 'Remove one $productName',
                onTap: canRemove
                    ? () {
                        _haptic();
                        onDecrement!();
                      }
                    : null,
              ),
              // Flexible + scaleDown: in a very narrow slot the count gives way
              // before the two 48 dp buttons do.
              Flexible(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minWidth: 28),
                  child: Semantics(
                    label: '$quantity $productName in cart',
                    liveRegion: true,
                    excludeSemantics: true,
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        '$quantity',
                        textAlign: TextAlign.center,
                        style: BlynkText.label.copyWith(color: BlynkColors.onSignal),
                      ),
                    ),
                  ),
                ),
              ),
              _StepButton(
                icon: Icons.add,
                label: 'Add one more $productName',
                onTap: canAdd
                    ? () {
                        _haptic();
                        onIncrement!();
                      }
                    : null,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StepButton extends StatefulWidget {
  const _StepButton({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  State<_StepButton> createState() => _StepButtonState();
}

class _StepButtonState extends State<_StepButton> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.label,
      onTap: widget.onTap,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkResponse(
          onTap: widget.onTap,
          onFocusChange: (focused) => setState(() => _focused = focused),
          radius: QuantityStepper._visual / 2,
          highlightShape: BoxShape.circle,
          containedInkWell: false,
          child: SizedBox(
            width: QuantityStepper._hit,
            height: QuantityStepper._hit,
            child: Center(
              child: Container(
                width: QuantityStepper._visual - 8,
                height: QuantityStepper._visual - 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  // Focus is a 2 dp ink ring, never colour alone.
                  border: _focused ? Border.all(color: BlynkColors.ink, width: 2) : null,
                ),
                child: Icon(
                  widget.icon,
                  size: BlynkIcons.md,
                  color: enabled ? BlynkColors.onSignal : BlynkColors.ink2,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../Models/product_model.dart';
import '../../../Services/Providers/cart.provider.dart';
import '../../../Services/Validation/app_validators.dart';
import '../../../design/tokens.dart';
import 'blynk_button.dart';
import 'quantity_stepper.dart';

/// Shows "ADD" while the product isn't in the cart, and morphs into a
/// [- n +] stepper once it is - backed by the real CartProvider, which is the
/// app's single source of cart truth.
///
/// Every tap target is at least 48 x 48 dp (the visual pill is 40 dp), pressing
/// changes colour only, and the swap is a fade over [BlynkMotion.base] (none
/// under reduced motion). The button reads ONLY this product's quantity, so a
/// cart change elsewhere does not rebuild it.
///
/// [expanded] is the full-width variant used as the Product Details CTA:
/// same states and same cart calls, sized as a primary button.
class AddToCartButton extends StatelessWidget {
  const AddToCartButton({
    super.key,
    required this.product,
    this.compact = true,
    this.expanded = false,
  });

  final ProductModel product;

  /// Only affects the ADD label size (12 vs 14); the stepper has one size.
  final bool compact;
  final bool expanded;

  static const double _expandedHeight = 52;

  @override
  Widget build(BuildContext context) {
    final quantity = context
        .select<CartProvider, int>((cart) => cart.quantityOf(product.id));
    final duration = BlynkMotion.resolve(context, BlynkMotion.base);

    final switcher = AnimatedSwitcher(
      duration: duration,
      layoutBuilder: (current, previous) => Stack(
        alignment: expanded ? Alignment.center : Alignment.centerRight,
        children: [...previous, if (current != null) current],
      ),
      transitionBuilder: (child, animation) =>
          FadeTransition(opacity: animation, child: child),
      child: quantity == 0
          ? (expanded
              ? _ExpandedAdd(key: const ValueKey('add'), product: product)
              : _AddPill(
                  key: const ValueKey('add'),
                  product: product,
                  compact: compact))
          : (expanded
              ? _ExpandedStepper(
                  key: const ValueKey('stepper'),
                  product: product,
                  quantity: quantity)
              : QuantityStepper(
                  key: const ValueKey('stepper'),
                  quantity: quantity,
                  productName: product.name,
                  max: AppValidators.quantityMax,
                  onIncrement: () => context.read<CartProvider>().add(product),
                  onDecrement: () =>
                      context.read<CartProvider>().decrement(product),
                )),
    );

    // Zero duration (reduced motion) is a plain swap: AnimatedSize asserts on it.
    if (expanded || duration == Duration.zero) return switcher;
    // The slot resizes over the same duration, so ADD -> stepper never jumps.
    return AnimatedSize(
        duration: duration, alignment: Alignment.centerRight, child: switcher);
  }
}

/// The compact ADD / N/A pill: 40 dp visual, 48 dp layout and hit box.
class _AddPill extends StatefulWidget {
  const _AddPill({super.key, required this.product, required this.compact});

  final ProductModel product;
  final bool compact;

  @override
  State<_AddPill> createState() => _AddPillState();
}

class _AddPillState extends State<_AddPill> {
  bool _pressed = false;
  bool _focused = false;

  static const double _hit = 48;
  static const double _visual = 40;

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    final available = product.isAvailable;
    final fill = !available
        ? BlynkColors.well
        : (_pressed ? BlynkColors.signalPressed : BlynkColors.signal);
    final style =
        (widget.compact ? BlynkText.caption : BlynkText.label).copyWith(
      fontWeight: FontWeight.w800,
      letterSpacing: 0.4,
      // Unavailable is ink2 on well (never the muted grey, which fails 4.5:1).
      color: available ? BlynkColors.onSignal : BlynkColors.ink2,
    );
    void add() => context.read<CartProvider>().add(product);

    return Semantics(
      button: true,
      enabled: available,
      label: available
          ? 'Add ${product.name}'
          : '${product.name}, currently unavailable',
      onTap: available ? add : null,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkResponse(
          onTap: available ? add : null,
          onHighlightChanged: (pressed) => setState(() => _pressed = pressed),
          onFocusChange: (focused) => setState(() => _focused = focused),
          // Feedback is the fill change alone, so nothing moves or grows.
          highlightColor: BlynkColors.clear,
          splashColor: BlynkColors.clear,
          hoverColor: BlynkColors.clear,
          focusColor: BlynkColors.clear,
          containedInkWell: false,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 64, minHeight: _hit),
            child: Center(
              widthFactor: 1,
              heightFactor: 1,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: fill,
                  borderRadius: BlynkRadius.full,
                  // Focus is a 2 dp ink ring, never colour alone.
                  border: _focused
                      ? Border.all(color: BlynkColors.ink, width: 2)
                      : null,
                ),
                // A floor, so a large text size grows the pill instead of clipping.
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: _visual),
                  child: Padding(
                    padding:
                        const EdgeInsets.symmetric(horizontal: BlynkSpace.s16),
                    child: Center(
                      widthFactor: 1,
                      heightFactor: 1,
                      child: Text(available ? 'ADD' : 'N/A',
                          maxLines: 1, style: style),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The Product Details CTA before anything is in the cart.
class _ExpandedAdd extends StatelessWidget {
  const _ExpandedAdd({super.key, required this.product});

  final ProductModel product;

  @override
  Widget build(BuildContext context) {
    final available = product.isAvailable;
    return ConstrainedBox(
      constraints:
          const BoxConstraints(minHeight: AddToCartButton._expandedHeight),
      child: BlynkButton.primary(
        label: available ? 'Add to Cart' : 'Currently unavailable',
        expand: true,
        onPressed:
            available ? () => context.read<CartProvider>().add(product) : null,
      ),
    );
  }
}

/// Full-width [- n +] for the Product Details CTA. Each half is a whole side
/// of the bar (>= 48 dp), so it fits however narrow the bar gets. Only icons
/// and a digit live here, which is why the height can stay fixed.
class _ExpandedStepper extends StatelessWidget {
  const _ExpandedStepper(
      {super.key, required this.product, required this.quantity});

  final ProductModel product;
  final int quantity;

  @override
  Widget build(BuildContext context) {
    final cart = context.read<CartProvider>();
    return Container(
      height: AddToCartButton._expandedHeight,
      decoration: const BoxDecoration(
          color: BlynkColors.signal, borderRadius: BlynkRadius.mdAll),
      child: Row(
        children: [
          Expanded(
            child: _HalfButton(
              icon: Icons.remove,
              label: 'Remove one ${product.name}',
              onTap: () => cart.decrement(product),
            ),
          ),
          SizedBox(
            width: 40,
            child: Semantics(
              label: '$quantity ${product.name} in cart',
              liveRegion: true,
              excludeSemantics: true,
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  '$quantity',
                  textAlign: TextAlign.center,
                  style:
                      BlynkText.heading.copyWith(color: BlynkColors.onSignal),
                ),
              ),
            ),
          ),
          Expanded(
            child: _HalfButton(
              icon: Icons.add,
              label: 'Add one more ${product.name}',
              onTap: quantity < AppValidators.quantityMax
                  ? () => cart.add(product)
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}

class _HalfButton extends StatefulWidget {
  const _HalfButton(
      {required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  State<_HalfButton> createState() => _HalfButtonState();
}

class _HalfButtonState extends State<_HalfButton> {
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
        child: InkWell(
          onTap: widget.onTap,
          onFocusChange: (focused) => setState(() => _focused = focused),
          borderRadius: BlynkRadius.mdAll,
          child: Container(
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BlynkRadius.mdAll,
              border: _focused
                  ? Border.all(color: BlynkColors.ink, width: 2)
                  : null,
            ),
            child: Icon(
              widget.icon,
              size: BlynkIcons.lg,
              color: enabled ? BlynkColors.onSignal : BlynkColors.ink2,
            ),
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';

class GenUiQuantityStepper extends StatelessWidget {
  const GenUiQuantityStepper({
    super.key,
    required this.quantity,
    required this.decreaseKey,
    required this.valueKey,
    required this.increaseKey,
    required this.onDecrease,
    required this.onIncrease,
  });

  final int quantity;
  final Key decreaseKey;
  final Key valueKey;
  final Key increaseKey;
  final VoidCallback? onDecrease;
  final VoidCallback? onIncrease;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _QuantityButton(
          buttonKey: decreaseKey,
          icon: LucideIcons.minus,
          onPressed: onDecrease,
        ),
        Container(
          key: valueKey,
          width: 32,
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: KfcOpsTokens.surfaceContainerLowest,
            border: Border.all(color: KfcOpsTokens.secondaryContainer),
          ),
          child: Text(
            '$quantity',
            style: const TextStyle(
              color: KfcOpsTokens.onSurface,
              fontSize: 12,
              fontWeight: FontWeight.w800,
              height: 16 / 12,
              letterSpacing: 0,
            ),
          ),
        ),
        _QuantityButton(
          buttonKey: increaseKey,
          icon: LucideIcons.plus,
          onPressed: onIncrease,
        ),
      ],
    );
  }
}

class _QuantityButton extends StatelessWidget {
  const _QuantityButton({
    required this.buttonKey,
    required this.icon,
    required this.onPressed,
  });

  final IconData icon;
  final Key buttonKey;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 32,
      height: 32,
      child: ShadIconButton.outline(
        key: buttonKey,
        width: 32,
        height: 32,
        iconSize: 13,
        padding: EdgeInsets.zero,
        backgroundColor: KfcOpsTokens.surfaceContainerLowest,
        hoverBackgroundColor: KfcOpsTokens.surfaceContainerLow,
        foregroundColor: KfcOpsTokens.onSurface,
        enabled: onPressed != null,
        onPressed: onPressed,
        icon: Icon(icon),
      ),
    );
  }
}

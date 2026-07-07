import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import 'kfc_ops_tokens.dart';

ShadThemeData buildKfcOpsTheme() {
  const radius = BorderRadius.all(KfcOpsTokens.radiusLg);

  return ShadThemeData(
    brightness: Brightness.light,
    colorScheme: const ShadSlateColorScheme.light(),
    radius: radius,
    textTheme: ShadTextTheme(
      family: KfcOpsTokens.fontFamily,
      h1: const TextStyle(
        color: KfcOpsTokens.onSurface,
        fontSize: 24,
        fontWeight: FontWeight.w700,
        height: 32 / 24,
        letterSpacing: 0,
      ),
      h2: const TextStyle(
        color: KfcOpsTokens.onSurface,
        fontSize: 20,
        fontWeight: FontWeight.w600,
        height: 28 / 20,
        letterSpacing: 0,
      ),
      h3: const TextStyle(
        color: KfcOpsTokens.onSurface,
        fontSize: 16,
        fontWeight: FontWeight.w600,
        height: 24 / 16,
        letterSpacing: 0,
      ),
      p: const TextStyle(
        color: KfcOpsTokens.onSurface,
        fontSize: 14,
        fontWeight: FontWeight.w400,
        height: 20 / 14,
        letterSpacing: 0,
      ),
      small: const TextStyle(
        color: KfcOpsTokens.secondary,
        fontSize: 11,
        fontWeight: FontWeight.w500,
        height: 14 / 11,
        letterSpacing: 0,
      ),
      muted: const TextStyle(
        color: KfcOpsTokens.secondary,
        fontSize: 13,
        fontWeight: FontWeight.w400,
        height: 18 / 13,
        letterSpacing: 0,
      ),
    ),
    decoration: ShadDecoration(
      color: KfcOpsTokens.surfaceContainerLowest,
      border: ShadBorder.all(
        color: KfcOpsTokens.secondaryContainer,
        width: 1,
        radius: radius,
      ),
    ),
    primaryButtonTheme: const ShadButtonTheme(
      backgroundColor: KfcOpsTokens.primary,
      hoverBackgroundColor: KfcOpsTokens.primaryContainer,
      pressedBackgroundColor: KfcOpsTokens.primary,
      foregroundColor: KfcOpsTokens.onPrimary,
      hoverForegroundColor: KfcOpsTokens.onPrimary,
      textStyle: TextStyle(
        fontFamily: KfcOpsTokens.fontFamily,
        fontSize: 12,
        fontWeight: FontWeight.w600,
        height: 16 / 12,
        letterSpacing: 0,
      ),
    ),
    outlineButtonTheme: ShadButtonTheme(
      backgroundColor: KfcOpsTokens.surfaceContainerLowest,
      hoverBackgroundColor: KfcOpsTokens.surfaceContainerLow,
      pressedBackgroundColor: KfcOpsTokens.surfaceContainerLow,
      foregroundColor: KfcOpsTokens.onSurface,
      hoverForegroundColor: KfcOpsTokens.onSurface,
      textStyle: const TextStyle(
        fontFamily: KfcOpsTokens.fontFamily,
        fontSize: 12,
        fontWeight: FontWeight.w600,
        height: 16 / 12,
        letterSpacing: 0,
      ),
      decoration: ShadDecoration(
        color: KfcOpsTokens.surfaceContainerLowest,
        border: ShadBorder.all(
          color: KfcOpsTokens.secondaryContainer,
          width: 1,
          radius: radius,
        ),
      ),
    ),
  );
}

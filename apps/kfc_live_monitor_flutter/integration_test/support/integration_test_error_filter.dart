import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

void ignoreMacOsHardwareKeyboardKeyUpNoise() {
  final previousKeyDataHandler = PlatformDispatcher.instance.onKeyData;
  PlatformDispatcher.instance.onKeyData = (data) {
    final unmatchedKeyUp =
        data.type == KeyEventType.up &&
        !HardwareKeyboard.instance.physicalKeysPressed.any(
          (key) => key.usbHidUsage == data.physical,
        );
    if (unmatchedKeyUp) {
      debugPrint('KFC_INTEGRATION_IGNORED_UNMATCHED_KEYUP=${data.physical}');
      return true;
    }
    return previousKeyDataHandler?.call(data) ?? false;
  };

  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    final exceptionText = details.exceptionAsString();
    if (exceptionText.contains('A KeyUpEvent is dispatched') &&
        exceptionText.contains(
          'the state shows that the physical key is not pressed',
        )) {
      debugPrint(
        'KFC_INTEGRATION_IGNORED_HARDWARE_KEYBOARD_KEYUP=$exceptionText',
      );
      return;
    }
    previous?.call(details);
  };
}

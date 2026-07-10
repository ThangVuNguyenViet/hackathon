import 'package:flutter/foundation.dart';

void ignoreMacOsHardwareKeyboardKeyUpNoise() {
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

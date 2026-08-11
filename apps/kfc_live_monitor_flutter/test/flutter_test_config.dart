import 'dart:async';

import 'flutter_test_config_web.dart'
    if (dart.library.io) 'flutter_test_config_io.dart'
    as platform;

Future<void> testExecutable(FutureOr<void> Function() testMain) {
  return platform.testExecutable(testMain);
}

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/mutation_beacon.dart';
import 'package:state_beacon/state_beacon.dart';

void main() {
  test('mutation moves from idle through loading to data', () async {
    final resultCompleter = Completer<int>();
    final controller = _MutationController((value) async {
      expect(value, 'order-1');
      return resultCompleter.future;
    });

    expect(controller.mutation.isIdle, isTrue);

    final result = controller.mutation.run('order-1');
    expect(controller.mutation.isLoading, isTrue);

    resultCompleter.complete(7);
    await expectLater(result, completion(7));
    expect(controller.mutation.isData, isTrue);
    expect(controller.mutation.value.unwrap(), 7);

    controller.dispose();
  });

  test('mutation records the error and rethrows it', () async {
    final controller = _MutationController((_) async {
      throw StateError('cancel failed');
    });

    await expectLater(
      controller.mutation.run('order-2'),
      throwsA(isA<StateError>()),
    );
    expect(controller.mutation.isError, isTrue);
    expect(
      (controller.mutation.value as AsyncError<int>).error,
      isA<StateError>(),
    );

    controller.dispose();
  });
}

class _MutationController extends BeaconController {
  _MutationController(this.callback);

  final Future<int> Function(String value) callback;

  late final mutation = B.mutation<int, String>(callback);
}

import 'package:flutter/widgets.dart';
import 'package:state_beacon/state_beacon.dart';

/// A controller-owned async operation that is explicitly started with [run].
///
/// This is ported from Braise's local State Beacon utility so commands such as
/// submitting a chat turn and cancelling a run have mutation semantics instead
/// of masquerading as fetchable future state.
class MutationBeacon<T, Arg> extends WritableBeacon<AsyncValue<T>> {
  MutationBeacon(this._mutationFn, {super.name})
    : super(initialValue: AsyncIdle());

  final Future<T> Function(Arg arg) _mutationFn;

  Future<T> run(Arg arg) async {
    value = AsyncLoading();
    try {
      final result = await _mutationFn(arg);
      value = AsyncData(result);
      return result;
    } catch (error, stackTrace) {
      value = AsyncError(error, stackTrace);
      rethrow;
    }
  }

  bool get isLoading => value.isLoading;
  bool get isData => value.isData;
  bool get isError => value.isError;
  bool get isIdle => value.isIdle;

  Future<T> toFuture() async {
    if (value is AsyncData<T>) return value.unwrap();
    await for (final asyncValue in stream) {
      if (asyncValue is AsyncData<T>) return asyncValue.unwrap();
      if (asyncValue is AsyncError<T>) throw asyncValue.error;
    }
    throw StateError('Beacon closed without data');
  }
}

extension MutationBeaconWatch<T, Arg> on MutationBeacon<T, Arg> {
  AsyncValue<T> watch(BuildContext context) {
    return (this as ReadableBeacon<AsyncValue<T>>).watch(context);
  }
}

extension MutationBeaconExtension on BeaconGroup {
  MutationBeacon<T, Arg> mutation<T, Arg>(
    Future<T> Function(Arg arg) mutationFn, {
    String? name,
  }) {
    final beacon = MutationBeacon<T, Arg>(mutationFn, name: name);
    add(beacon);
    return beacon;
  }
}

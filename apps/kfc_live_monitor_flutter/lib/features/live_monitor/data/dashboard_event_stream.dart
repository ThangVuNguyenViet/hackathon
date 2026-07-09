import 'dashboard_event_payload.dart';

abstract interface class DashboardEventStream {
  Stream<DashboardEventPayload> connect();

  void dispose();
}

class NoopDashboardEventStream implements DashboardEventStream {
  const NoopDashboardEventStream();

  @override
  Stream<DashboardEventPayload> connect() =>
      const Stream<DashboardEventPayload>.empty();

  @override
  void dispose() {}
}

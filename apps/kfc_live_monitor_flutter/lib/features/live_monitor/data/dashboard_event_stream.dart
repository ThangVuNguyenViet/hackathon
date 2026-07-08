abstract interface class DashboardEventStream {
  Stream<void> connect();

  void dispose();
}

class NoopDashboardEventStream implements DashboardEventStream {
  const NoopDashboardEventStream();

  @override
  Stream<void> connect() => const Stream<void>.empty();

  @override
  void dispose() {}
}

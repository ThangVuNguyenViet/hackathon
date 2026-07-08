import 'dashboard_event_stream.dart';
import 'dashboard_event_stream_factory_stub.dart'
    if (dart.library.html) 'dashboard_event_stream_factory_web.dart';

DashboardEventStream createDashboardEventStream(String baseUrl) =>
    createPlatformDashboardEventStream(baseUrl);

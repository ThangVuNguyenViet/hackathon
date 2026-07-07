import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/mock_live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';

void main() {
  test(
    'default visible sessions follow the Stitch monitor grid order',
    () async {
      final controller = LiveMonitorController(
        repository: const MockLiveMonitorRepository(),
      );
      await controller.state.toFuture();

      final sessions = controller.visibleSessions.value;

      expect(sessions, hasLength(8));
      expect(sessions.map((session) => session.customerName), [
        'Nguyễn Văn A',
        'Trần Thị B',
        'KFC-1024',
        'Hoàng M',
        'Lê K',
        'User_882',
        'Phạm P',
        'KFC-1088',
      ]);
    },
  );

  test('channel filter keeps only Zalo sessions', () async {
    final controller = LiveMonitorController(
      repository: const MockLiveMonitorRepository(),
    );
    await controller.state.toFuture();

    controller.setChannelFilter(ChatChannel.zalo);

    expect(controller.visibleSessions.value, isNotEmpty);
    expect(
      controller.visibleSessions.value.every(
        (session) => session.channel == ChatChannel.zalo,
      ),
      isTrue,
    );
  });

  test('openSession records deeplink target', () async {
    final controller = LiveMonitorController(
      repository: const MockLiveMonitorRepository(),
    );
    await controller.state.toFuture();

    controller.openSession('session-human-pham-p');

    expect(
      controller.lastOpenedDeeplink.value,
      'mockchat://zalo/session-human-pham-p',
    );
  });
}

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../test_app.dart';

void main() {
  testWidgets('prefills the structured delivery-address draft', (tester) async {
    final attachment = _addressAttachment();

    await _pump(tester, attachment, (_) {});

    expect(
      find.text('54/2 Nguyễn Hồng Đào, P14, Q Tân Bình, TP HCM'),
      findsOneWidget,
    );
    expect(_input(tester, attachment, 'recipientName').controller?.text, 'An');
    expect(_input(tester, attachment, 'phone').controller?.text, '0909123456');
    expect(
      _input(tester, attachment, 'addressLine').controller?.text,
      '54/2 Nguyễn Hồng Đào',
    );
    expect(
      _input(tester, attachment, 'communeName').controller?.text,
      'Phường Tân Bình',
    );
    expect(
      _input(tester, attachment, 'provinceName').controller?.text,
      'Thành phố Hồ Chí Minh',
    );
    expect(
      _input(tester, attachment, 'deliveryInstructions').controller?.text,
      'Gọi khi đến',
    );
  });

  testWidgets('shows backend-reported missing delivery fields', (tester) async {
    final attachment = _addressAttachment(
      addressDraft: const {
        'addressLine': '54/2 Nguyễn Hồng Đào',
        'provinceName': 'Thành phố Hồ Chí Minh',
      },
      missingFields: const ['recipientName', 'phone', 'communeName'],
    );

    await _pump(tester, attachment, (_) {});

    for (final field in ['recipientName', 'phone', 'communeName']) {
      expect(
        find.byKey(
          CustomerChatKeys.genUiAddressMissingField(attachment.id, field),
        ),
        findsOneWidget,
      );
    }
    expect(find.text('Còn thiếu thông tin giao hàng'), findsOneWidget);
  });

  testWidgets('keeps edits local and submits one complete address payload', (
    tester,
  ) async {
    final emitted = <KfcGenUiAction>[];
    final attachment = _addressAttachment(
      addressDraft: const {
        'addressLine': '54/2 Nguyễn Hồng Đào',
        'provinceCode': '79',
        'provinceName': 'Thành phố Hồ Chí Minh',
        'rawAddress': '54/2 Nguyễn Hồng Đào, TP HCM',
      },
      missingFields: const ['recipientName', 'phone', 'communeName'],
    );
    await _pump(tester, attachment, emitted.add);

    await tester.enterText(
      find.byKey(
        CustomerChatKeys.genUiAddressField(attachment.id, 'recipientName'),
      ),
      'Nguyễn An',
    );
    await tester.enterText(
      find.byKey(CustomerChatKeys.genUiAddressField(attachment.id, 'phone')),
      '0909123456',
    );
    await tester.enterText(
      find.byKey(
        CustomerChatKeys.genUiAddressField(attachment.id, 'communeName'),
      ),
      'Phường Tân Bình',
    );
    await tester.enterText(
      find.byKey(
        CustomerChatKeys.genUiAddressField(
          attachment.id,
          'deliveryInstructions',
        ),
      ),
      'Gọi khi đến',
    );
    await tester.pump();

    expect(emitted, isEmpty);

    await tester.tap(
      find.byKey(CustomerChatKeys.genUiAction(attachment.id, 'submit_address')),
    );
    await tester.pump();

    expect(emitted, hasLength(1));
    expect(emitted.single.actionId, 'submit_address');
    expect(emitted.single.payload, {
      'recipientName': 'Nguyễn An',
      'phone': '0909123456',
      'addressLine': '54/2 Nguyễn Hồng Đào',
      'provinceCode': '79',
      'provinceName': 'Thành phố Hồ Chí Minh',
      'communeName': 'Phường Tân Bình',
      'deliveryInstructions': 'Gọi khi đến',
      'rawAddress': '54/2 Nguyễn Hồng Đào, TP HCM',
      'communeCode': null,
      'legacyDistrictText': null,
    });
  });

  testWidgets('does not enable confirm while a required field is empty', (
    tester,
  ) async {
    final attachment = _addressAttachment(
      addressDraft: const {
        'recipientName': 'Nguyễn An',
        'phone': '0909123456',
        'addressLine': '54/2 Nguyễn Hồng Đào',
        'provinceName': 'Thành phố Hồ Chí Minh',
      },
      missingFields: const ['communeName'],
    );
    await _pump(tester, attachment, (_) {});

    final confirm = tester.widget<ShadButton>(
      find.byKey(CustomerChatKeys.genUiAction(attachment.id, 'submit_address')),
    );
    expect(confirm.onPressed, isNull);
  });

  testWidgets('editing an administrative name drops its stale code', (
    tester,
  ) async {
    final emitted = <KfcGenUiAction>[];
    final attachment = _addressAttachment();
    await _pump(tester, attachment, emitted.add);

    await tester.enterText(
      find.byKey(
        CustomerChatKeys.genUiAddressField(attachment.id, 'communeName'),
      ),
      'Phường Bảy Hiền',
    );
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiAction(attachment.id, 'submit_address')),
    );

    expect(emitted.single.payload['communeCode'], isNull);
    expect(emitted.single.payload['provinceCode'], '79');
  });
}

Future<void> _pump(
  WidgetTester tester,
  KfcGenUiAttachment attachment,
  ValueChanged<KfcGenUiAction> onAction,
) async {
  tester.view.physicalSize = const Size(430, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    TestApp(
      child: SingleChildScrollView(
        child: KfcGenUiRenderer(attachment: attachment, onAction: onAction),
      ),
    ),
  );
}

ShadInput _input(
  WidgetTester tester,
  KfcGenUiAttachment attachment,
  String field,
) {
  return tester.widget<ShadInput>(
    find.byKey(CustomerChatKeys.genUiAddressField(attachment.id, field)),
  );
}

KfcGenUiAttachment _addressAttachment({
  Map<String, Object?>? addressDraft,
  List<String> missingFields = const [],
}) {
  return KfcGenUiAttachment(
    id: 'address-draft',
    lifecycleStage: 'fulfillment',
    widgetKind: KfcGenUiWidgetKind.addressFulfillmentCheck,
    status: KfcGenUiStatus.active,
    title: 'Địa chỉ giao hàng',
    data: {
      'addressDraft':
          addressDraft ??
          const {
            'recipientName': 'An',
            'phone': '0909123456',
            'addressLine': '54/2 Nguyễn Hồng Đào',
            'communeCode': '26740',
            'communeName': 'Phường Tân Bình',
            'provinceCode': '79',
            'provinceName': 'Thành phố Hồ Chí Minh',
            'deliveryInstructions': 'Gọi khi đến',
            'rawAddress': '54/2 Nguyễn Hồng Đào, P14, Q Tân Bình, TP HCM',
          },
      'missingFields': missingFields,
    },
    actions: const [
      KfcGenUiActionSpec(
        id: 'submit_address',
        label: 'Xác nhận địa chỉ',
        intent: KfcGenUiActionIntent.primary,
      ),
    ],
  );
}

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_test_goldens/flutter_test_goldens.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/business_presentation_contract.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/business_presentation_shell.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/pvcfc_presentation_models.dart';

import 'multibusiness_presentation_golden_helpers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'one neutral shell renders KFC and PVCFC descriptors without identity branching',
    (tester) async {
      final kfcActions = <BusinessActionMetadata>[];
      final pvcfcActions = <BusinessActionMetadata>[];
      addTearDown(tester.view.reset);
      tester.view.physicalSize = multibusinessCatalogSize;
      tester.view.devicePixelRatio = 1;

      await tester.pumpWidget(
        buildMultibusinessCatalogSurface(
          onKfcAction: kfcActions.add,
          onPvcfcAction: pvcfcActions.add,
        ),
      );

      expect(find.byType(BusinessPresentationShell), findsNWidgets(2));
      expect(find.text('KFC Ordering Chat'), findsOneWidget);
      expect(find.text('Trợ lý thông tin PVCFC'), findsOneWidget);
      expect(find.text('Thanh toán MoMo'), findsOneWidget);
      expect(find.text('Mở trang liên hệ chính thức'), findsOneWidget);
      expect(find.text('Sao chép bản tóm tắt đã xem lại'), findsOneWidget);
      expect(
        find.textContaining('chưa gửi hoặc nộp thông tin'),
        findsOneWidget,
      );

      await tester.tap(find.text('Thanh toán MoMo'));
      await tester.pump();
      expect(kfcActions.single.actionId, 'open_payment');
      expect(kfcActions.single.semantics, BusinessActionSemantics.dispatch);
      expect(kfcActions.single.packPayload, isA<KfcGenUiAction>());

      await tester.tap(
        find.byKey(const ValueKey('pvcfc-action-open-official-url')),
      );
      await tester.pump();
      await tester.tap(
        find.byKey(
          const ValueKey('pvcfc-action-copy-customer-reviewed-summary'),
        ),
      );
      await tester.pump();

      expect(pvcfcActions.map((action) => action.semantics), [
        BusinessActionSemantics.openPublicUrl,
        BusinessActionSemantics.copy,
      ]);
      expect(
        pvcfcActions.every((action) => action.confirmationReference == null),
        isTrue,
      );
    },
  );

  testWidgets('PVCFC mobile fixtures exclude KFC commerce vocabulary', (
    tester,
  ) async {
    const forbiddenKfcCopy = <String>[
      'giỏ hàng',
      'đặt đơn',
      'voucher',
      'combo zinger',
      'thanh toán momo',
    ];
    addTearDown(tester.view.reset);

    for (final kind in PvcfcComponentKind.values) {
      final size = kind == PvcfcComponentKind.citedPublicEvidence
          ? const Size(390, 5200)
          : const Size(390, 1400);
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(buildPvcfcMobileSurface(kind));

      for (final copy in forbiddenKfcCopy) {
        expect(
          find.textContaining(RegExp(copy, caseSensitive: false)),
          findsNothing,
          reason: '$kind must not render KFC-only copy: $copy',
        );
      }
    }
  });

  testGoldenScene('KFC and PVCFC presentation catalog', (tester) async {
    await runMultibusinessCatalogGolden(tester);
  });

  for (final kind in PvcfcComponentKind.values) {
    testGoldenScene('PVCFC ${kind.wireName} mobile state', (tester) async {
      await runPvcfcMobileGolden(tester, kind);
    });
  }
}

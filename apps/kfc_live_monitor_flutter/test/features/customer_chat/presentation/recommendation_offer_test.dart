import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../../test_app.dart';

void main() {
  testWidgets('single recommendation card emits its ID-only Add action', (
    tester,
  ) async {
    final actions = <KfcGenUiAction>[];
    final attachment = _recommendationAttachment(
      placement: 'local_favorite',
      offerCount: 1,
    );

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: attachment, onAction: actions.add),
      ),
    );

    expect(
      find.byKey(
        CustomerChatKeys.genUiRecommendationItem(
          attachment.id,
          'recommendation-action-1',
        ),
      ),
      findsOneWidget,
    );
    expect(find.text('Món gợi ý 1'), findsOneWidget);

    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiAction(
          attachment.id,
          'recommendation_select:recommendation-action-1',
        ),
      ),
    );
    await tester.pump();

    expect(actions.single.toJson(), {
      'attachmentId': attachment.id,
      'actionId': 'recommendation_select:recommendation-action-1',
    });
  });

  testWidgets(
    'cross-sell renders three or four cards and one No-thanks action',
    (tester) async {
      for (final offerCount in [3, 4]) {
        final actions = <KfcGenUiAction>[];
        final attachment = _recommendationAttachment(
          placement: 'smart_cross_sell',
          offerCount: offerCount,
        );

        await tester.pumpWidget(
          TestApp(
            child: SingleChildScrollView(
              child: KfcGenUiRenderer(
                attachment: attachment,
                onAction: actions.add,
              ),
            ),
          ),
        );

        for (var index = 1; index <= offerCount; index += 1) {
          expect(
            find.byKey(
              CustomerChatKeys.genUiRecommendationItem(
                attachment.id,
                'recommendation-action-$index',
              ),
            ),
            findsOneWidget,
          );
        }
        expect(find.text('Thêm vào đơn'), findsNWidgets(offerCount));
        expect(find.text('Không, cảm ơn'), findsOneWidget);

        await tester.tap(
          find.byKey(
            CustomerChatKeys.genUiAction(
              attachment.id,
              'recommendation_dismiss',
            ),
          ),
        );
        await tester.pump();

        expect(actions.single.toJson(), {
          'attachmentId': attachment.id,
          'actionId': 'recommendation_dismiss',
        });
      }
    },
  );

  testWidgets('reports one impression only after the offer renders', (
    tester,
  ) async {
    var impressions = 0;
    final attachment = _recommendationAttachment(
      placement: 'local_favorite',
      offerCount: 1,
    );

    Widget subject() => TestApp(
      child: KfcGenUiRenderer(
        attachment: attachment,
        onAction: (_) {},
        onImpression: () => impressions += 1,
      ),
    );

    expect(impressions, 0);
    await tester.pumpWidget(subject());
    expect(impressions, 1);

    await tester.pump();
    await tester.pumpAndSettle();
    await tester.pumpWidget(subject());
    expect(impressions, 1);
  });

  testWidgets(
    'malformed attachment identity blocks actions and impression authority',
    (tester) async {
      var impressions = 0;
      final attachment = _recommendationAttachment(
        id: 'malformed attachment id',
        placement: 'local_favorite',
        offerCount: 1,
      );

      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(
            attachment: attachment,
            onAction: (_) {},
            onImpression: () => impressions += 1,
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Gợi ý này đang tạm khóa.'), findsOneWidget);
      expect(find.text('Thêm vào đơn'), findsNothing);
      expect(find.text('Không, cảm ơn'), findsNothing);
      expect(impressions, 0);
    },
  );

  testWidgets(
    'replayable recommendation authority blocks actions and impression',
    (tester) async {
      var impressions = 0;
      final attachment = _recommendationAttachment(
        placement: 'local_favorite',
        offerCount: 1,
        actionLifecycle: 'replayable',
      );

      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(
            attachment: attachment,
            onAction: (_) {},
            onImpression: () => impressions += 1,
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Gợi ý này đang tạm khóa.'), findsOneWidget);
      expect(find.text('Thêm vào đơn'), findsNothing);
      expect(find.text('Không, cảm ơn'), findsNothing);
      expect(impressions, 0);
    },
  );

  testWidgets(
    'shows loading, answered, expired, blocked, and stale-authority states',
    (tester) async {
      final active = _recommendationAttachment(
        placement: 'local_favorite',
        offerCount: 1,
      );
      final actions = <KfcGenUiAction>[];

      Future<void> pump(
        KfcGenUiAttachment attachment, {
        String? loadingActionId,
        bool authorityMatches = true,
      }) {
        return tester.pumpWidget(
          TestApp(
            child: KfcGenUiRenderer(
              attachment: attachment,
              onAction: actions.add,
              loadingActionId: loadingActionId,
              authorityMatches: authorityMatches,
            ),
          ),
        );
      }

      final selectionActionId = 'recommendation_select:recommendation-action-1';
      await pump(active, loadingActionId: selectionActionId);
      expect(find.text('Đang thêm…'), findsOneWidget);
      await tester.tap(
        find.byKey(CustomerChatKeys.genUiAction(active.id, selectionActionId)),
        warnIfMissed: false,
      );
      expect(actions, isEmpty);

      await pump(
        _recommendationAttachment(
          placement: 'local_favorite',
          offerCount: 1,
          status: KfcGenUiStatus.answered,
        ),
      );
      expect(find.text('Đã hoàn tất'), findsWidgets);
      expect(find.text('Thêm vào đơn'), findsNothing);

      await pump(
        _recommendationAttachment(
          placement: 'local_favorite',
          offerCount: 1,
          status: KfcGenUiStatus.expired,
        ),
      );
      expect(find.text('Gợi ý này đã hết hạn.'), findsOneWidget);
      expect(find.text('Thêm vào đơn'), findsNothing);

      await pump(
        _recommendationAttachment(
          placement: 'local_favorite',
          offerCount: 1,
          status: KfcGenUiStatus.blocked,
        ),
      );
      expect(find.text('Gợi ý này đang tạm khóa.'), findsOneWidget);
      expect(find.text('Thêm vào đơn'), findsNothing);

      await pump(active, authorityMatches: false);
      expect(
        find.text('Gợi ý này không còn khớp với phiên hiện tại.'),
        findsOneWidget,
      );
      expect(find.text('Thêm vào đơn'), findsNothing);
    },
  );
}

KfcGenUiAttachment _recommendationAttachment({
  String? id,
  required String placement,
  required int offerCount,
  String actionLifecycle = 'one_shot',
  KfcGenUiStatus status = KfcGenUiStatus.active,
}) {
  final offers = [
    for (var index = 1; index <= offerCount; index += 1)
      {
        'recommendationActionId': 'recommendation-action-$index',
        'kind': placement == 'modifier_upsell' ? 'modifier' : 'product',
        'name': 'Món gợi ý $index',
        'imageUrl': null,
        'price': {'amount': 19000 + index * 1000, 'currency': 'VND'},
        'priceImpact': {'amount': 19000 + index * 1000, 'currency': 'VND'},
      },
  ];
  return KfcGenUiAttachment(
    id: id ?? 'recommendation-attachment-$placement-$offerCount',
    lifecycleStage: 'recommendation',
    widgetKind: KfcGenUiWidgetKind.recommendationOffer,
    status: status,
    title: placement == 'smart_cross_sell'
        ? 'Có thể bạn cũng thích'
        : 'Gợi ý dành cho bạn',
    data: {
      'recommendationId': 'recommendation-$placement-$offerCount',
      'orderFlowId': 'order-flow-1',
      'placement': placement,
      'decisionSource': 'ranked',
      'offers': offers,
      'reasonCodes': ['completes_your_meal'],
      'reasonText': ['Giúp hoàn thiện bữa ăn'],
      'cartRevision': 'cart-revision-1',
      'actionDigest':
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'decisionDigest':
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'versionBindingDigest':
          'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
    actions: [
      for (var index = 1; index <= offerCount; index += 1)
        KfcGenUiActionSpec(
          id: 'recommendation_select:recommendation-action-$index',
          label: 'Thêm vào đơn',
          intent: KfcGenUiActionIntent.primary,
        ),
      const KfcGenUiActionSpec(
        id: 'recommendation_dismiss',
        label: 'Không, cảm ơn',
      ),
    ],
    expiresAt: '2099-07-28T02:00:00.000Z',
    authority: KfcGenUiAuthority(
      schemaVersion: 'kfc-genui-v1',
      sessionId: 'kfc:customer-1',
      customerId: 'customer-1',
      verifiedRevision:
          'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      actionLifecycle: actionLifecycle,
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-07-28T02:00:00.000Z',
    ),
  );
}

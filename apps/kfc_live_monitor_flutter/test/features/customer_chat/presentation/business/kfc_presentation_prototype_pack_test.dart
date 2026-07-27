import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/business_presentation_contract.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/business_presentation_shell.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/kfc_presentation_prototype_pack.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../../../test_app.dart';

void main() {
  test(
    'KFC production adapter has no data, repository, or network imports',
    () {
      final source = File(
        'lib/features/customer_chat/presentation/business/'
        'kfc_presentation_prototype_pack.dart',
      ).readAsStringSync();

      expect(source, isNot(contains('/data/')));
      expect(source, isNot(contains('customer_chat_repository.dart')));
      expect(source, isNot(contains('dart:io')));
      expect(source, isNot(contains('package:http')));
      expect(source, isNot(contains('sse')));
    },
  );

  for (final kind in KfcGenUiWidgetKind.values) {
    testWidgets(
      'KFC adapter delegates ${kind.wireName} through neutral shell',
      (tester) async {
        final attachment = kfcGenUiFixture(kind);

        await tester.pumpWidget(
          TestApp(
            child: SingleChildScrollView(
              child: BusinessPresentationShell(
                descriptor: KfcPresentationPrototypePack.descriptor,
                envelope: KfcPresentationPrototypePack.envelopeFor(
                  attachment: attachment,
                  canonicalText: 'Nội dung chuẩn cho ${kind.wireName}.',
                ),
              ),
            ),
          ),
        );

        expect(find.byKey(CustomerChatKeys.genUi(kind)), findsOneWidget);
        expect(find.text(attachment.title), findsOneWidget);
      },
    );
  }

  testWidgets('KFC adapter rejects unknown component kind and schema exactly', (
    tester,
  ) async {
    final attachment = kfcGenUiFixture(KfcGenUiWidgetKind.productDetailCard);
    final validEnvelope = KfcPresentationPrototypePack.envelopeFor(
      attachment: attachment,
      canonicalText: 'Canonical fallback survives.',
    );

    for (final identity in const [
      BusinessComponentIdentity(
        packId: 'kfc-vietnam',
        componentKind: 'unknown-component',
        schemaVersion: '1',
      ),
      BusinessComponentIdentity(
        packId: 'kfc-vietnam',
        componentKind: 'productDetailCard',
        schemaVersion: '999',
      ),
    ]) {
      await tester.pumpWidget(
        TestApp(
          child: BusinessPresentationShell(
            descriptor: KfcPresentationPrototypePack.descriptor,
            envelope: BusinessPresentationEnvelope(
              pack: KfcPresentationPrototypePack.pack,
              canonicalText: validEnvelope.canonicalText,
              component: BusinessComponentEnvelope(
                componentId: attachment.id,
                identity: identity,
                payload: validEnvelope.component!.payload,
              ),
            ),
          ),
        ),
      );

      expect(find.text('Canonical fallback survives.'), findsOneWidget);
      expect(
        find.byKey(CustomerChatKeys.genUi(attachment.widgetKind)),
        findsNothing,
      );
    }
  });

  testWidgets(
    'KFC adapter rejects wrong payload, component ID, and widget kind bindings',
    (tester) async {
      final attachment = kfcGenUiFixture(KfcGenUiWidgetKind.productDetailCard);
      final validEnvelope = KfcPresentationPrototypePack.envelopeFor(
        attachment: attachment,
        canonicalText: 'Canonical binding fallback.',
      );
      final validComponent = validEnvelope.component!;
      final rejectedComponents = <BusinessComponentEnvelope>[
        BusinessComponentEnvelope(
          componentId: attachment.id,
          identity: validComponent.identity,
          payload: const _WrongPayload(),
        ),
        BusinessComponentEnvelope(
          componentId: 'wrong-component-id',
          identity: validComponent.identity,
          payload: validComponent.payload,
        ),
        BusinessComponentEnvelope(
          componentId: attachment.id,
          identity: KfcPresentationPrototypePack.componentIdentityFor(
            KfcGenUiWidgetKind.smartMenuPicker,
          ),
          payload: validComponent.payload,
        ),
      ];

      for (final component in rejectedComponents) {
        await tester.pumpWidget(
          TestApp(
            child: BusinessPresentationShell(
              descriptor: KfcPresentationPrototypePack.descriptor,
              envelope: BusinessPresentationEnvelope(
                pack: KfcPresentationPrototypePack.pack,
                canonicalText: validEnvelope.canonicalText,
                component: component,
              ),
            ),
          ),
        );

        expect(find.text('Canonical binding fallback.'), findsOneWidget);
        expect(
          find.byKey(CustomerChatKeys.genUi(attachment.widgetKind)),
          findsNothing,
        );
        expect(
          find.byKey(
            CustomerChatKeys.genUi(KfcGenUiWidgetKind.smartMenuPicker),
          ),
          findsNothing,
        );
      }
    },
  );

  testWidgets('shell rejects KFC Pack version and catalog mismatches', (
    tester,
  ) async {
    final attachment = kfcGenUiFixture(KfcGenUiWidgetKind.productDetailCard);
    final validEnvelope = KfcPresentationPrototypePack.envelopeFor(
      attachment: attachment,
      canonicalText: 'Must not survive a Pack mismatch.',
    );

    for (final mismatchedPack in const [
      BusinessPackReference(
        packId: 'kfc-vietnam',
        packVersion: 'other-version',
        presentationCatalogVersion: 'kfc-genui-v1',
      ),
      BusinessPackReference(
        packId: 'kfc-vietnam',
        packVersion: 'current',
        presentationCatalogVersion: 'other-catalog',
      ),
    ]) {
      await tester.pumpWidget(
        TestApp(
          child: BusinessPresentationShell(
            descriptor: KfcPresentationPrototypePack.descriptor,
            envelope: BusinessPresentationEnvelope(
              pack: mismatchedPack,
              canonicalText: validEnvelope.canonicalText,
              component: validEnvelope.component,
            ),
          ),
        ),
      );

      expect(find.text('KFC Ordering Chat'), findsNothing);
      expect(find.text('Must not survive a Pack mismatch.'), findsNothing);
      expect(
        find.byKey(CustomerChatKeys.genUi(attachment.widgetKind)),
        findsNothing,
      );
    }
  });

  testWidgets('shell rejects blank canonical text before KFC delegation', (
    tester,
  ) async {
    final attachment = kfcGenUiFixture(KfcGenUiWidgetKind.productDetailCard);

    await tester.pumpWidget(
      TestApp(
        child: BusinessPresentationShell(
          descriptor: KfcPresentationPrototypePack.descriptor,
          envelope: KfcPresentationPrototypePack.envelopeFor(
            attachment: attachment,
            canonicalText: '   ',
          ),
        ),
      ),
    );

    expect(find.text('KFC Ordering Chat'), findsNothing);
    expect(
      find.byKey(CustomerChatKeys.genUi(attachment.widgetKind)),
      findsNothing,
    );
  });

  testWidgets('KFC adapter maps all four neutral action intents', (
    tester,
  ) async {
    const attachment = KfcGenUiAttachment(
      id: 'intent_mapping',
      lifecycleStage: 'evidence',
      widgetKind: KfcGenUiWidgetKind.allergenEvidence,
      status: KfcGenUiStatus.active,
      title: 'Kiểm tra ánh xạ hành động',
      data: {
        'item': {'name': 'Sản phẩm thử nghiệm'},
        'evidence': {'snippet': 'Thông tin bằng chứng thử nghiệm.'},
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'primary_action',
          label: 'Chính',
          intent: KfcGenUiActionIntent.primary,
        ),
        KfcGenUiActionSpec(
          id: 'secondary_action',
          label: 'Phụ',
          intent: KfcGenUiActionIntent.secondary,
        ),
        KfcGenUiActionSpec(
          id: 'destructive_action',
          label: 'Xóa',
          intent: KfcGenUiActionIntent.destructive,
        ),
        KfcGenUiActionSpec(
          id: 'recovery_action',
          label: 'Khôi phục',
          intent: KfcGenUiActionIntent.recovery,
        ),
      ],
    );
    final actions = <BusinessActionMetadata>[];

    await tester.pumpWidget(
      TestApp(
        child: SingleChildScrollView(
          child: BusinessPresentationShell(
            descriptor: KfcPresentationPrototypePack.descriptor,
            envelope: KfcPresentationPrototypePack.envelopeFor(
              attachment: attachment,
              canonicalText: 'Kiểm tra bốn kiểu hành động.',
            ),
            onAction: actions.add,
          ),
        ),
      ),
    );

    for (final action in attachment.actions) {
      await tester.tap(
        find.byKey(CustomerChatKeys.genUiAction(attachment.id, action.id)),
      );
      await tester.pump();
    }

    expect(actions.map((action) => action.intent), [
      BusinessPresentationActionIntent.primary,
      BusinessPresentationActionIntent.secondary,
      BusinessPresentationActionIntent.destructive,
      BusinessPresentationActionIntent.recovery,
    ]);
  });
}

class _WrongPayload {
  const _WrongPayload();
}

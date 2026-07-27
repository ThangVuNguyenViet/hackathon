import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/business_presentation_contract.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/business_presentation_shell.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/kfc_presentation_prototype_pack.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/pvcfc_presentation_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/pvcfc_presentation_prototype_pack.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../../../test_app.dart';

void main() {
  const pack = BusinessPackReference(
    packId: 'test-pack',
    packVersion: '1.0.0',
    presentationCatalogVersion: '1',
  );
  const identity = BusinessComponentIdentity(
    packId: 'test-pack',
    componentKind: 'test-card',
    schemaVersion: '1',
  );
  const payload = _OpaquePayload('kept opaque');

  BusinessPresentationDescriptor descriptor({
    BusinessComponentIdentity registeredIdentity = identity,
    List<BusinessPresentationBadge>? persistentBadges,
    List<BusinessRendererRegistration>? rendererRegistrations,
  }) {
    return BusinessPresentationDescriptor(
      businessId: 'test-business',
      pack: pack,
      title: 'Test Assistant',
      subtitle: 'Pack-owned subtitle',
      monogram: 'TA',
      theme: const BusinessPresentationThemeTokens(
        primary: Color(0xFF123456),
        onPrimary: Color(0xFFFFFFFF),
        surface: Color(0xFFF7F7F7),
        onSurface: Color(0xFF111111),
        secondaryText: Color(0xFF555555),
        outline: Color(0xFFCCCCCC),
      ),
      copy: const BusinessPresentationCopy(
        primaryLocale: 'vi-VN',
        canonicalTextSemanticsLabel: 'Nội dung trả lời',
        disclosureSemanticsLabel: 'Thông tin cần lưu ý',
      ),
      persistentBadges:
          persistentBadges ??
          const [
            BusinessPresentationBadge(
              id: 'fixture-only',
              label: 'Dữ liệu minh họa',
              persistent: true,
            ),
          ],
      mediaPolicy: const BusinessMediaPolicy(
        packId: 'test-pack',
        allowedHost: 'media.example.test',
        mediaKeyPrefix: 'test-pack:',
      ),
      navigationCitationUrlPolicy: NavigationCitationUrlPolicy(
        packId: 'test-pack',
        allowedSchemes: {'https'},
        allowedHosts: {'www.example.test'},
        allowedRoles: {
          BusinessNavigationRole.navigation,
          BusinessNavigationRole.citation,
          BusinessNavigationRole.form,
          BusinessNavigationRole.contact,
          BusinessNavigationRole.document,
        },
      ),
      rendererRegistrations:
          rendererRegistrations ??
          [
            BusinessRendererRegistration(
              identity: registeredIdentity,
              renderer: (context, component, onAction) {
                expect(identical(component.payload, payload), isTrue);
                return const _ProbeComponent();
              },
            ),
          ],
    );
  }

  test('descriptor snapshots badge and renderer registration lists', () {
    final badges = <BusinessPresentationBadge>[
      const BusinessPresentationBadge(
        id: 'persistent',
        label: 'Persistent badge',
        persistent: true,
      ),
    ];
    final registrations = <BusinessRendererRegistration>[
      BusinessRendererRegistration(
        identity: identity,
        renderer: (context, component, onAction) => const _ProbeComponent(),
      ),
    ];
    final snapshot = descriptor(
      persistentBadges: badges,
      rendererRegistrations: registrations,
    );

    badges.clear();
    registrations.clear();

    expect(snapshot.persistentBadges, hasLength(1));
    expect(snapshot.rendererRegistrations, hasLength(1));
    expect(
      () => snapshot.persistentBadges.add(
        const BusinessPresentationBadge(
          id: 'late',
          label: 'Late mutation',
          persistent: true,
        ),
      ),
      throwsUnsupportedError,
    );
    expect(
      () => snapshot.rendererRegistrations.clear(),
      throwsUnsupportedError,
    );
  });

  test('descriptor rejects duplicate exact renderer identities', () {
    final first = BusinessRendererRegistration(
      identity: identity,
      renderer: (context, component, onAction) => const _ProbeComponent(),
    );
    final duplicate = BusinessRendererRegistration(
      identity: identity,
      renderer: (context, component, onAction) => const SizedBox.shrink(),
    );

    expect(
      () => descriptor(rendererRegistrations: [first, duplicate]),
      throwsArgumentError,
    );
  });

  test('navigation policy snapshots authority and role sets', () {
    final schemes = <String>{'https'};
    final hosts = <String>{'www.example.test'};
    final roles = <BusinessNavigationRole>{BusinessNavigationRole.citation};
    final policy = NavigationCitationUrlPolicy(
      packId: 'test-pack',
      allowedSchemes: schemes,
      allowedHosts: hosts,
      allowedRoles: roles,
    );

    schemes.add('http');
    hosts.add('evil.example.test');
    roles.add(BusinessNavigationRole.form);

    expect(policy.allowedSchemes, {'https'});
    expect(policy.allowedHosts, {'www.example.test'});
    expect(policy.allowedRoles, {BusinessNavigationRole.citation});
    expect(() => policy.allowedSchemes.add('ftp'), throwsUnsupportedError);
    expect(
      () => policy.allowedHosts.add('late.example.test'),
      throwsUnsupportedError,
    );
    expect(
      () => policy.allowedRoles.add(BusinessNavigationRole.contact),
      throwsUnsupportedError,
    );
  });

  testWidgets(
    'shell renders canonical content and delegates exact Pack component',
    (tester) async {
      await tester.pumpWidget(
        TestApp(
          child: BusinessPresentationShell(
            descriptor: descriptor(),
            envelope: const BusinessPresentationEnvelope(
              pack: pack,
              canonicalText: 'Nội dung chuẩn luôn còn hiển thị.',
              component: BusinessComponentEnvelope(
                componentId: 'component-1',
                identity: identity,
                payload: payload,
              ),
            ),
          ),
        ),
      );

      expect(find.text('Test Assistant'), findsOneWidget);
      expect(find.text('Pack-owned subtitle'), findsOneWidget);
      expect(find.text('Nội dung chuẩn luôn còn hiển thị.'), findsOneWidget);
      expect(find.text('Dữ liệu minh họa'), findsOneWidget);
      expect(find.byType(_ProbeComponent), findsOneWidget);
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is Semantics &&
              widget.properties.label == 'Nội dung trả lời',
        ),
        findsOneWidget,
      );
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is Semantics &&
              widget.properties.label == 'Thông tin cần lưu ý',
        ),
        findsOneWidget,
      );
      final header = find.byWidgetPredicate(
        (widget) => widget is Semantics && widget.properties.header == true,
      );
      expect(header, findsOneWidget);
      expect(
        find.descendant(of: header, matching: find.text('Test Assistant')),
        findsOneWidget,
      );
    },
  );

  testWidgets('unknown and cross-Pack components fail closed', (tester) async {
    const crossPackIdentity = BusinessComponentIdentity(
      packId: 'other-pack',
      componentKind: 'test-card',
      schemaVersion: '1',
    );

    await tester.pumpWidget(
      TestApp(
        child: BusinessPresentationShell(
          descriptor: descriptor(registeredIdentity: crossPackIdentity),
          envelope: const BusinessPresentationEnvelope(
            pack: pack,
            canonicalText: 'Canonical fallback survives.',
            component: BusinessComponentEnvelope(
              componentId: 'component-1',
              identity: crossPackIdentity,
              payload: payload,
            ),
          ),
        ),
      ),
    );

    expect(find.text('Canonical fallback survives.'), findsOneWidget);
    expect(find.byType(_ProbeComponent), findsNothing);
  });

  test('neutral actions are metadata with opaque Pack payload', () {
    const domainPayload = _OpaquePayload('domain-owned action');
    const action = BusinessActionMetadata(
      actionId: 'open-source',
      label: 'Mở nguồn chính thức',
      intent: BusinessPresentationActionIntent.recovery,
      semantics: BusinessActionSemantics.openPublicUrl,
      publicUrl: 'https://www.example.test/source',
      copyText: 'Thông tin để sao chép',
      displayValue: 'example.test/source',
      evidenceRef: 'evidence-1',
      confirmationReference: 'confirmation-1',
      packPayload: domainPayload,
    );

    expect(action.intent, BusinessPresentationActionIntent.recovery);
    expect(action.semantics, BusinessActionSemantics.openPublicUrl);
    expect(identical(action.packPayload, domainPayload), isTrue);
    expect(action.evidenceRef, 'evidence-1');
    expect(action.confirmationReference, 'confirmation-1');
  });

  test(
    'media policy requires known Pack evidence and exact expected identity',
    () {
      const policy = BusinessMediaPolicy(
        packId: 'test-pack',
        allowedHost: 'media.example.test',
        mediaKeyPrefix: 'test-pack:',
      );
      const evidence = BusinessEvidenceReference(
        packId: 'test-pack',
        evidenceId: 'evidence-1',
      );
      const valid = BusinessMediaReference(
        packId: 'test-pack',
        mediaKey: 'test-pack:item-1',
        url: 'https://media.example.test/items/1.png',
        altText: 'Mô tả ảnh',
        evidenceRef: evidence,
      );
      const missingEvidence = BusinessMediaReference(
        packId: 'test-pack',
        mediaKey: 'test-pack:item-1',
        url: 'https://media.example.test/items/1.png',
        altText: 'Mô tả ảnh',
      );
      final knownEvidenceRefs = {evidence};

      bool allows(
        BusinessMediaReference media, {
        BusinessEvidenceReference? expectedEvidenceRef,
      }) {
        return policy.allows(
          media,
          knownEvidenceRefs: knownEvidenceRefs,
          expectedEvidenceRef: expectedEvidenceRef,
        );
      }

      expect(allows(valid, expectedEvidenceRef: evidence), isTrue);
      expect(allows(missingEvidence), isFalse);
      expect(
        allows(
          valid.copyWith(
            evidenceRef: const BusinessEvidenceReference(
              packId: 'test-pack',
              evidenceId: 'unknown-evidence',
            ),
          ),
        ),
        isFalse,
      );
      expect(
        allows(
          valid,
          expectedEvidenceRef: const BusinessEvidenceReference(
            packId: 'test-pack',
            evidenceId: 'orphan-evidence',
          ),
        ),
        isFalse,
      );
      expect(
        allows(
          valid.copyWith(
            evidenceRef: const BusinessEvidenceReference(
              packId: 'other-pack',
              evidenceId: 'evidence-1',
            ),
          ),
        ),
        isFalse,
      );
      expect(allows(valid.copyWith(packId: 'other-pack')), isFalse);
      expect(allows(valid.copyWith(mediaKey: 'other:item-1')), isFalse);
      expect(
        allows(valid.copyWith(url: 'http://media.example.test/items/1.png')),
        isFalse,
      );
      expect(
        allows(
          valid.copyWith(
            url: 'https://media.example.test.evil.test/items/1.png',
          ),
        ),
        isFalse,
      );
      expect(allows(valid.copyWith(altText: '  ')), isFalse);
    },
  );

  test(
    'navigation policy requires known evidence, role, and exact authority',
    () {
      final policy = NavigationCitationUrlPolicy(
        packId: 'test-pack',
        allowedSchemes: {'https'},
        allowedHosts: {'www.example.test'},
        allowedRoles: {BusinessNavigationRole.citation},
      );
      const evidence = BusinessEvidenceReference(
        packId: 'test-pack',
        evidenceId: 'evidence-1',
      );
      const valid = BusinessNavigationReference(
        packId: 'test-pack',
        url: 'https://www.example.test/public/source',
        role: BusinessNavigationRole.citation,
        evidenceRef: evidence,
      );
      const missingEvidence = BusinessNavigationReference(
        packId: 'test-pack',
        url: 'https://www.example.test/public/source',
        role: BusinessNavigationRole.citation,
      );
      final knownEvidenceRefs = {evidence};

      bool allows(
        BusinessNavigationReference reference, {
        BusinessEvidenceReference? expectedEvidenceRef,
      }) {
        return policy.allows(
          reference,
          knownEvidenceRefs: knownEvidenceRefs,
          expectedEvidenceRef: expectedEvidenceRef,
        );
      }

      expect(allows(valid, expectedEvidenceRef: evidence), isTrue);
      expect(allows(missingEvidence), isFalse);
      expect(
        allows(valid.copyWith(role: BusinessNavigationRole.form)),
        isFalse,
      );
      expect(
        allows(
          valid.copyWith(
            evidenceRef: const BusinessEvidenceReference(
              packId: 'test-pack',
              evidenceId: 'unknown-evidence',
            ),
          ),
        ),
        isFalse,
      );
      expect(
        allows(
          valid,
          expectedEvidenceRef: const BusinessEvidenceReference(
            packId: 'test-pack',
            evidenceId: 'orphan-evidence',
          ),
        ),
        isFalse,
      );
      expect(
        allows(
          valid.copyWith(
            evidenceRef: const BusinessEvidenceReference(
              packId: 'other-pack',
              evidenceId: 'evidence-1',
            ),
          ),
        ),
        isFalse,
      );
      expect(allows(valid.copyWith(packId: 'other-pack')), isFalse);
      expect(
        allows(valid.copyWith(url: 'https://media.example.test/item.png')),
        isFalse,
      );
      expect(
        allows(
          valid.copyWith(url: 'https://www.example.test.evil.test/source'),
        ),
        isFalse,
      );
    },
  );

  test('KFC media policy rejects media without evidence linkage', () {
    const missingEvidence = BusinessMediaReference(
      packId: 'kfc-vietnam',
      mediaKey: 'kfcvn:item-1',
      url: 'https://static.kfcvietnam.com.vn/items/1.png',
      altText: 'Món KFC',
    );

    expect(
      KfcPresentationPrototypePack.descriptor.mediaPolicy.allows(
        missingEvidence,
        knownEvidenceRefs: const {},
      ),
      isFalse,
    );
  });

  testWidgets('Pack-neutral header keeps long monograms on one fitted line', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    try {
      await tester.pumpWidget(
        TestApp(
          child: BusinessPresentationShell(
            descriptor: PvcfcPresentationPrototypePack.descriptor,
            envelope: PvcfcPresentationPrototypePack.fixtureEnvelope(
              PvcfcComponentKind.officialPublicContactHandoff,
            ),
          ),
        ),
      );

      final monogramFinder = find.text('PVCFC');
      final monogram = tester.widget<Text>(monogramFinder);
      final monogramBoxFinder = find.ancestor(
        of: monogramFinder,
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is SizedBox && widget.width == 42 && widget.height == 42,
        ),
      );

      expect(monogram.maxLines, 1);
      expect(monogram.softWrap, isFalse);
      expect(
        find.ancestor(of: monogramFinder, matching: find.byType(FittedBox)),
        findsOneWidget,
      );
      expect(monogramBoxFinder, findsOneWidget);
      expect(tester.getSize(monogramBoxFinder), const Size.square(42));

      final monogramRect = tester.getRect(monogramFinder);
      final boxRect = tester.getRect(monogramBoxFinder);
      expect(monogramRect.left, greaterThanOrEqualTo(boxRect.left));
      expect(monogramRect.top, greaterThanOrEqualTo(boxRect.top));
      expect(monogramRect.right, lessThanOrEqualTo(boxRect.right));
      expect(monogramRect.bottom, lessThanOrEqualTo(boxRect.bottom));

      final headerFinder = find.ancestor(
        of: find.text('Trợ lý thông tin PVCFC'),
        matching: find.byWidgetPredicate(
          (widget) => widget is Semantics && widget.properties.header == true,
        ),
      );
      final headerSemantics = tester.getSemantics(headerFinder);
      expect(headerSemantics.label, contains('PVCFC'));
      expect(headerSemantics.label, contains('Trợ lý thông tin PVCFC'));
      expect(
        headerSemantics.getSemanticsData().flagsCollection.isHeader,
        isTrue,
      );
    } finally {
      semantics.dispose();
    }
  });

  testWidgets(
    'KFC fixture renders through neutral shell with its action metadata',
    (tester) async {
      final attachment = kfcGenUiFixture(KfcGenUiWidgetKind.orderReviewConfirm);
      final actions = <BusinessActionMetadata>[];

      await tester.pumpWidget(
        TestApp(
          child: SingleChildScrollView(
            child: BusinessPresentationShell(
              descriptor: KfcPresentationPrototypePack.descriptor,
              envelope: KfcPresentationPrototypePack.envelopeFor(
                attachment: attachment,
                canonicalText: 'Vui lòng kiểm tra và xác nhận đơn KFC.',
              ),
              onAction: actions.add,
            ),
          ),
        ),
      );

      expect(KfcPresentationPrototypePack.componentIdentities, hasLength(12));
      expect(find.text('KFC Ordering Chat'), findsOneWidget);
      expect(find.text('Đặt món nhanh với trợ lý KFC'), findsOneWidget);
      expect(find.text('Xác nhận đơn'), findsOneWidget);
      expect(find.text('Đặt đơn 145.000đ'), findsOneWidget);

      await tester.tap(
        find.byKey(
          CustomerChatKeys.genUiAction(attachment.id, 'confirm_order'),
        ),
      );
      await tester.pump();

      expect(actions.single.actionId, 'confirm_order');
      expect(actions.single.intent, BusinessPresentationActionIntent.primary);
      expect(actions.single.semantics, BusinessActionSemantics.dispatch);
      expect(actions.single.packPayload, isA<KfcGenUiAction>());
      expect(
        (actions.single.packPayload! as KfcGenUiAction).value,
        'confirmed',
      );
    },
  );

  testWidgets('KFC adapter preserves support handoff lifecycle state', (
    tester,
  ) async {
    final attachment = kfcGenUiFixture(KfcGenUiWidgetKind.supportHandoff);

    await tester.pumpWidget(
      TestApp(
        child: SingleChildScrollView(
          child: BusinessPresentationShell(
            descriptor: KfcPresentationPrototypePack.descriptor,
            envelope: KfcPresentationPrototypePack.envelopeFor(
              attachment: attachment,
              canonicalText: 'Nhân viên KFC đang tiếp nhận cuộc trò chuyện.',
              handoffStatus: 'joined',
            ),
          ),
        ),
      ),
    );

    expect(find.text('Nhân viên KFC đã tham gia'), findsOneWidget);
  });
}

class _OpaquePayload {
  const _OpaquePayload(this.value);

  final String value;
}

class _ProbeComponent extends StatelessWidget {
  const _ProbeComponent();

  @override
  Widget build(BuildContext context) => const Text('Pack renderer output');
}

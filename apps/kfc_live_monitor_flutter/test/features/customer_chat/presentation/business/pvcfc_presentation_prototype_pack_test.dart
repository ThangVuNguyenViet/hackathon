import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/business_presentation_contract.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/business_presentation_shell.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/kfc_presentation_prototype_pack.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/pvcfc_presentation_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/pvcfc_presentation_prototype_pack.dart';

import '../../../test_app.dart';

void main() {
  Future<void> pumpFixture(
    WidgetTester tester,
    PvcfcComponentKind kind, {
    ValueChanged<BusinessActionMetadata>? onAction,
  }) async {
    await tester.pumpWidget(
      TestApp(
        child: SingleChildScrollView(
          child: BusinessPresentationShell(
            descriptor: kind == PvcfcComponentKind.syntheticWorkflowStatus
                ? PvcfcPresentationPrototypePack.syntheticDescriptor
                : PvcfcPresentationPrototypePack.descriptor,
            envelope: PvcfcPresentationPrototypePack.fixtureEnvelope(kind),
            onAction: onAction ?? (_) {},
          ),
        ),
      ),
    );
  }

  testWidgets('all PVCFC components render through the neutral shell', (
    tester,
  ) async {
    const expectedCopy = {
      PvcfcComponentKind.citedPublicEvidence:
          'Bằng chứng công khai có dẫn nguồn',
      PvcfcComponentKind.officialPublicContactHandoff:
          'Chuyển tiếp qua kênh chính thức',
      PvcfcComponentKind.syntheticWorkflowStatus: 'Trạng thái yêu cầu mô phỏng',
    };

    for (final kind in PvcfcComponentKind.values) {
      await pumpFixture(tester, kind);

      expect(find.text('Trợ lý thông tin PVCFC'), findsOneWidget);
      expect(
        find.text('Nguồn công khai, chuyển tiếp minh bạch'),
        findsOneWidget,
      );
      expect(find.text('PVCFC'), findsOneWidget);
      expect(find.text(expectedCopy[kind]!), findsOneWidget);
      expect(
        find.byKey(ValueKey('pvcfc-component-${kind.wireName}')),
        findsOneWidget,
      );
    }
  });

  testWidgets(
    'cited evidence shows identity, authority, dates, freshness, and language truth',
    (tester) async {
      await pumpFixture(tester, PvcfcComponentKind.citedPublicEvidence);

      expect(find.text('Sản phẩm / quy cách'), findsOneWidget);
      expect(find.text('Khuyến cáo nông học'), findsOneWidget);
      expect(find.text('Giá tham khảo theo thời điểm'), findsOneWidget);
      expect(find.text('Tài liệu phát triển bền vững'), findsNWidgets(2));
      expect(
        find.textContaining(
          'Nguồn tiếng Anh đã được xác minh; tóm tắt được dịch sang tiếng Việt',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining(
          'Nguồn tiếng Việt đã được xác minh; nội dung hiển thị trực tiếp bằng tiếng Việt',
        ),
        findsNWidgets(5),
      );
      expect(
        find.textContaining(
          'Nếu trả lời bằng tiếng Anh, phải ghi rõ là bản dịch/tóm tắt vì chưa có bản tiếng Anh được xác minh',
        ),
        findsNWidgets(5),
      );
      expect(
        find.textContaining(
          'Tóm tắt từ nguồn tiếng Việt; chưa có bản tiếng Anh',
        ),
        findsNothing,
      );
      expect(find.textContaining('Lịch sử / có thể đã cũ'), findsOneWidget);
      expect(find.textContaining('Ngày công bố/hiệu lực:'), findsWidgets);
      expect(
        find.textContaining('Ngày chụp nguồn: 21/07/2026'),
        findsNWidgets(6),
      );
      expect(find.textContaining('Mã bằng chứng:'), findsNWidgets(6));
      expect(find.textContaining('Thẩm quyền:'), findsNWidgets(6));
      expect(find.textContaining('Giới hạn:'), findsNWidgets(6));
      expect(find.textContaining('https://www.pvcfc.com.vn/'), findsWidgets);
      expect(
        find.textContaining('Báo cáo Phát triển bền vững năm 2025 Online'),
        findsWidgets,
      );
      expect(
        find.textContaining('Phat-Trien-Ben-Vung-2025/index.html'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Phat-trien-ben-vung-2025.pdf'),
        findsOneWidget,
      );
      expect(
        find.textContaining(
          'Cùng kỳ báo cáo 2025: bản HTML trực tuyến ↔ bản PDF tải xuống',
        ),
        findsNWidgets(2),
      );
      expect(
        find.textContaining('DCM - Thông cáo nhà đầu tư tháng 06/2026'),
        findsWidgets,
      );
      expect(
        find.textContaining('Ngày công bố/hiệu lực: 15/07/2026'),
        findsOneWidget,
      );
      expect(
        find.textContaining('DCM_Thong-cao-NDT-06.2026.pdf'),
        findsOneWidget,
      );
      expect(find.textContaining('Biểu diễn: HTML'), findsNWidgets(4));
      expect(find.textContaining('Biểu diễn: PDF'), findsNWidgets(2));
    },
  );

  testWidgets(
    'historical price offers only an evidence-bound current contact action',
    (tester) async {
      final actions = <BusinessActionMetadata>[];
      await pumpFixture(
        tester,
        PvcfcComponentKind.citedPublicEvidence,
        onAction: actions.add,
      );

      final actionFinder = find.byKey(
        const ValueKey('pvcfc-action-open-current-price-contact'),
      );
      await tester.ensureVisible(actionFinder);
      await tester.tap(actionFinder);
      await tester.pump();

      expect(actions, hasLength(1));
      expect(actions.single.actionId, 'open-current-price-contact');
      expect(actions.single.semantics, BusinessActionSemantics.openPublicUrl);
      expect(actions.single.publicUrl, 'https://www.pvcfc.com.vn/lien-he');
      expect(actions.single.evidenceRef, 'pvcfc-public-contact-2026-07-21');
      expect(actions.single.confirmationReference, isNull);
      expect(
        actions.single.packPayload,
        isA<PvcfcOfficialContactActionBinding>(),
      );
      final binding =
          actions.single.packPayload! as PvcfcOfficialContactActionBinding;
      expect(binding.navigation.role, BusinessNavigationRole.contact);
      expect(binding.navigation.packId, 'pvcfc-customer-service');
      expect(
        binding.navigation.evidenceRef?.evidenceId,
        'pvcfc-public-contact-2026-07-21',
      );
      expect(
        PvcfcPresentationPrototypePack.descriptor.navigationCitationUrlPolicy
            .allows(
              binding.navigation,
              knownEvidenceRefs: {binding.navigation.evidenceRef!},
            ),
        isTrue,
      );
      expect(
        PvcfcPresentationPrototypePack.isValidOfficialContactAction(
          actions.single,
        ),
        isTrue,
      );
      expect(
        PvcfcPresentationPrototypePack.isValidOfficialContactAction(
          const BusinessActionMetadata(
            actionId: 'open-current-price-contact',
            label: 'Mở kênh hỏi giá hiện tại',
            intent: BusinessPresentationActionIntent.recovery,
            semantics: BusinessActionSemantics.openPublicUrl,
            publicUrl: 'https://www.pvcfc.com.vn/lien-he',
            evidenceRef: 'pvcfc-public-contact-2026-07-21',
          ),
        ),
        isFalse,
      );
      const contactNavigation = BusinessNavigationReference(
        packId: 'pvcfc-customer-service',
        url: 'https://www.pvcfc.com.vn/lien-he',
        role: BusinessNavigationRole.contact,
        evidenceRef: BusinessEvidenceReference(
          packId: 'pvcfc-customer-service',
          evidenceId: 'pvcfc-public-contact-2026-07-21',
        ),
      );
      expect(
        PvcfcPresentationPrototypePack.isValidOfficialContactAction(
          const BusinessActionMetadata(
            actionId: 'semantic-mismatch',
            label: 'Sai kiểu',
            intent: BusinessPresentationActionIntent.recovery,
            semantics: BusinessActionSemantics.copy,
            publicUrl: 'https://www.pvcfc.com.vn/lien-he',
            evidenceRef: 'pvcfc-public-contact-2026-07-21',
            packPayload: PvcfcOfficialContactActionBinding(
              navigation: contactNavigation,
            ),
          ),
        ),
        isFalse,
      );
      expect(
        PvcfcPresentationPrototypePack.isValidOfficialContactAction(
          const BusinessActionMetadata(
            actionId: 'unknown-evidence',
            label: 'Nguồn lạ',
            intent: BusinessPresentationActionIntent.recovery,
            semantics: BusinessActionSemantics.openPublicUrl,
            publicUrl: 'https://www.pvcfc.com.vn/lien-he',
            evidenceRef: 'unknown-contact-evidence',
            packPayload: PvcfcOfficialContactActionBinding(
              navigation: BusinessNavigationReference(
                packId: 'pvcfc-customer-service',
                url: 'https://www.pvcfc.com.vn/lien-he',
                role: BusinessNavigationRole.contact,
                evidenceRef: BusinessEvidenceReference(
                  packId: 'pvcfc-customer-service',
                  evidenceId: 'unknown-contact-evidence',
                ),
              ),
            ),
          ),
        ),
        isFalse,
      );
      expect(
        find.textContaining('không gửi yêu cầu thay khách hàng'),
        findsOneWidget,
      );
    },
  );

  testWidgets('public contact emits only open and copy action metadata', (
    tester,
  ) async {
    final actions = <BusinessActionMetadata>[];
    await pumpFixture(
      tester,
      PvcfcComponentKind.officialPublicContactHandoff,
      onAction: actions.add,
    );

    expect(
      find.textContaining('Trợ lý chưa gửi hoặc nộp thông tin'),
      findsOneWidget,
    );
    expect(find.textContaining('Họ và tên'), findsOneWidget);
    expect(find.textContaining('Tên công ty'), findsOneWidget);
    expect(find.textContaining('Số điện thoại'), findsOneWidget);
    expect(find.textContaining('Email'), findsOneWidget);
    expect(find.textContaining('Lời nhắn của bạn'), findsOneWidget);
    expect(find.textContaining('CAPTCHA: Có'), findsOneWidget);
    expect(
      find.textContaining('Nhãn nút quan sát được: Gửi — chỉ mô tả, không bấm'),
      findsOneWidget,
    );
    expect(find.textContaining('Mục đích:'), findsOneWidget);
    expect(find.textContaining('Nguồn / bằng chứng:'), findsOneWidget);
    expect(
      find.textContaining('pvcfc-crawl/raw/agent-contact.json'),
      findsOneWidget,
    );
    expect(
      find.textContaining('Nhãn trường giữ nguyên từ bản chụp'),
      findsOneWidget,
    );

    await tester.tap(
      find.byKey(const ValueKey('pvcfc-action-open-official-url')),
    );
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey('pvcfc-action-copy-customer-reviewed-summary')),
    );
    await tester.pump();

    expect(actions, hasLength(2));
    expect(actions.map((action) => action.semantics), [
      BusinessActionSemantics.openPublicUrl,
      BusinessActionSemantics.copy,
    ]);
    expect(actions.map((action) => action.actionId), [
      'open-official-url',
      'copy-customer-reviewed-summary',
    ]);
    expect(
      actions.every((action) => action.confirmationReference == null),
      isTrue,
    );
    expect(
      actions.every(
        PvcfcPresentationPrototypePack.isValidOfficialContactAction,
      ),
      isTrue,
    );
    expect(
      actions.every(
        (action) => action.packPayload is PvcfcOfficialContactActionBinding,
      ),
      isTrue,
    );
    expect(
      PvcfcPresentationPrototypePack.isValidOfficialContactAction(
        const BusinessActionMetadata(
          actionId: 'off-host',
          label: 'Sai máy chủ',
          intent: BusinessPresentationActionIntent.primary,
          semantics: BusinessActionSemantics.openPublicUrl,
          publicUrl: 'https://evil.example/lien-he',
          evidenceRef: 'pvcfc-public-contact-2026-07-21',
          packPayload: PvcfcOfficialContactActionBinding(
            navigation: BusinessNavigationReference(
              packId: 'pvcfc-customer-service',
              url: 'https://evil.example/lien-he',
              role: BusinessNavigationRole.contact,
              evidenceRef:
                  PvcfcPresentationPrototypePack.officialContactEvidence,
            ),
          ),
        ),
      ),
      isFalse,
    );
    expect(
      PvcfcPresentationPrototypePack.isValidOfficialContactAction(
        const BusinessActionMetadata(
          actionId: 'wrong-role',
          label: 'Sai vai trò',
          intent: BusinessPresentationActionIntent.primary,
          semantics: BusinessActionSemantics.openPublicUrl,
          publicUrl: 'https://www.pvcfc.com.vn/lien-he',
          evidenceRef: 'pvcfc-public-contact-2026-07-21',
          packPayload: PvcfcOfficialContactActionBinding(
            navigation: BusinessNavigationReference(
              packId: 'pvcfc-customer-service',
              url: 'https://www.pvcfc.com.vn/lien-he',
              role: BusinessNavigationRole.citation,
              evidenceRef:
                  PvcfcPresentationPrototypePack.officialContactEvidence,
            ),
          ),
        ),
      ),
      isFalse,
    );
    expect(
      PvcfcPresentationPrototypePack.isValidOfficialContactAction(
        const BusinessActionMetadata(
          actionId: 'blank-copy',
          label: 'Sao chép trống',
          intent: BusinessPresentationActionIntent.secondary,
          semantics: BusinessActionSemantics.copy,
          copyText: '   ',
          evidenceRef: 'pvcfc-public-contact-2026-07-21',
          packPayload: PvcfcOfficialContactActionBinding(
            navigation:
                PvcfcPresentationPrototypePack.officialContactNavigation,
          ),
        ),
      ),
      isFalse,
    );
    expect(
      PvcfcPresentationPrototypePack.isValidOfficialContactAction(
        const BusinessActionMetadata(
          actionId: 'url-mismatch',
          label: 'URL không khớp',
          intent: BusinessPresentationActionIntent.primary,
          semantics: BusinessActionSemantics.openPublicUrl,
          publicUrl: 'https://www.pvcfc.com.vn/quan-he-dau-tu',
          evidenceRef: 'pvcfc-public-contact-2026-07-21',
          packPayload: PvcfcOfficialContactActionBinding(
            navigation:
                PvcfcPresentationPrototypePack.officialContactNavigation,
          ),
        ),
      ),
      isFalse,
    );
    final actionText = actions
        .expand(
          (action) => [
            action.actionId,
            action.label,
            action.displayValue ?? '',
          ],
        )
        .join(' ')
        .toLowerCase();
    expect(actionText, isNot(contains('submit')));
    expect(actionText, isNot(contains('case-created')));
    expect(actionText, isNot(contains('guaranteed-response')));
  });

  test('agronomy fixture matches resolved agronomy asset metadata', () {
    final sourceFile = File(
      '../../docs/wayfinder/pvcfc-multibusiness-chatbot/assets/'
      'pvcfc-crawl/raw/agronomy.json',
    );
    expect(sourceFile.existsSync(), isTrue);
    final source =
        jsonDecode(sourceFile.readAsStringSync()) as Map<String, dynamic>;
    final results = source['results']! as List<dynamic>;
    final captured = results.cast<Map<String, dynamic>>().singleWhere(
      (result) =>
          result['url'] == 'https://www.pvcfc.com.vn/ky-thuat-va-hieu-qua',
    );
    final fixture = PvcfcPresentationPrototypePack
        .citedPublicEvidenceFixture
        .items
        .singleWhere(
          (item) => item.category == PvcfcEvidenceCategory.agronomyCaution,
        );

    expect(fixture.canonicalUrl, captured['final_url']);
    expect(fixture.sourceTitle, captured['title']);
    expect(fixture.sourceLanguage, captured['language']);
    expect(captured['published_date'], isNull);
    expect(fixture.publicationOrEffectiveDate, 'Không nêu trên trang đã chụp');
    expect(fixture.capturedAt, '21/07/2026');
    expect(fixture.evidenceId, 'pvcfc-agronomy-context-2026-07-21');
    expect(
      fixture.authority,
      'Trang tư vấn kỹ thuật công khai chính thức của PVCFC',
    );
  });

  test('contact fixture matches agent-contact asset and suppresses submit', () {
    final sourceFile = File(
      '../../docs/wayfinder/pvcfc-multibusiness-chatbot/assets/'
      'pvcfc-crawl/raw/agent-contact.json',
    );
    expect(sourceFile.existsSync(), isTrue);
    final source =
        jsonDecode(sourceFile.readAsStringSync()) as Map<String, dynamic>;
    final result = source['result']! as Map<String, dynamic>;
    final forms = result['forms']! as List<dynamic>;
    final form = forms.single as Map<String, dynamic>;
    final fields = form['fields']! as List<dynamic>;
    final capturedLabels = fields
        .cast<Map<String, dynamic>>()
        .map((field) => field['label']! as String)
        .toList(growable: false);
    final fixture = PvcfcPresentationPrototypePack.officialPublicContactFixture;

    expect(fixture.expectedFields, capturedLabels);
    expect(fixture.captchaObserved, form['captcha']);
    expect(fixture.observedSubmitLabel, form['submit_label']);
    expect(
      fixture.sourceAssetPath,
      endsWith('pvcfc-crawl/raw/agent-contact.json'),
    );
    expect(fixture.actions.map((action) => action.actionId), [
      'open-official-url',
      'copy-customer-reviewed-summary',
    ]);
    expect(
      fixture.actions.every(
        (action) =>
            action.label != fixture.observedSubmitLabel &&
            action.semantics != BusinessActionSemantics.dispatch,
      ),
      isTrue,
    );
  });

  testWidgets(
    'synthetic workflow keeps shell and component disclosure with status evidence',
    (tester) async {
      final actions = <BusinessActionMetadata>[];
      await pumpFixture(
        tester,
        PvcfcComponentKind.syntheticWorkflowStatus,
        onAction: actions.add,
      );

      const disclosure =
          'Đây là dữ liệu và quy trình mô phỏng để minh họa trợ lý; '
          'không phải hồ sơ hay giao dịch thật của PVCFC.';
      expect(find.text(disclosure), findsNWidgets(2));
      expect(
        find.textContaining('Kịch bản: pvcfc-sales-inquiry-demo-01'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Bản sửa đổi: fixture-r3 / trạng thái-r7'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Trạng thái: Đã ghi nhận yêu cầu mô phỏng'),
        findsOneWidget,
      );
      expect(find.textContaining('requested → committed'), findsOneWidget);
      expect(find.textContaining('Xác nhận chính xác:'), findsOneWidget);
      expect(find.textContaining('Khôi phục:'), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('pvcfc-action-review-exact-confirmation')),
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const ValueKey('pvcfc-action-reconcile-synthetic-status')),
      );
      await tester.pump();

      expect(actions, hasLength(2));
      expect(actions.first.semantics, BusinessActionSemantics.displayOnly);
      expect(actions.last.semantics, BusinessActionSemantics.displayOnly);
    },
  );

  testWidgets(
    'synthetic typed states keep exact content and actions distinct',
    (tester) async {
      const expectations = {
        PvcfcSyntheticWorkflowState.requested: (
          label: 'Đã yêu cầu, chưa cam kết',
          canonical: 'chưa được xác nhận hoặc cam kết',
          revision: 'fixture-r3 / trạng thái-r4',
          history: 'draft → requested',
          evidence: 'sales-request-SYN-014 / requested-r4',
          confirmation: 'Chưa có xác nhận thực hiện',
          recovery: 'Có thể sửa hoặc rút yêu cầu trước khi xác nhận',
          actionIds: [
            'review-request-before-confirmation',
            'discard-uncommitted-request',
          ],
          actionLabels: [
            'Xem yêu cầu trước khi xác nhận',
            'Xem cách rút yêu cầu chưa cam kết',
          ],
          actionDisplays: [
            'Yêu cầu chưa được xác nhận',
            'Chỉ rút bản nháp/yêu cầu chưa cam kết',
          ],
        ),
        PvcfcSyntheticWorkflowState.committed: (
          label: 'Đã cam kết trong mô phỏng',
          canonical: 'đã được cam kết trong kịch bản mô phỏng',
          revision: 'fixture-r3 / trạng thái-r7',
          history: 'requested → committed',
          evidence: 'sales-inquiry-SYN-014 / committed-r7',
          confirmation: 'đã xác nhận đúng sản phẩm quan tâm',
          recovery: 'chỉ đối soát theo mã kịch bản',
          actionIds: [
            'review-exact-confirmation',
            'reconcile-synthetic-status',
          ],
          actionLabels: [
            'Xem nội dung xác nhận',
            'Xem hướng dẫn đối soát mô phỏng',
          ],
          actionDisplays: [
            'Xác nhận gắn với fixture-r3 / trạng thái-r7',
            'Đối soát, không tự động gửi lại',
          ],
        ),
        PvcfcSyntheticWorkflowState.uncertain: (
          label: 'Chưa xác định kết quả, cần đối soát',
          canonical: 'chưa xác định đã cam kết hay chưa',
          revision: 'fixture-r3 / trạng thái-r8',
          history: 'requested → commit attempted → uncertain',
          evidence: 'sales-inquiry-SYN-014 / uncertain-r8',
          confirmation: 'Không có bằng chứng xác nhận kết quả cuối cùng',
          recovery: 'Không tự động gửi lại',
          actionIds: [
            'review-uncertain-evidence',
            'reconcile-uncertain-outcome',
          ],
          actionLabels: [
            'Xem bằng chứng chưa xác định',
            'Xem cách đối soát kết quả',
          ],
          actionDisplays: [
            'Không có bằng chứng kết quả cuối cùng',
            'Đối soát trước khi thử lại',
          ],
        ),
        PvcfcSyntheticWorkflowState.cancellationRequested: (
          label: 'Đã yêu cầu hủy, chưa xác nhận đã hủy',
          canonical: 'mới là yêu cầu hủy; chưa xác nhận đã hủy',
          revision: 'fixture-r3 / trạng thái-r9',
          history: 'committed → cancellation requested',
          evidence: 'cancellation-SYN-014 / requested-r9',
          confirmation: 'xác nhận gửi yêu cầu hủy',
          recovery: 'đối soát yêu cầu hủy hiện có',
          actionIds: [
            'review-cancellation-request',
            'reconcile-cancellation-request',
          ],
          actionLabels: [
            'Xem xác nhận yêu cầu hủy',
            'Xem cách đối soát yêu cầu hủy',
          ],
          actionDisplays: [
            'Yêu cầu hủy chưa phải kết quả đã hủy',
            'Đối soát yêu cầu hủy hiện có',
          ],
        ),
      };

      for (final entry in expectations.entries) {
        final actions = <BusinessActionMetadata>[];
        await tester.pumpWidget(
          TestApp(
            child: SingleChildScrollView(
              child: BusinessPresentationShell(
                descriptor: PvcfcPresentationPrototypePack.syntheticDescriptor,
                envelope:
                    PvcfcPresentationPrototypePack.syntheticFixtureEnvelope(
                      entry.key,
                    ),
                onAction: actions.add,
              ),
            ),
          ),
        );

        expect(
          find.textContaining('Trạng thái bằng chứng: ${entry.value.label}'),
          findsOneWidget,
        );
        expect(find.textContaining(entry.value.canonical), findsOneWidget);
        expect(find.textContaining(entry.value.revision), findsOneWidget);
        expect(find.textContaining(entry.value.history), findsOneWidget);
        expect(find.textContaining(entry.value.evidence), findsOneWidget);
        expect(find.textContaining(entry.value.confirmation), findsOneWidget);
        expect(find.textContaining(entry.value.recovery), findsOneWidget);
        expect(find.textContaining('Bằng chứng trạng thái:'), findsOneWidget);

        for (final actionId in entry.value.actionIds) {
          final actionFinder = find.byKey(ValueKey('pvcfc-action-$actionId'));
          await tester.ensureVisible(actionFinder);
          await tester.tap(actionFinder);
          await tester.pump();
        }
        expect(actions.map((action) => action.actionId), entry.value.actionIds);
        expect(actions.map((action) => action.label), entry.value.actionLabels);
        expect(
          actions.map((action) => action.displayValue),
          entry.value.actionDisplays,
        );
        expect(actions.map((action) => action.intent), [
          BusinessPresentationActionIntent.secondary,
          BusinessPresentationActionIntent.recovery,
        ]);
        expect(
          actions.every(
            (action) => action.semantics == BusinessActionSemantics.displayOnly,
          ),
          isTrue,
        );
      }
    },
  );

  test('PVCFC and KFC authority policies reject cross-Pack references', () {
    const pvcfcEvidence = BusinessEvidenceReference(
      packId: 'pvcfc-customer-service',
      evidenceId: 'pvcfc-public-contact-2026-07-21',
    );
    const kfcEvidence = BusinessEvidenceReference(
      packId: 'kfc-vietnam',
      evidenceId: 'kfc-menu-evidence',
    );
    const pvcfcNavigation = BusinessNavigationReference(
      packId: 'pvcfc-customer-service',
      url: 'https://www.pvcfc.com.vn/lien-he',
      role: BusinessNavigationRole.contact,
      evidenceRef: pvcfcEvidence,
    );
    const kfcNavigation = BusinessNavigationReference(
      packId: 'kfc-vietnam',
      url: 'https://www.kfcvietnam.com.vn/',
      role: BusinessNavigationRole.navigation,
      evidenceRef: kfcEvidence,
    );
    const pvcfcMedia = BusinessMediaReference(
      packId: 'pvcfc-customer-service',
      mediaKey: 'pvcfc-public:report-2025',
      url: 'https://www.pvcfc.com.vn/Data/report.pdf',
      altText: 'Báo cáo PVCFC',
      evidenceRef: pvcfcEvidence,
    );
    const kfcMedia = BusinessMediaReference(
      packId: 'kfc-vietnam',
      mediaKey: 'kfcvn:item-1',
      url: 'https://static.kfcvietnam.com.vn/item.png',
      altText: 'KFC',
      evidenceRef: kfcEvidence,
    );

    expect(
      PvcfcPresentationPrototypePack.descriptor.navigationCitationUrlPolicy
          .allows(pvcfcNavigation, knownEvidenceRefs: {pvcfcEvidence}),
      isTrue,
    );
    expect(
      PvcfcPresentationPrototypePack.descriptor.navigationCitationUrlPolicy
          .allows(kfcNavigation, knownEvidenceRefs: {kfcEvidence}),
      isFalse,
    );
    expect(
      KfcPresentationPrototypePack.descriptor.navigationCitationUrlPolicy
          .allows(pvcfcNavigation, knownEvidenceRefs: {pvcfcEvidence}),
      isFalse,
    );
    expect(
      PvcfcPresentationPrototypePack.descriptor.mediaPolicy.allows(
        pvcfcMedia,
        knownEvidenceRefs: {pvcfcEvidence},
      ),
      isTrue,
    );
    expect(
      PvcfcPresentationPrototypePack.descriptor.mediaPolicy.allows(
        kfcMedia,
        knownEvidenceRefs: {kfcEvidence},
      ),
      isFalse,
    );
    expect(
      KfcPresentationPrototypePack.descriptor.mediaPolicy.allows(
        pvcfcMedia,
        knownEvidenceRefs: {pvcfcEvidence},
      ),
      isFalse,
    );
  });

  test(
    'PVCFC fixture vocabulary and action IDs exclude KFC commerce semantics',
    () {
      final searchable = PvcfcPresentationPrototypePack.fixtureVocabulary
          .join(' ')
          .toLowerCase();

      for (final forbidden in [
        'kfc',
        'cart',
        'checkout',
        'payment',
        'delivery',
        'menu',
        'voucher',
        'combo',
        'confirm_order',
        'add_item',
      ]) {
        expect(searchable, isNot(contains(forbidden)), reason: forbidden);
      }
    },
  );

  testWidgets('wrong payload, kind, schema, component, and Pack fail closed', (
    tester,
  ) async {
    final validEnvelope = PvcfcPresentationPrototypePack.fixtureEnvelope(
      PvcfcComponentKind.citedPublicEvidence,
    );
    final validComponent = validEnvelope.component!;
    final rejectedComponents = [
      BusinessComponentEnvelope(
        componentId: validComponent.componentId,
        identity: validComponent.identity,
        payload: const _WrongPayload(),
      ),
      BusinessComponentEnvelope(
        componentId: 'wrong-component-id',
        identity: validComponent.identity,
        payload: validComponent.payload,
      ),
      BusinessComponentEnvelope(
        componentId: validComponent.componentId,
        identity: PvcfcPresentationPrototypePack.componentIdentityFor(
          PvcfcComponentKind.officialPublicContactHandoff,
        ),
        payload: validComponent.payload,
      ),
      BusinessComponentEnvelope(
        componentId: validComponent.componentId,
        identity: const BusinessComponentIdentity(
          packId: 'pvcfc-customer-service',
          componentKind: 'cited-public-evidence',
          schemaVersion: '999',
        ),
        payload: validComponent.payload,
      ),
    ];

    for (final component in rejectedComponents) {
      await tester.pumpWidget(
        TestApp(
          child: BusinessPresentationShell(
            descriptor: PvcfcPresentationPrototypePack.descriptor,
            envelope: BusinessPresentationEnvelope(
              pack: PvcfcPresentationPrototypePack.pack,
              canonicalText: 'Nội dung chuẩn vẫn còn.',
              component: component,
            ),
          ),
        ),
      );

      expect(find.text('Nội dung chuẩn vẫn còn.'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('pvcfc-component-cited-public-evidence')),
        findsNothing,
      );
    }

    await tester.pumpWidget(
      TestApp(
        child: BusinessPresentationShell(
          descriptor: PvcfcPresentationPrototypePack.descriptor,
          envelope: BusinessPresentationEnvelope(
            pack: const BusinessPackReference(
              packId: 'other-pack',
              packVersion: '1.0.0',
              presentationCatalogVersion: 'pvcfc-prototype-v1',
            ),
            canonicalText: 'Không được hiển thị.',
            component: validComponent,
          ),
        ),
      ),
    );

    expect(find.text('Trợ lý thông tin PVCFC'), findsNothing);
    expect(find.text('Không được hiển thị.'), findsNothing);
  });
}

class _WrongPayload {
  const _WrongPayload();
}

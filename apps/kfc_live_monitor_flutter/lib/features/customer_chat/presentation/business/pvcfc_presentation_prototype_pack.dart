import 'package:flutter/widgets.dart';

import 'business_presentation_contract.dart';
import 'pvcfc_presentation_models.dart';
import 'pvcfc_presentation_renderer.dart';

abstract final class PvcfcPresentationPrototypePack {
  static const pack = BusinessPackReference(
    packId: 'pvcfc-customer-service',
    packVersion: '1.0.0',
    presentationCatalogVersion: 'pvcfc-prototype-v1',
  );

  static const syntheticDisclosure =
      'Đây là dữ liệu và quy trình mô phỏng để minh họa trợ lý; '
      'không phải hồ sơ hay giao dịch thật của PVCFC.';

  static final List<BusinessComponentIdentity> componentIdentities =
      List.unmodifiable(PvcfcComponentKind.values.map(componentIdentityFor));

  static const officialContactEvidence = BusinessEvidenceReference(
    packId: 'pvcfc-customer-service',
    evidenceId: 'pvcfc-public-contact-2026-07-21',
  );

  static const officialContactNavigation = BusinessNavigationReference(
    packId: 'pvcfc-customer-service',
    url: 'https://www.pvcfc.com.vn/lien-he',
    role: BusinessNavigationRole.contact,
    evidenceRef: officialContactEvidence,
  );

  static final Set<BusinessEvidenceReference> knownOfficialContactEvidenceRefs =
      Set.unmodifiable({officialContactEvidence});

  static final NavigationCitationUrlPolicy navigationCitationUrlPolicy =
      NavigationCitationUrlPolicy(
        packId: 'pvcfc-customer-service',
        allowedSchemes: {'https'},
        allowedHosts: {
          'www.pvcfc.com.vn',
          'bikipvang.pvcfc.com.vn',
          'shop.pvcfc.com.vn',
          'thamquannhamay.pvcfc.com.vn',
        },
        allowedRoles: {
          BusinessNavigationRole.navigation,
          BusinessNavigationRole.citation,
          BusinessNavigationRole.form,
          BusinessNavigationRole.contact,
          BusinessNavigationRole.document,
        },
      );

  static final BusinessPresentationDescriptor descriptor = _descriptor(
    persistentBadges: const [],
  );

  static final BusinessPresentationDescriptor syntheticDescriptor = _descriptor(
    persistentBadges: const [
      BusinessPresentationBadge(
        id: 'pvcfc-synthetic-demo',
        label: syntheticDisclosure,
        persistent: true,
      ),
    ],
  );

  // Fixture facts and URLs below are resolved only from:
  // docs/wayfinder/pvcfc-multibusiness-chatbot/assets/pvcfc-crawl/raw/
  // english.json, contact-pricing-distribution.json, agent-contact.json,
  // agent-investor.json, agent-sustainability-reports.json, and agronomy.json.
  static const citedPublicEvidenceFixture = PvcfcCitedPublicEvidenceData(
    componentId: 'pvcfc-public-evidence-fixture',
    title: 'Bằng chứng công khai có dẫn nguồn',
    items: [
      PvcfcEvidenceItem(
        category: PvcfcEvidenceCategory.productSpecification,
        heading: 'Sản phẩm / quy cách',
        summary:
            'Danh mục tiếng Anh đã xác minh có trang sản phẩm Phân bón Cà Mau; '
            'quy cách chi tiết phải được kiểm tra trên đúng hồ sơ sản phẩm.',
        sourceTitle: "Camau Fertilizer's product",
        canonicalUrl:
            'https://www.pvcfc.com.vn/en-US/camau-fertilizers-product',
        sourceLanguage: 'en',
        sourceVerification: PvcfcSourceVerificationState.verifiedEnglish,
        outputLanguageTreatment:
            PvcfcOutputLanguageTreatment.translatedFromEnglish,
        hasVerifiedEnglishCounterpart: true,
        representationLabel: 'HTML',
        publicationOrEffectiveDate: 'Không nêu trên trang đã chụp',
        capturedAt: '21/07/2026',
        freshnessState: PvcfcFreshnessState.current,
        freshnessLabel: 'Bản chụp hiện hành của bộ dữ liệu 21/07/2026',
        evidenceId: 'pvcfc-en-products-2026-07-21',
        authority: 'Trang sản phẩm công khai chính thức của PVCFC',
        limitation:
            'Trang danh mục không thay thế hồ sơ quy cách của từng sản phẩm.',
      ),
      PvcfcEvidenceItem(
        category: PvcfcEvidenceCategory.agronomyCaution,
        heading: 'Khuyến cáo nông học',
        summary:
            'Hướng dẫn phải giữ nguyên bối cảnh cây trồng, giai đoạn, đất, '
            'công thức và đơn vị; không suy rộng thành khuyến nghị cá nhân.',
        sourceTitle: 'Kỹ thuật & hiệu quả sử dụng bộ sản phẩm PBCM',
        canonicalUrl: 'https://www.pvcfc.com.vn/ky-thuat-va-hieu-qua',
        sourceLanguage: 'vi',
        sourceVerification: PvcfcSourceVerificationState.verifiedVietnamese,
        outputLanguageTreatment: PvcfcOutputLanguageTreatment.nativeVietnamese,
        hasVerifiedEnglishCounterpart: false,
        representationLabel: 'HTML',
        publicationOrEffectiveDate: 'Không nêu trên trang đã chụp',
        capturedAt: '21/07/2026',
        freshnessState: PvcfcFreshnessState.current,
        freshnessLabel: 'Cần đối chiếu nhãn sản phẩm và điều kiện thực địa',
        evidenceId: 'pvcfc-agronomy-context-2026-07-21',
        authority: 'Trang tư vấn kỹ thuật công khai chính thức của PVCFC',
        limitation:
            'Không bảo đảm năng suất hoặc an toàn cho điều kiện chưa được mô tả.',
      ),
      PvcfcEvidenceItem(
        category: PvcfcEvidenceCategory.datedPrice,
        heading: 'Giá tham khảo theo thời điểm',
        summary:
            'Mức giá trong bài chỉ là tham khảo và có thể thay đổi theo vùng, '
            'đại lý, số lượng và thời điểm.',
        sourceTitle: 'Cập nhật bảng giá phân bón mới nhất',
        canonicalUrl: 'https://www.pvcfc.com.vn/gia-phan-bon',
        sourceLanguage: 'vi',
        sourceVerification: PvcfcSourceVerificationState.verifiedVietnamese,
        outputLanguageTreatment: PvcfcOutputLanguageTreatment.nativeVietnamese,
        hasVerifiedEnglishCounterpart: false,
        representationLabel: 'HTML',
        publicationOrEffectiveDate: '24/12/2025',
        capturedAt: '21/07/2026',
        freshnessState: PvcfcFreshnessState.historical,
        freshnessLabel: 'Lịch sử / có thể đã cũ — liên hệ để hỏi giá hiện tại',
        evidenceId: 'pvcfc-price-article-2025-12-24',
        authority: 'Bài viết công khai chính thức của PVCFC',
        limitation:
            'Không phải báo giá trực tiếp, cam kết bán hoặc xác nhận tồn.',
        actionDisclosure:
            'Hành động chỉ mở trang liên hệ chính thức; trợ lý không gửi yêu '
            'cầu thay khách hàng.',
        actions: [
          BusinessActionMetadata(
            actionId: 'open-current-price-contact',
            label: 'Mở kênh hỏi giá hiện tại',
            intent: BusinessPresentationActionIntent.recovery,
            semantics: BusinessActionSemantics.openPublicUrl,
            publicUrl: 'https://www.pvcfc.com.vn/lien-he',
            displayValue: 'www.pvcfc.com.vn/lien-he',
            evidenceRef: 'pvcfc-public-contact-2026-07-21',
            packPayload: PvcfcOfficialContactActionBinding(
              navigation: officialContactNavigation,
            ),
          ),
        ],
      ),
      PvcfcEvidenceItem(
        category: PvcfcEvidenceCategory.investorSustainabilityDocument,
        heading: 'Tài liệu phát triển bền vững',
        summary:
            'Báo cáo năm 2025 có bản trực tuyến và PDF là hai biểu diễn của '
            'cùng một kỳ báo cáo; nội dung chi tiết cần dựa trên tài liệu.',
        sourceTitle: 'Báo cáo Phát triển bền vững năm 2025 Online',
        canonicalUrl:
            'https://www.pvcfc.com.vn/Data/Sites/1/media/BCPTBV/vn/'
            'Phat-Trien-Ben-Vung-2025/index.html',
        sourceLanguage: 'vi',
        sourceVerification: PvcfcSourceVerificationState.verifiedVietnamese,
        outputLanguageTreatment: PvcfcOutputLanguageTreatment.nativeVietnamese,
        hasVerifiedEnglishCounterpart: false,
        representationLabel: 'HTML',
        relationshipLabel:
            'Cùng kỳ báo cáo 2025: bản HTML trực tuyến ↔ bản PDF tải xuống',
        publicationOrEffectiveDate: '23/06/2026',
        capturedAt: '21/07/2026',
        freshnessState: PvcfcFreshnessState.current,
        freshnessLabel: 'Tài liệu kỳ 2025, bản trực tuyến công bố 23/06/2026',
        evidenceId: 'pvcfc-sustainability-2025-online',
        authority: 'Danh mục báo cáo công khai chính thức của PVCFC',
        limitation:
            'Metadata danh mục không tự chứng minh số liệu bên trong báo cáo.',
      ),
      PvcfcEvidenceItem(
        category: PvcfcEvidenceCategory.investorSustainabilityDocument,
        heading: 'Tài liệu phát triển bền vững',
        summary:
            'Bản PDF tải xuống thuộc cùng kỳ báo cáo 2025 với bản HTML trực '
            'tuyến; không giả định hai biểu diễn giống nhau từng byte.',
        sourceTitle: 'Báo cáo Phát triển bền vững năm 2025',
        canonicalUrl:
            'https://www.pvcfc.com.vn/Data/Sites/1/media/BCPTBV/vn/'
            'Phat-trien-ben-vung-2025.pdf',
        sourceLanguage: 'vi',
        sourceVerification: PvcfcSourceVerificationState.verifiedVietnamese,
        outputLanguageTreatment: PvcfcOutputLanguageTreatment.nativeVietnamese,
        hasVerifiedEnglishCounterpart: false,
        representationLabel: 'PDF',
        relationshipLabel:
            'Cùng kỳ báo cáo 2025: bản HTML trực tuyến ↔ bản PDF tải xuống',
        publicationOrEffectiveDate: '19/03/2026',
        capturedAt: '21/07/2026',
        freshnessState: PvcfcFreshnessState.current,
        freshnessLabel: 'Tài liệu kỳ 2025, bản PDF công bố 19/03/2026',
        evidenceId: 'pvcfc-sustainability-2025-pdf',
        authority: 'Danh mục báo cáo công khai chính thức của PVCFC',
        limitation:
            'Quan hệ cùng kỳ không chứng minh nội dung hai biểu diễn giống hệt.',
      ),
      PvcfcEvidenceItem(
        category: PvcfcEvidenceCategory.investorSustainabilityDocument,
        heading: 'Tài liệu quan hệ nhà đầu tư',
        summary:
            'Thông cáo nhà đầu tư tháng 06/2026 là tài liệu PDF được danh mục '
            'quan hệ nhà đầu tư công bố ngày 15/07/2026.',
        sourceTitle: 'DCM - Thông cáo nhà đầu tư tháng 06/2026',
        canonicalUrl:
            'https://www.pvcfc.com.vn/Data/Sites/1/media/quan-he-nha-dau-tu/'
            'cong-bo-khac/2026/DCM_Thong-cao-NDT-06.2026.pdf',
        sourceLanguage: 'vi',
        sourceVerification: PvcfcSourceVerificationState.verifiedVietnamese,
        outputLanguageTreatment: PvcfcOutputLanguageTreatment.nativeVietnamese,
        hasVerifiedEnglishCounterpart: false,
        representationLabel: 'PDF',
        publicationOrEffectiveDate: '15/07/2026',
        capturedAt: '21/07/2026',
        freshnessState: PvcfcFreshnessState.current,
        freshnessLabel: 'Danh mục nhà đầu tư được chụp ngày 21/07/2026',
        evidenceId: 'pvcfc-investor-brief-2026-06',
        authority: 'Danh mục quan hệ nhà đầu tư công khai chính thức của PVCFC',
        limitation:
            'Metadata danh mục không thay thế việc đọc tài liệu khi nêu số liệu.',
      ),
    ],
  );

  static const officialPublicContactFixture = PvcfcOfficialPublicContactData(
    componentId: 'pvcfc-public-contact-fixture',
    title: 'Chuyển tiếp qua kênh chính thức',
    channelLabel: 'Biểu mẫu Liên hệ PVCFC',
    officialUrl: 'https://www.pvcfc.com.vn/lien-he',
    purpose: 'Chuẩn bị yêu cầu tư vấn sản phẩm để khách hàng tự xem và gửi',
    expectedFields: [
      'Họ và tên',
      'Tên công ty',
      'Số điện thoại',
      'Email',
      'Lời nhắn của bạn',
    ],
    captchaObserved: true,
    observedSubmitLabel: 'Gửi',
    fieldLabelDisclosure: 'Nhãn trường giữ nguyên từ bản chụp tiếng Việt.',
    sourceTitle: 'Liên hệ',
    sourceAssetPath:
        'docs/wayfinder/pvcfc-multibusiness-chatbot/assets/'
        'pvcfc-crawl/raw/agent-contact.json',
    evidenceId: 'pvcfc-public-contact-2026-07-21',
    customerReviewedSummary:
        'Tôi cần tư vấn sản phẩm phù hợp với nhu cầu canh tác đã mô tả.',
    notSubmittedDisclosure:
        'Trợ lý chưa gửi hoặc nộp thông tin; khách hàng tự xem lại và thao tác '
        'trên kênh chính thức.',
    actions: [
      BusinessActionMetadata(
        actionId: 'open-official-url',
        label: 'Mở trang liên hệ chính thức',
        intent: BusinessPresentationActionIntent.primary,
        semantics: BusinessActionSemantics.openPublicUrl,
        publicUrl: 'https://www.pvcfc.com.vn/lien-he',
        displayValue: 'www.pvcfc.com.vn/lien-he',
        evidenceRef: 'pvcfc-public-contact-2026-07-21',
        packPayload: PvcfcOfficialContactActionBinding(
          navigation: officialContactNavigation,
        ),
      ),
      BusinessActionMetadata(
        actionId: 'copy-customer-reviewed-summary',
        label: 'Sao chép bản tóm tắt đã xem lại',
        intent: BusinessPresentationActionIntent.secondary,
        semantics: BusinessActionSemantics.copy,
        copyText:
            'Tôi cần tư vấn sản phẩm phù hợp với nhu cầu canh tác đã mô tả.',
        displayValue: 'Bản tóm tắt do khách hàng xem lại',
        evidenceRef: 'pvcfc-public-contact-2026-07-21',
        packPayload: PvcfcOfficialContactActionBinding(
          navigation: officialContactNavigation,
        ),
      ),
    ],
  );

  static const syntheticWorkflowFixture = PvcfcSyntheticWorkflowData(
    componentId: 'pvcfc-synthetic-sales-fixture',
    title: 'Trạng thái yêu cầu mô phỏng',
    disclosure: syntheticDisclosure,
    scenarioId: 'pvcfc-sales-inquiry-demo-01',
    fixtureRevision: 'fixture-r3',
    statusRevision: 'trạng thái-r7',
    statusLabel: 'Đã ghi nhận yêu cầu mô phỏng',
    stateHistory: 'requested → committed',
    currentState: PvcfcSyntheticWorkflowState.committed,
    statusEvidence:
        'synthetic-scenario-runtime / sales-inquiry-SYN-014 / revision 7',
    exactConfirmation:
        'Khách hàng đã xác nhận đúng sản phẩm quan tâm, khu vực và kênh liên hệ.',
    recoveryGuidance:
        'Nếu kết quả không chắc chắn, chỉ đối soát theo mã kịch bản; không gửi '
        'lại và không suy đoán đã hoàn tất.',
    actions: [
      BusinessActionMetadata(
        actionId: 'review-exact-confirmation',
        label: 'Xem nội dung xác nhận',
        intent: BusinessPresentationActionIntent.secondary,
        semantics: BusinessActionSemantics.displayOnly,
        displayValue: 'Xác nhận gắn với fixture-r3 / trạng thái-r7',
        confirmationReference: 'pvcfc-synthetic-confirmation-r7',
      ),
      BusinessActionMetadata(
        actionId: 'reconcile-synthetic-status',
        label: 'Xem hướng dẫn đối soát mô phỏng',
        intent: BusinessPresentationActionIntent.recovery,
        semantics: BusinessActionSemantics.displayOnly,
        displayValue: 'Đối soát, không tự động gửi lại',
        evidenceRef: 'pvcfc-synthetic-sales-status-r7',
      ),
    ],
  );

  static final List<String> fixtureVocabulary = List.unmodifiable([
    for (final identity in componentIdentities) identity.componentKind,
    citedPublicEvidenceFixture.title,
    for (final item in citedPublicEvidenceFixture.items) ...[
      item.heading,
      item.summary,
      item.sourceTitle,
      item.limitation,
    ],
    officialPublicContactFixture.title,
    officialPublicContactFixture.purpose,
    officialPublicContactFixture.notSubmittedDisclosure,
    for (final action in officialPublicContactFixture.actions) ...[
      action.actionId,
      action.label,
    ],
    syntheticWorkflowFixture.title,
    syntheticWorkflowFixture.statusLabel,
    syntheticWorkflowFixture.stateHistory,
    for (final action in syntheticWorkflowFixture.actions) ...[
      action.actionId,
      action.label,
    ],
  ]);

  static bool isValidOfficialContactAction(BusinessActionMetadata action) {
    final binding = action.packPayload;
    if (binding is! PvcfcOfficialContactActionBinding ||
        action.confirmationReference != null ||
        (action.semantics != BusinessActionSemantics.openPublicUrl &&
            action.semantics != BusinessActionSemantics.copy)) {
      return false;
    }
    final navigation = binding.navigation;
    final evidence = navigation.evidenceRef;
    if (navigation.packId != pack.packId ||
        navigation.role != BusinessNavigationRole.contact ||
        evidence == null ||
        !knownOfficialContactEvidenceRefs.contains(evidence) ||
        action.evidenceRef != evidence.evidenceId) {
      return false;
    }
    final semanticsMatch = switch (action.semantics) {
      BusinessActionSemantics.openPublicUrl =>
        action.publicUrl == navigation.url && action.copyText == null,
      BusinessActionSemantics.copy =>
        action.publicUrl == null &&
            (action.copyText?.trim().isNotEmpty ?? false),
      _ => false,
    };
    return semanticsMatch &&
        navigationCitationUrlPolicy.allows(
          navigation,
          knownEvidenceRefs: knownOfficialContactEvidenceRefs,
          expectedEvidenceRef: officialContactEvidence,
        );
  }

  static BusinessComponentIdentity componentIdentityFor(
    PvcfcComponentKind kind,
  ) {
    return BusinessComponentIdentity(
      packId: pack.packId,
      componentKind: kind.wireName,
      schemaVersion: '1',
    );
  }

  static BusinessPresentationEnvelope fixtureEnvelope(PvcfcComponentKind kind) {
    final data = switch (kind) {
      PvcfcComponentKind.citedPublicEvidence => citedPublicEvidenceFixture,
      PvcfcComponentKind.officialPublicContactHandoff =>
        officialPublicContactFixture,
      PvcfcComponentKind.syntheticWorkflowStatus => syntheticWorkflowFixture,
    };
    final canonicalText = switch (kind) {
      PvcfcComponentKind.citedPublicEvidence =>
        'Thông tin dưới đây dựa trên nguồn công khai PVCFC, có ngày và giới hạn '
            'để khách hàng tự kiểm tra.',
      PvcfcComponentKind.officialPublicContactHandoff =>
        'Tôi có thể mở kênh chính thức hoặc sao chép bản tóm tắt để bạn tự gửi; '
            'tôi chưa gửi biểu mẫu.',
      PvcfcComponentKind.syntheticWorkflowStatus =>
        '$syntheticDisclosure Yêu cầu tư vấn đang ở trạng thái đã ghi nhận '
            'trong kịch bản mô phỏng.',
    };
    return BusinessPresentationEnvelope(
      pack: pack,
      canonicalText: canonicalText,
      component: BusinessComponentEnvelope(
        componentId: data.componentId,
        identity: componentIdentityFor(kind),
        payload: _PvcfcPresentationPayload(kind: kind, data: data),
      ),
    );
  }

  static BusinessPresentationEnvelope syntheticFixtureEnvelope(
    PvcfcSyntheticWorkflowState state,
  ) {
    final configuration = switch (state) {
      PvcfcSyntheticWorkflowState.requested => (
        canonical:
            'Yêu cầu mô phỏng đã được ghi nhận để khách hàng xem lại; chưa được '
            'xác nhận hoặc cam kết.',
        revision: 'trạng thái-r4',
        statusLabel: 'Yêu cầu mô phỏng đang chờ xác nhận',
        history: 'draft → requested',
        evidence:
            'synthetic-scenario-runtime / sales-request-SYN-014 / requested-r4',
        confirmation:
            'Chưa có xác nhận thực hiện; nội dung vẫn là yêu cầu có thể chỉnh sửa.',
        recovery:
            'Có thể sửa hoặc rút yêu cầu trước khi xác nhận; không có kết quả '
            'bên ngoài nào cần hoàn tác.',
        actions: const [
          BusinessActionMetadata(
            actionId: 'review-request-before-confirmation',
            label: 'Xem yêu cầu trước khi xác nhận',
            intent: BusinessPresentationActionIntent.secondary,
            semantics: BusinessActionSemantics.displayOnly,
            displayValue: 'Yêu cầu chưa được xác nhận',
          ),
          BusinessActionMetadata(
            actionId: 'discard-uncommitted-request',
            label: 'Xem cách rút yêu cầu chưa cam kết',
            intent: BusinessPresentationActionIntent.recovery,
            semantics: BusinessActionSemantics.displayOnly,
            displayValue: 'Chỉ rút bản nháp/yêu cầu chưa cam kết',
          ),
        ],
      ),
      PvcfcSyntheticWorkflowState.committed => (
        canonical:
            'Yêu cầu tư vấn đã được cam kết trong kịch bản mô phỏng; đây không '
            'phải yêu cầu thật gửi tới PVCFC.',
        revision: 'trạng thái-r7',
        statusLabel: 'Đã ghi nhận yêu cầu mô phỏng',
        history: 'requested → committed',
        evidence:
            'synthetic-scenario-runtime / sales-inquiry-SYN-014 / committed-r7',
        confirmation:
            'Khách hàng đã xác nhận đúng sản phẩm quan tâm, khu vực và kênh liên hệ.',
        recovery:
            'Nếu cần kiểm tra lại, chỉ đối soát theo mã kịch bản; không gửi lại '
            'và không suy đoán kết quả bên ngoài.',
        actions: syntheticWorkflowFixture.actions,
      ),
      PvcfcSyntheticWorkflowState.uncertain => (
        canonical:
            'Kết quả mô phỏng chưa xác định đã cam kết hay chưa; cần đối soát '
            'trước mọi bước tiếp theo.',
        revision: 'trạng thái-r8',
        statusLabel: 'Kết quả mô phỏng chưa xác định',
        history: 'requested → commit attempted → uncertain',
        evidence:
            'synthetic-scenario-runtime / sales-inquiry-SYN-014 / uncertain-r8',
        confirmation:
            'Không có bằng chứng xác nhận kết quả cuối cùng của lần thử cam kết.',
        recovery:
            'Không tự động gửi lại; đối soát đúng kịch bản và bản sửa đổi trước '
            'khi quyết định thử lại.',
        actions: const [
          BusinessActionMetadata(
            actionId: 'review-uncertain-evidence',
            label: 'Xem bằng chứng chưa xác định',
            intent: BusinessPresentationActionIntent.secondary,
            semantics: BusinessActionSemantics.displayOnly,
            displayValue: 'Không có bằng chứng kết quả cuối cùng',
          ),
          BusinessActionMetadata(
            actionId: 'reconcile-uncertain-outcome',
            label: 'Xem cách đối soát kết quả',
            intent: BusinessPresentationActionIntent.recovery,
            semantics: BusinessActionSemantics.displayOnly,
            displayValue: 'Đối soát trước khi thử lại',
          ),
        ],
      ),
      PvcfcSyntheticWorkflowState.cancellationRequested => (
        canonical:
            'Trạng thái hiện tại mới là yêu cầu hủy; chưa xác nhận đã hủy yêu '
            'cầu tư vấn mô phỏng.',
        revision: 'trạng thái-r9',
        statusLabel: 'Đã ghi nhận yêu cầu hủy mô phỏng',
        history: 'committed → cancellation requested',
        evidence:
            'synthetic-scenario-runtime / cancellation-SYN-014 / requested-r9',
        confirmation:
            'Khách hàng đã xác nhận gửi yêu cầu hủy đúng bản ghi mô phỏng; đây '
            'không phải xác nhận đã hủy.',
        recovery:
            'Chỉ đối soát yêu cầu hủy hiện có; không tạo yêu cầu hủy mới và '
            'không gọi trạng thái này là đã hủy.',
        actions: const [
          BusinessActionMetadata(
            actionId: 'review-cancellation-request',
            label: 'Xem xác nhận yêu cầu hủy',
            intent: BusinessPresentationActionIntent.secondary,
            semantics: BusinessActionSemantics.displayOnly,
            displayValue: 'Yêu cầu hủy chưa phải kết quả đã hủy',
          ),
          BusinessActionMetadata(
            actionId: 'reconcile-cancellation-request',
            label: 'Xem cách đối soát yêu cầu hủy',
            intent: BusinessPresentationActionIntent.recovery,
            semantics: BusinessActionSemantics.displayOnly,
            displayValue: 'Đối soát yêu cầu hủy hiện có',
          ),
        ],
      ),
    };
    final data = syntheticWorkflowFixture.copyWith(
      currentState: state,
      statusRevision: configuration.revision,
      statusLabel: configuration.statusLabel,
      stateHistory: configuration.history,
      statusEvidence: configuration.evidence,
      exactConfirmation: configuration.confirmation,
      recoveryGuidance: configuration.recovery,
      actions: configuration.actions,
    );
    return BusinessPresentationEnvelope(
      pack: pack,
      canonicalText: '$syntheticDisclosure ${configuration.canonical}',
      component: BusinessComponentEnvelope(
        componentId: data.componentId,
        identity: componentIdentityFor(
          PvcfcComponentKind.syntheticWorkflowStatus,
        ),
        payload: _PvcfcPresentationPayload(
          kind: PvcfcComponentKind.syntheticWorkflowStatus,
          data: data,
        ),
      ),
    );
  }

  static BusinessPresentationDescriptor _descriptor({
    required List<BusinessPresentationBadge> persistentBadges,
  }) {
    return BusinessPresentationDescriptor(
      businessId: 'pvcfc',
      pack: pack,
      title: 'Trợ lý thông tin PVCFC',
      subtitle: 'Nguồn công khai, chuyển tiếp minh bạch',
      monogram: 'PVCFC',
      // Prototype-only tokens; these are not final PVCFC corporate brand standards.
      theme: const BusinessPresentationThemeTokens(
        primary: Color(0xFF145A32),
        onPrimary: Color(0xFFFFFFFF),
        surface: Color(0xFFF7FAF8),
        onSurface: Color(0xFF17251D),
        secondaryText: Color(0xFF53645A),
        outline: Color(0xFFD4DDD7),
      ),
      copy: const BusinessPresentationCopy(
        primaryLocale: 'vi-VN',
        canonicalTextSemanticsLabel: 'Nội dung trả lời của trợ lý PVCFC',
        disclosureSemanticsLabel: 'Thông báo dữ liệu mô phỏng PVCFC',
      ),
      persistentBadges: persistentBadges,
      // Exact first-party authority derived from the local PVCFC crawl fixtures.
      mediaPolicy: const BusinessMediaPolicy(
        packId: 'pvcfc-customer-service',
        allowedHost: 'www.pvcfc.com.vn',
        mediaKeyPrefix: 'pvcfc-public:',
      ),
      navigationCitationUrlPolicy: navigationCitationUrlPolicy,
      rendererRegistrations: PvcfcComponentKind.values
          .map(_registrationFor)
          .toList(growable: false),
    );
  }

  static BusinessRendererRegistration _registrationFor(
    PvcfcComponentKind kind,
  ) {
    final identity = componentIdentityFor(kind);
    return BusinessRendererRegistration(
      identity: identity,
      renderer: (context, component, onAction) {
        final payload = component.payload;
        if (payload is! _PvcfcPresentationPayload ||
            payload.kind != kind ||
            payload.data.componentId != component.componentId ||
            !_dataMatchesKind(kind, payload.data) ||
            !_actionsAreValid(kind, payload.data)) {
          return null;
        }
        return PvcfcPresentationRenderer(
          kind: kind,
          data: payload.data,
          onAction: onAction,
        );
      },
    );
  }

  static bool _actionsAreValid(
    PvcfcComponentKind kind,
    PvcfcPresentationData data,
  ) {
    if (kind == PvcfcComponentKind.citedPublicEvidence &&
        data is PvcfcCitedPublicEvidenceData) {
      return data.items.every(
        (item) => item.actions.every(isValidOfficialContactAction),
      );
    }
    if (kind == PvcfcComponentKind.officialPublicContactHandoff &&
        data is PvcfcOfficialPublicContactData) {
      return data.actions.length == 2 &&
          data.actions.every(isValidOfficialContactAction) &&
          data.actions[0].actionId == 'open-official-url' &&
          data.actions[0].semantics == BusinessActionSemantics.openPublicUrl &&
          data.actions[1].actionId == 'copy-customer-reviewed-summary' &&
          data.actions[1].semantics == BusinessActionSemantics.copy;
    }
    return true;
  }

  static bool _dataMatchesKind(
    PvcfcComponentKind kind,
    PvcfcPresentationData data,
  ) {
    return switch ((kind, data)) {
      (
        PvcfcComponentKind.citedPublicEvidence,
        PvcfcCitedPublicEvidenceData(),
      ) =>
        true,
      (
        PvcfcComponentKind.officialPublicContactHandoff,
        PvcfcOfficialPublicContactData(),
      ) =>
        true,
      (
        PvcfcComponentKind.syntheticWorkflowStatus,
        PvcfcSyntheticWorkflowData(),
      ) =>
        true,
      _ => false,
    };
  }
}

class _PvcfcPresentationPayload {
  const _PvcfcPresentationPayload({required this.kind, required this.data});

  final PvcfcComponentKind kind;
  final PvcfcPresentationData data;
}

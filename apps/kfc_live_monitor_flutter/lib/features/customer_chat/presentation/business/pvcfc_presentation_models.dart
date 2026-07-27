import 'business_presentation_contract.dart';

enum PvcfcComponentKind {
  citedPublicEvidence('cited-public-evidence'),
  officialPublicContactHandoff('official-public-contact-handoff'),
  syntheticWorkflowStatus('synthetic-workflow-status');

  const PvcfcComponentKind(this.wireName);

  final String wireName;
}

enum PvcfcEvidenceCategory {
  productSpecification,
  agronomyCaution,
  datedPrice,
  investorSustainabilityDocument,
}

enum PvcfcSourceVerificationState { verifiedEnglish, verifiedVietnamese }

enum PvcfcOutputLanguageTreatment { nativeVietnamese, translatedFromEnglish }

enum PvcfcFreshnessState { current, historical }

sealed class PvcfcPresentationData {
  const PvcfcPresentationData({required this.componentId, required this.title});

  final String componentId;
  final String title;
}

class PvcfcCitedPublicEvidenceData extends PvcfcPresentationData {
  const PvcfcCitedPublicEvidenceData({
    required super.componentId,
    required super.title,
    required this.items,
  });

  final List<PvcfcEvidenceItem> items;
}

class PvcfcEvidenceItem {
  const PvcfcEvidenceItem({
    required this.category,
    required this.heading,
    required this.summary,
    required this.sourceTitle,
    required this.canonicalUrl,
    required this.sourceLanguage,
    required this.sourceVerification,
    required this.outputLanguageTreatment,
    required this.hasVerifiedEnglishCounterpart,
    required this.representationLabel,
    this.relationshipLabel,
    required this.publicationOrEffectiveDate,
    required this.capturedAt,
    required this.freshnessState,
    required this.freshnessLabel,
    required this.evidenceId,
    required this.authority,
    required this.limitation,
    this.actionDisclosure,
    this.actions = const [],
  });

  final PvcfcEvidenceCategory category;
  final String heading;
  final String summary;
  final String sourceTitle;
  final String canonicalUrl;
  final String sourceLanguage;
  final PvcfcSourceVerificationState sourceVerification;
  final PvcfcOutputLanguageTreatment outputLanguageTreatment;
  final bool hasVerifiedEnglishCounterpart;
  final String representationLabel;
  final String? relationshipLabel;
  final String publicationOrEffectiveDate;
  final String capturedAt;
  final PvcfcFreshnessState freshnessState;
  final String freshnessLabel;
  final String evidenceId;
  final String authority;
  final String limitation;
  final String? actionDisclosure;
  final List<BusinessActionMetadata> actions;
}

class PvcfcOfficialContactActionBinding {
  const PvcfcOfficialContactActionBinding({required this.navigation});

  final BusinessNavigationReference navigation;
}

class PvcfcOfficialPublicContactData extends PvcfcPresentationData {
  const PvcfcOfficialPublicContactData({
    required super.componentId,
    required super.title,
    required this.channelLabel,
    required this.officialUrl,
    required this.purpose,
    required this.expectedFields,
    required this.captchaObserved,
    required this.observedSubmitLabel,
    required this.fieldLabelDisclosure,
    required this.sourceTitle,
    required this.sourceAssetPath,
    required this.evidenceId,
    required this.customerReviewedSummary,
    required this.notSubmittedDisclosure,
    required this.actions,
  });

  final String channelLabel;
  final String officialUrl;
  final String purpose;
  final List<String> expectedFields;
  final bool captchaObserved;
  final String observedSubmitLabel;
  final String fieldLabelDisclosure;
  final String sourceTitle;
  final String sourceAssetPath;
  final String evidenceId;
  final String customerReviewedSummary;
  final String notSubmittedDisclosure;
  final List<BusinessActionMetadata> actions;
}

enum PvcfcSyntheticWorkflowState {
  requested('Đã yêu cầu, chưa cam kết'),
  committed('Đã cam kết trong mô phỏng'),
  uncertain('Chưa xác định kết quả, cần đối soát'),
  cancellationRequested('Đã yêu cầu hủy, chưa xác nhận đã hủy');

  const PvcfcSyntheticWorkflowState(this.customerLabel);

  final String customerLabel;
}

class PvcfcSyntheticWorkflowData extends PvcfcPresentationData {
  const PvcfcSyntheticWorkflowData({
    required super.componentId,
    required super.title,
    required this.disclosure,
    required this.scenarioId,
    required this.fixtureRevision,
    required this.statusRevision,
    required this.statusLabel,
    required this.stateHistory,
    required this.currentState,
    required this.statusEvidence,
    required this.exactConfirmation,
    required this.recoveryGuidance,
    required this.actions,
  });

  final String disclosure;
  final String scenarioId;
  final String fixtureRevision;
  final String statusRevision;
  final String statusLabel;
  final String stateHistory;
  final PvcfcSyntheticWorkflowState currentState;
  final String statusEvidence;
  final String exactConfirmation;
  final String recoveryGuidance;
  final List<BusinessActionMetadata> actions;

  PvcfcSyntheticWorkflowData copyWith({
    PvcfcSyntheticWorkflowState? currentState,
    String? statusRevision,
    String? statusLabel,
    String? stateHistory,
    String? statusEvidence,
    String? exactConfirmation,
    String? recoveryGuidance,
    List<BusinessActionMetadata>? actions,
  }) {
    return PvcfcSyntheticWorkflowData(
      componentId: componentId,
      title: title,
      disclosure: disclosure,
      scenarioId: scenarioId,
      fixtureRevision: fixtureRevision,
      statusRevision: statusRevision ?? this.statusRevision,
      statusLabel: statusLabel ?? this.statusLabel,
      stateHistory: stateHistory ?? this.stateHistory,
      currentState: currentState ?? this.currentState,
      statusEvidence: statusEvidence ?? this.statusEvidence,
      exactConfirmation: exactConfirmation ?? this.exactConfirmation,
      recoveryGuidance: recoveryGuidance ?? this.recoveryGuidance,
      actions: actions ?? this.actions,
    );
  }
}

import 'package:flutter/material.dart';

import 'business_presentation_contract.dart';
import 'pvcfc_presentation_models.dart';

class PvcfcPresentationRenderer extends StatelessWidget {
  const PvcfcPresentationRenderer({
    super.key,
    required this.kind,
    required this.data,
    required this.onAction,
  });

  final PvcfcComponentKind kind;
  final PvcfcPresentationData data;
  final ValueChanged<BusinessActionMetadata> onAction;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: ValueKey('pvcfc-component-${kind.wireName}'),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFFFF),
        border: Border.all(color: const Color(0xFFD4DDD7)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: switch ((kind, data)) {
          (
            PvcfcComponentKind.citedPublicEvidence,
            final PvcfcCitedPublicEvidenceData evidence,
          ) =>
            _CitedPublicEvidence(data: evidence, onAction: onAction),
          (
            PvcfcComponentKind.officialPublicContactHandoff,
            final PvcfcOfficialPublicContactData contact,
          ) =>
            _OfficialPublicContact(data: contact, onAction: onAction),
          (
            PvcfcComponentKind.syntheticWorkflowStatus,
            final PvcfcSyntheticWorkflowData workflow,
          ) =>
            _SyntheticWorkflowStatus(data: workflow, onAction: onAction),
          _ => const SizedBox.shrink(),
        },
      ),
    );
  }
}

class _CitedPublicEvidence extends StatelessWidget {
  const _CitedPublicEvidence({required this.data, required this.onAction});

  final PvcfcCitedPublicEvidenceData data;
  final ValueChanged<BusinessActionMetadata> onAction;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        _ComponentTitle(data.title),
        const SizedBox(height: 12),
        for (var index = 0; index < data.items.length; index++) ...[
          if (index > 0) const SizedBox(height: 12),
          _EvidenceItem(item: data.items[index], onAction: onAction),
        ],
      ],
    );
  }
}

class _EvidenceItem extends StatelessWidget {
  const _EvidenceItem({required this.item, required this.onAction});

  final PvcfcEvidenceItem item;
  final ValueChanged<BusinessActionMetadata> onAction;

  @override
  Widget build(BuildContext context) {
    final languageLabel = switch ((
      item.sourceVerification,
      item.outputLanguageTreatment,
    )) {
      (
        PvcfcSourceVerificationState.verifiedEnglish,
        PvcfcOutputLanguageTreatment.translatedFromEnglish,
      ) =>
        'Nguồn tiếng Anh đã được xác minh; tóm tắt được dịch sang tiếng Việt',
      (
        PvcfcSourceVerificationState.verifiedVietnamese,
        PvcfcOutputLanguageTreatment.nativeVietnamese,
      ) =>
        'Nguồn tiếng Việt đã được xác minh; nội dung hiển thị trực tiếp bằng '
            'tiếng Việt${item.hasVerifiedEnglishCounterpart ? '' : '. Nếu trả lời bằng tiếng Anh, phải ghi rõ là bản dịch/tóm tắt vì chưa có bản tiếng Anh được xác minh'}',
      _ => 'Trạng thái nguồn/ngôn ngữ đầu ra không hợp lệ',
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: item.freshnessState == PvcfcFreshnessState.historical
            ? const Color(0xFFFFF8E8)
            : const Color(0xFFF5F8F6),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              item.heading,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(item.summary),
            const SizedBox(height: 8),
            Text('Nguồn: ${item.sourceTitle}'),
            SelectableText(item.canonicalUrl),
            Text('Ngôn ngữ nguồn: ${item.sourceLanguage} · $languageLabel'),
            Text('Biểu diễn: ${item.representationLabel}'),
            if (item.relationshipLabel != null)
              Text('Quan hệ biểu diễn: ${item.relationshipLabel}'),
            Text('Ngày công bố/hiệu lực: ${item.publicationOrEffectiveDate}'),
            Text('Ngày chụp nguồn: ${item.capturedAt}'),
            Text('Độ mới/lịch sử: ${item.freshnessLabel}'),
            Text('Mã bằng chứng: ${item.evidenceId}'),
            Text('Thẩm quyền: ${item.authority}'),
            Text('Giới hạn: ${item.limitation}'),
            if (item.actionDisclosure != null) Text(item.actionDisclosure!),
            for (final action in item.actions)
              _ActionButton(action: action, onAction: onAction),
          ],
        ),
      ),
    );
  }
}

class _OfficialPublicContact extends StatelessWidget {
  const _OfficialPublicContact({required this.data, required this.onAction});

  final PvcfcOfficialPublicContactData data;
  final ValueChanged<BusinessActionMetadata> onAction;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _ComponentTitle(data.title),
        const SizedBox(height: 8),
        Text('Kênh đã xác minh: ${data.channelLabel}'),
        SelectableText(data.officialUrl),
        Text('Mục đích: ${data.purpose}'),
        Text('Trường dự kiến: ${data.expectedFields.join(', ')}'),
        Text('CAPTCHA: ${data.captchaObserved ? 'Có' : 'Không quan sát thấy'}'),
        Text(
          'Nhãn nút quan sát được: ${data.observedSubmitLabel} — '
          'chỉ mô tả, không bấm',
        ),
        Text(data.fieldLabelDisclosure),
        Text('Nguồn / bằng chứng: ${data.sourceTitle} · ${data.evidenceId}'),
        Text('Tài sản nguồn: ${data.sourceAssetPath}'),
        const SizedBox(height: 8),
        Text(
          data.notSubmittedDisclosure,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        for (final action in data.actions)
          _ActionButton(action: action, onAction: onAction),
      ],
    );
  }
}

class _SyntheticWorkflowStatus extends StatelessWidget {
  const _SyntheticWorkflowStatus({required this.data, required this.onAction});

  final PvcfcSyntheticWorkflowData data;
  final ValueChanged<BusinessActionMetadata> onAction;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _ComponentTitle(data.title),
        const SizedBox(height: 8),
        DecoratedBox(
          decoration: BoxDecoration(
            color: const Color(0xFFFFF4D6),
            border: Border.all(color: const Color(0xFFE4B24B)),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Text(
              data.disclosure,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text('Kịch bản: ${data.scenarioId}'),
        Text('Bản sửa đổi: ${data.fixtureRevision} / ${data.statusRevision}'),
        Text('Trạng thái: ${data.statusLabel}'),
        Text('Trạng thái bằng chứng: ${data.currentState.customerLabel}'),
        Text('Bằng chứng trạng thái: ${data.statusEvidence}'),
        Text('Diễn tiến: ${data.stateHistory}'),
        Text('Xác nhận chính xác: ${data.exactConfirmation}'),
        Text('Khôi phục: ${data.recoveryGuidance}'),
        const SizedBox(height: 8),
        for (final action in data.actions)
          _ActionButton(action: action, onAction: onAction),
      ],
    );
  }
}

class _ComponentTitle extends StatelessWidget {
  const _ComponentTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: Text(
        title,
        style: const TextStyle(
          color: Color(0xFF145A32),
          fontSize: 18,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.action, required this.onAction});

  final BusinessActionMetadata action;
  final ValueChanged<BusinessActionMetadata> onAction;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: TextButton(
        key: ValueKey('pvcfc-action-${action.actionId}'),
        onPressed: () => onAction(action),
        child: Text(action.label),
      ),
    );
  }
}

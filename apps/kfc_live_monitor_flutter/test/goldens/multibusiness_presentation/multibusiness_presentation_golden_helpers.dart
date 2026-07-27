import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_test_goldens/flutter_test_goldens.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_tokens.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/business_presentation_contract.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/business_presentation_shell.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/kfc_presentation_prototype_pack.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/pvcfc_presentation_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/business/pvcfc_presentation_prototype_pack.dart';

import '../../features/test_app.dart';

const multibusinessCatalogSize = Size(1280, 880);

const _pvcfcMobileSizes = <PvcfcComponentKind, Size>{
  PvcfcComponentKind.citedPublicEvidence: Size(390, 4100),
  PvcfcComponentKind.officialPublicContactHandoff: Size(390, 900),
  PvcfcComponentKind.syntheticWorkflowStatus: Size(390, 1020),
};

Future<void> runMultibusinessCatalogGolden(WidgetTester tester) async {
  await _runGolden(
    tester: tester,
    galleryName: 'KFC and PVCFC business presentation catalog',
    fileName: 'multibusiness_presentation_catalog',
    size: multibusinessCatalogSize,
    child: buildMultibusinessCatalogSurface(),
  );
}

Future<void> runPvcfcMobileGolden(
  WidgetTester tester,
  PvcfcComponentKind kind,
) async {
  final size = _pvcfcMobileSizes[kind]!;
  await _runGolden(
    tester: tester,
    galleryName: 'PVCFC ${kind.wireName} mobile presentation',
    fileName: 'pvcfc_mobile_${kind.wireName}',
    size: size,
    child: buildPvcfcMobileSurface(kind),
  );
}

Widget buildMultibusinessCatalogSurface({
  ValueChanged<BusinessActionMetadata>? onKfcAction,
  ValueChanged<BusinessActionMetadata>? onPvcfcAction,
}) {
  return _GoldenFrame(
    child: ColoredBox(
      color: const Color(0xFFF8F9F8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(40, 36, 40, 48),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Customer presentation catalog',
              style: TextStyle(
                color: Color(0xFF17251D),
                fontSize: 28,
                fontWeight: FontWeight.w800,
                height: 36 / 28,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Một shell trung lập · Hai Pack độc lập · Dữ liệu cố định',
              style: TextStyle(
                color: Color(0xFF53645A),
                fontSize: 15,
                height: 22 / 15,
              ),
            ),
            const SizedBox(height: 32),
            Expanded(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: _CatalogColumn(
                      eyebrow: 'KFC · VI-VN · COMMERCE',
                      description:
                          'Thanh toán đơn hàng với hành động do KFC quản lý.',
                      child: BusinessPresentationShell(
                        descriptor: KfcPresentationPrototypePack.descriptor,
                        envelope: KfcPresentationPrototypePack.envelopeFor(
                          attachment: kfcGenUiFixture(
                            KfcGenUiWidgetKind.paymentOrderStatus,
                          ),
                          canonicalText:
                              'Đơn KFC-1024 đang chờ thanh toán MoMo. Bạn có thể '
                              'thanh toán hoặc đổi phương thức.',
                        ),
                        onAction: onKfcAction ?? _ignoreAction,
                      ),
                    ),
                  ),
                  const SizedBox(width: 40),
                  const SizedBox(
                    width: 1,
                    height: double.infinity,
                    child: ColoredBox(color: Color(0xFFD4DDD7)),
                  ),
                  const SizedBox(width: 40),
                  Expanded(
                    child: _CatalogColumn(
                      eyebrow: 'PVCFC · VI-VN · PUBLIC CONTACT',
                      description:
                          'Chuyển tiếp minh bạch: chỉ mở hoặc sao chép, chưa gửi.',
                      child: BusinessPresentationShell(
                        descriptor: PvcfcPresentationPrototypePack.descriptor,
                        envelope:
                            PvcfcPresentationPrototypePack.fixtureEnvelope(
                              PvcfcComponentKind.officialPublicContactHandoff,
                            ),
                        onAction: onPvcfcAction ?? _ignoreAction,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

Widget buildPvcfcMobileSurface(
  PvcfcComponentKind kind, {
  ValueChanged<BusinessActionMetadata>? onAction,
}) {
  final descriptor = kind == PvcfcComponentKind.syntheticWorkflowStatus
      ? PvcfcPresentationPrototypePack.syntheticDescriptor
      : PvcfcPresentationPrototypePack.descriptor;
  final stateLabel = switch (kind) {
    PvcfcComponentKind.citedPublicEvidence =>
      'Nguồn, ngày chụp, độ mới và ngôn ngữ',
    PvcfcComponentKind.officialPublicContactHandoff =>
      'Kênh chính thức · không tự động nộp',
    PvcfcComponentKind.syntheticWorkflowStatus =>
      'Dữ liệu mô phỏng · trạng thái có bằng chứng',
  };

  return _GoldenFrame(
    child: ColoredBox(
      color: const Color(0xFFF8F9F8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 20, 12, 28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'PVCFC · MOBILE 390',
              style: TextStyle(
                color: Color(0xFF145A32),
                fontSize: 12,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.6,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              stateLabel,
              style: const TextStyle(
                color: Color(0xFF17251D),
                fontSize: 21,
                fontWeight: FontWeight.w800,
                height: 28 / 21,
              ),
            ),
            const SizedBox(height: 20),
            BusinessPresentationShell(
              descriptor: descriptor,
              envelope: kind == PvcfcComponentKind.syntheticWorkflowStatus
                  ? PvcfcPresentationPrototypePack.syntheticFixtureEnvelope(
                      PvcfcSyntheticWorkflowState.committed,
                    )
                  : PvcfcPresentationPrototypePack.fixtureEnvelope(kind),
              onAction: onAction ?? _ignoreAction,
            ),
          ],
        ),
      ),
    ),
  );
}

Future<void> _runGolden({
  required WidgetTester tester,
  required String galleryName,
  required String fileName,
  required Size size,
  required Widget child,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await Gallery(
        galleryName,
        directory: Directory(''),
        fileName: fileName,
        layout: ColumnSceneLayout(),
      )
      .itemFromBuilder(
        description: fileName,
        constraints: BoxConstraints.tight(size),
        builder: (_) => child,
      )
      .run(tester);
}

class _GoldenFrame extends StatelessWidget {
  const _GoldenFrame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return TestApp(
      child: DefaultTextStyle(
        style: const TextStyle(
          fontFamily: KfcOpsTokens.fontFamily,
          color: KfcOpsTokens.onSurface,
          fontSize: 14,
          fontWeight: FontWeight.w400,
          height: 20 / 14,
        ),
        child: child,
      ),
    );
  }
}

class _CatalogColumn extends StatelessWidget {
  const _CatalogColumn({
    required this.eyebrow,
    required this.description,
    required this.child,
  });

  final String eyebrow;
  final String description;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          eyebrow,
          style: const TextStyle(
            color: Color(0xFF53645A),
            fontSize: 12,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          description,
          style: const TextStyle(
            color: Color(0xFF17251D),
            fontSize: 16,
            fontWeight: FontWeight.w600,
            height: 23 / 16,
          ),
        ),
        const SizedBox(height: 20),
        child,
      ],
    );
  }
}

void _ignoreAction(BusinessActionMetadata action) {}

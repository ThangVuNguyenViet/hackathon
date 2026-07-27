import '../../../../app/theme/kfc_ops_tokens.dart';
import '../../domain/kfc_genui_models.dart';
import '../genui/kfc_genui_renderer.dart';
import 'business_presentation_contract.dart';

abstract final class KfcPresentationPrototypePack {
  static const pack = BusinessPackReference(
    packId: 'kfc-vietnam',
    packVersion: 'current',
    presentationCatalogVersion: 'kfc-genui-v1',
  );

  static final List<BusinessComponentIdentity> componentIdentities =
      List.unmodifiable(KfcGenUiWidgetKind.values.map(componentIdentityFor));

  static final BusinessPresentationDescriptor descriptor =
      BusinessPresentationDescriptor(
        businessId: 'kfc-vietnam',
        pack: pack,
        title: 'KFC Ordering Chat',
        subtitle: 'Đặt món nhanh với trợ lý KFC',
        monogram: 'KFC',
        theme: const BusinessPresentationThemeTokens(
          primary: KfcOpsTokens.primary,
          onPrimary: KfcOpsTokens.onPrimary,
          surface: KfcOpsTokens.surfaceContainerLowest,
          onSurface: KfcOpsTokens.onSurface,
          secondaryText: KfcOpsTokens.secondary,
          outline: KfcOpsTokens.secondaryContainer,
        ),
        copy: const BusinessPresentationCopy(
          primaryLocale: 'vi-VN',
          canonicalTextSemanticsLabel: 'Nội dung trả lời của trợ lý KFC',
          disclosureSemanticsLabel: 'Thông tin cần lưu ý từ KFC',
        ),
        persistentBadges: const [],
        mediaPolicy: const BusinessMediaPolicy(
          packId: 'kfc-vietnam',
          allowedHost: 'static.kfcvietnam.com.vn',
          mediaKeyPrefix: 'kfcvn:',
        ),
        navigationCitationUrlPolicy: NavigationCitationUrlPolicy(
          packId: 'kfc-vietnam',
          allowedSchemes: {'https'},
          allowedHosts: {'kfcvietnam.com.vn', 'www.kfcvietnam.com.vn'},
          allowedRoles: {
            BusinessNavigationRole.navigation,
            BusinessNavigationRole.citation,
            BusinessNavigationRole.form,
            BusinessNavigationRole.contact,
            BusinessNavigationRole.document,
          },
        ),
        rendererRegistrations: KfcGenUiWidgetKind.values
            .map(_registrationFor)
            .toList(growable: false),
      );

  static BusinessComponentIdentity componentIdentityFor(
    KfcGenUiWidgetKind kind,
  ) {
    return BusinessComponentIdentity(
      packId: pack.packId,
      componentKind: kind.wireName,
      schemaVersion: '1',
    );
  }

  static BusinessPresentationEnvelope envelopeFor({
    required KfcGenUiAttachment attachment,
    required String canonicalText,
    String? handoffStatus,
  }) {
    return BusinessPresentationEnvelope(
      pack: pack,
      canonicalText: canonicalText,
      component: BusinessComponentEnvelope(
        componentId: attachment.id,
        identity: componentIdentityFor(attachment.widgetKind),
        payload: _KfcPresentationPayload(
          attachment: attachment,
          handoffStatus: handoffStatus,
        ),
      ),
    );
  }

  static BusinessRendererRegistration _registrationFor(
    KfcGenUiWidgetKind kind,
  ) {
    final identity = componentIdentityFor(kind);
    return BusinessRendererRegistration(
      identity: identity,
      renderer: (context, component, onAction) {
        final payload = component.payload;
        if (payload is! _KfcPresentationPayload ||
            payload.attachment.id != component.componentId ||
            payload.attachment.widgetKind != kind) {
          return null;
        }
        return KfcGenUiRenderer(
          attachment: payload.attachment,
          handoffStatus: payload.handoffStatus,
          onAction: (action) {
            onAction(_metadataFor(payload.attachment, action));
          },
        );
      },
    );
  }

  static BusinessActionMetadata _metadataFor(
    KfcGenUiAttachment attachment,
    KfcGenUiAction action,
  ) {
    KfcGenUiActionSpec? matchingSpec;
    for (final spec in attachment.actions) {
      if (spec.id == action.actionId) {
        matchingSpec = spec;
        break;
      }
    }
    return BusinessActionMetadata(
      actionId: action.actionId,
      label: matchingSpec?.label ?? action.actionId,
      intent: _actionIntent(matchingSpec?.intent),
      semantics: BusinessActionSemantics.dispatch,
      displayValue: action.value,
      packPayload: action,
    );
  }

  static BusinessPresentationActionIntent _actionIntent(
    KfcGenUiActionIntent? intent,
  ) {
    return switch (intent) {
      KfcGenUiActionIntent.primary => BusinessPresentationActionIntent.primary,
      KfcGenUiActionIntent.destructive =>
        BusinessPresentationActionIntent.destructive,
      KfcGenUiActionIntent.recovery =>
        BusinessPresentationActionIntent.recovery,
      KfcGenUiActionIntent.secondary ||
      null => BusinessPresentationActionIntent.secondary,
    };
  }
}

class _KfcPresentationPayload {
  const _KfcPresentationPayload({
    required this.attachment,
    required this.handoffStatus,
  });

  final KfcGenUiAttachment attachment;
  final String? handoffStatus;
}

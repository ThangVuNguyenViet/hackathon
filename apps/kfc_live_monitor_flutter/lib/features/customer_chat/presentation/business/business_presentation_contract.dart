import 'package:flutter/widgets.dart';

typedef BusinessComponentRenderer =
    Widget? Function(
      BuildContext context,
      BusinessComponentEnvelope component,
      ValueChanged<BusinessActionMetadata> onAction,
    );

class BusinessPackReference {
  const BusinessPackReference({
    required this.packId,
    required this.packVersion,
    required this.presentationCatalogVersion,
  });

  final String packId;
  final String packVersion;
  final String presentationCatalogVersion;
}

class BusinessComponentIdentity {
  const BusinessComponentIdentity({
    required this.packId,
    required this.componentKind,
    required this.schemaVersion,
  });

  final String packId;
  final String componentKind;
  final String schemaVersion;

  @override
  bool operator ==(Object other) {
    return other is BusinessComponentIdentity &&
        other.packId == packId &&
        other.componentKind == componentKind &&
        other.schemaVersion == schemaVersion;
  }

  @override
  int get hashCode => Object.hash(packId, componentKind, schemaVersion);
}

class BusinessComponentEnvelope {
  const BusinessComponentEnvelope({
    required this.componentId,
    required this.identity,
    required this.payload,
  });

  final String componentId;
  final BusinessComponentIdentity identity;
  final Object payload;
}

class BusinessPresentationEnvelope {
  const BusinessPresentationEnvelope({
    required this.pack,
    required this.canonicalText,
    this.component,
  });

  final BusinessPackReference pack;
  final String canonicalText;
  final BusinessComponentEnvelope? component;
}

class BusinessPresentationThemeTokens {
  const BusinessPresentationThemeTokens({
    required this.primary,
    required this.onPrimary,
    required this.surface,
    required this.onSurface,
    required this.secondaryText,
    required this.outline,
  });

  final Color primary;
  final Color onPrimary;
  final Color surface;
  final Color onSurface;
  final Color secondaryText;
  final Color outline;
}

class BusinessPresentationCopy {
  const BusinessPresentationCopy({
    required this.primaryLocale,
    required this.canonicalTextSemanticsLabel,
    required this.disclosureSemanticsLabel,
  });

  final String primaryLocale;
  final String canonicalTextSemanticsLabel;
  final String disclosureSemanticsLabel;
}

class BusinessPresentationBadge {
  const BusinessPresentationBadge({
    required this.id,
    required this.label,
    required this.persistent,
  });

  final String id;
  final String label;
  final bool persistent;
}

class BusinessRendererRegistration {
  const BusinessRendererRegistration({
    required this.identity,
    required this.renderer,
  });

  final BusinessComponentIdentity identity;
  final BusinessComponentRenderer renderer;
}

class BusinessPresentationDescriptor {
  BusinessPresentationDescriptor({
    required this.businessId,
    required this.pack,
    required this.title,
    required this.subtitle,
    required this.monogram,
    required this.theme,
    required this.copy,
    required List<BusinessPresentationBadge> persistentBadges,
    required this.mediaPolicy,
    required this.navigationCitationUrlPolicy,
    required List<BusinessRendererRegistration> rendererRegistrations,
  }) : persistentBadges = List.unmodifiable(persistentBadges),
       rendererRegistrations = List.unmodifiable(rendererRegistrations),
       _rendererByIdentity = _buildRendererLookup(rendererRegistrations);

  final String businessId;
  final BusinessPackReference pack;
  final String title;
  final String subtitle;
  final String monogram;
  final BusinessPresentationThemeTokens theme;
  final BusinessPresentationCopy copy;
  final List<BusinessPresentationBadge> persistentBadges;
  final BusinessMediaPolicy mediaPolicy;
  final NavigationCitationUrlPolicy navigationCitationUrlPolicy;
  final List<BusinessRendererRegistration> rendererRegistrations;
  final Map<BusinessComponentIdentity, BusinessComponentRenderer>
  _rendererByIdentity;

  BusinessComponentRenderer? rendererFor(BusinessComponentIdentity identity) {
    if (identity.packId != pack.packId) return null;
    return _rendererByIdentity[identity];
  }

  static Map<BusinessComponentIdentity, BusinessComponentRenderer>
  _buildRendererLookup(List<BusinessRendererRegistration> registrations) {
    final lookup = <BusinessComponentIdentity, BusinessComponentRenderer>{};
    for (final registration in registrations) {
      if (lookup.containsKey(registration.identity)) {
        throw ArgumentError.value(
          registrations,
          'rendererRegistrations',
          'Duplicate renderer identity: '
              '${registration.identity.packId}/'
              '${registration.identity.componentKind}/'
              '${registration.identity.schemaVersion}',
        );
      }
      lookup[registration.identity] = registration.renderer;
    }
    return Map.unmodifiable(lookup);
  }
}

enum BusinessPresentationActionIntent {
  primary,
  secondary,
  destructive,
  recovery,
}

enum BusinessActionSemantics { dispatch, openPublicUrl, copy, displayOnly }

class BusinessActionMetadata {
  const BusinessActionMetadata({
    required this.actionId,
    required this.label,
    required this.intent,
    required this.semantics,
    this.publicUrl,
    this.copyText,
    this.displayValue,
    this.evidenceRef,
    this.confirmationReference,
    this.packPayload,
  });

  final String actionId;
  final String label;
  final BusinessPresentationActionIntent intent;
  final BusinessActionSemantics semantics;
  final String? publicUrl;
  final String? copyText;
  final String? displayValue;
  final String? evidenceRef;
  final String? confirmationReference;
  final Object? packPayload;
}

class BusinessEvidenceReference {
  const BusinessEvidenceReference({
    required this.packId,
    required this.evidenceId,
  });

  final String packId;
  final String evidenceId;

  bool isValidFor(String expectedPackId) {
    return packId == expectedPackId && evidenceId.trim().isNotEmpty;
  }

  @override
  bool operator ==(Object other) {
    return other is BusinessEvidenceReference &&
        other.packId == packId &&
        other.evidenceId == evidenceId;
  }

  @override
  int get hashCode => Object.hash(packId, evidenceId);
}

class BusinessMediaReference {
  const BusinessMediaReference({
    required this.packId,
    required this.mediaKey,
    required this.url,
    required this.altText,
    this.evidenceRef,
  });

  final String packId;
  final String mediaKey;
  final String url;
  final String altText;
  final BusinessEvidenceReference? evidenceRef;

  BusinessMediaReference copyWith({
    String? packId,
    String? mediaKey,
    String? url,
    String? altText,
    BusinessEvidenceReference? evidenceRef,
  }) {
    return BusinessMediaReference(
      packId: packId ?? this.packId,
      mediaKey: mediaKey ?? this.mediaKey,
      url: url ?? this.url,
      altText: altText ?? this.altText,
      evidenceRef: evidenceRef ?? this.evidenceRef,
    );
  }
}

class BusinessMediaPolicy {
  const BusinessMediaPolicy({
    required this.packId,
    required this.allowedHost,
    required this.mediaKeyPrefix,
  });

  final String packId;
  final String allowedHost;
  final String mediaKeyPrefix;

  bool allows(
    BusinessMediaReference media, {
    required Set<BusinessEvidenceReference> knownEvidenceRefs,
    BusinessEvidenceReference? expectedEvidenceRef,
  }) {
    final uri = Uri.tryParse(media.url);
    final evidenceRef = media.evidenceRef;
    return media.packId == packId &&
        media.mediaKey.startsWith(mediaKeyPrefix) &&
        media.mediaKey.length > mediaKeyPrefix.length &&
        media.altText.trim().isNotEmpty &&
        evidenceRef != null &&
        evidenceRef.isValidFor(packId) &&
        knownEvidenceRefs.contains(evidenceRef) &&
        (expectedEvidenceRef == null || evidenceRef == expectedEvidenceRef) &&
        uri != null &&
        uri.scheme == 'https' &&
        uri.host == allowedHost &&
        uri.userInfo.isEmpty;
  }
}

enum BusinessNavigationRole { navigation, citation, form, contact, document }

class BusinessNavigationReference {
  const BusinessNavigationReference({
    required this.packId,
    required this.url,
    required this.role,
    this.evidenceRef,
  });

  final String packId;
  final String url;
  final BusinessNavigationRole role;
  final BusinessEvidenceReference? evidenceRef;

  BusinessNavigationReference copyWith({
    String? packId,
    String? url,
    BusinessNavigationRole? role,
    BusinessEvidenceReference? evidenceRef,
  }) {
    return BusinessNavigationReference(
      packId: packId ?? this.packId,
      url: url ?? this.url,
      role: role ?? this.role,
      evidenceRef: evidenceRef ?? this.evidenceRef,
    );
  }
}

class NavigationCitationUrlPolicy {
  NavigationCitationUrlPolicy({
    required this.packId,
    required Set<String> allowedSchemes,
    required Set<String> allowedHosts,
    required Set<BusinessNavigationRole> allowedRoles,
  }) : allowedSchemes = Set.unmodifiable(allowedSchemes),
       allowedHosts = Set.unmodifiable(allowedHosts),
       allowedRoles = Set.unmodifiable(allowedRoles);

  final String packId;
  final Set<String> allowedSchemes;
  final Set<String> allowedHosts;
  final Set<BusinessNavigationRole> allowedRoles;

  bool allows(
    BusinessNavigationReference reference, {
    required Set<BusinessEvidenceReference> knownEvidenceRefs,
    BusinessEvidenceReference? expectedEvidenceRef,
  }) {
    final uri = Uri.tryParse(reference.url);
    final evidenceRef = reference.evidenceRef;
    if (reference.packId != packId ||
        !allowedRoles.contains(reference.role) ||
        evidenceRef == null ||
        !evidenceRef.isValidFor(packId) ||
        !knownEvidenceRefs.contains(evidenceRef) ||
        (expectedEvidenceRef != null && evidenceRef != expectedEvidenceRef) ||
        uri == null ||
        !uri.hasScheme ||
        !allowedSchemes.contains(uri.scheme) ||
        uri.userInfo.isNotEmpty) {
      return false;
    }
    if (uri.scheme == 'http' || uri.scheme == 'https') {
      return uri.host.isNotEmpty && allowedHosts.contains(uri.host);
    }
    return !uri.hasAuthority || allowedHosts.contains(uri.host);
  }
}

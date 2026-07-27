import 'package:flutter/widgets.dart';

import 'business_presentation_contract.dart';

class BusinessPresentationShell extends StatelessWidget {
  const BusinessPresentationShell({
    super.key,
    required this.descriptor,
    required this.envelope,
    this.onAction = _ignoreAction,
  });

  final BusinessPresentationDescriptor descriptor;
  final BusinessPresentationEnvelope envelope;
  final ValueChanged<BusinessActionMetadata> onAction;

  @override
  Widget build(BuildContext context) {
    if (!_matchesPack(descriptor.pack, envelope.pack) ||
        envelope.canonicalText.trim().isEmpty) {
      return const SizedBox.shrink();
    }

    final component = envelope.component;
    final renderer = component == null
        ? null
        : descriptor.rendererFor(component.identity);
    final renderedComponent = component == null || renderer == null
        ? null
        : renderer(context, component, onAction);

    return ColoredBox(
      color: descriptor.theme.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          _BusinessHeader(descriptor: descriptor),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Semantics(
                  label: descriptor.copy.canonicalTextSemanticsLabel,
                  child: Text(
                    envelope.canonicalText,
                    style: TextStyle(
                      color: descriptor.theme.onSurface,
                      fontSize: 14,
                      height: 20 / 14,
                    ),
                  ),
                ),
                for (final badge in descriptor.persistentBadges)
                  if (badge.persistent) ...[
                    const SizedBox(height: 8),
                    _PersistentBadge(descriptor: descriptor, badge: badge),
                  ],
                if (renderedComponent != null) ...[
                  const SizedBox(height: 16),
                  renderedComponent,
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BusinessHeader extends StatelessWidget {
  const _BusinessHeader({required this.descriptor});

  final BusinessPresentationDescriptor descriptor;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: descriptor.theme.outline)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Row(
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: descriptor.theme.primary,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: SizedBox.square(
                  dimension: 42,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        descriptor.monogram,
                        maxLines: 1,
                        softWrap: false,
                        style: TextStyle(
                          color: descriptor.theme.onPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      descriptor.title,
                      style: TextStyle(
                        color: descriptor.theme.primary,
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        height: 28 / 22,
                      ),
                    ),
                    Text(
                      descriptor.subtitle,
                      style: TextStyle(
                        color: descriptor.theme.secondaryText,
                        fontSize: 13,
                        height: 18 / 13,
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
}

class _PersistentBadge extends StatelessWidget {
  const _PersistentBadge({required this.descriptor, required this.badge});

  final BusinessPresentationDescriptor descriptor;
  final BusinessPresentationBadge badge;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: descriptor.copy.disclosureSemanticsLabel,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: descriptor.theme.surface,
          border: Border.all(color: descriptor.theme.outline),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Text(
            badge.label,
            style: TextStyle(
              color: descriptor.theme.secondaryText,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}

bool _matchesPack(
  BusinessPackReference expected,
  BusinessPackReference actual,
) {
  return expected.packId == actual.packId &&
      expected.packVersion == actual.packVersion &&
      expected.presentationCatalogVersion == actual.presentationCatalogVersion;
}

void _ignoreAction(BusinessActionMetadata action) {}

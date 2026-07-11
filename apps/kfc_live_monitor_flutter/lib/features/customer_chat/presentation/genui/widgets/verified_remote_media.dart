import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';

class VerifiedRemoteMedia extends StatelessWidget {
  const VerifiedRemoteMedia({
    super.key,
    required this.imageKey,
    required this.imageUrl,
    required this.semanticLabel,
    required this.height,
    this.width,
    this.outerPadding = EdgeInsets.zero,
    this.borderRadius = const BorderRadius.all(KfcOpsTokens.radiusMd),
  });

  final Key imageKey;
  final String imageUrl;
  final String semanticLabel;
  final double? width;
  final double height;
  final EdgeInsetsGeometry outerPadding;
  final BorderRadius borderRadius;

  @override
  Widget build(BuildContext context) {
    if (!_isOfficialKfcImageUrl(imageUrl)) return const SizedBox.shrink();
    return Image.network(
      imageUrl,
      key: imageKey,
      webHtmlElementStrategy: WebHtmlElementStrategy.prefer,
      width: width,
      height: height,
      fit: BoxFit.contain,
      semanticLabel: semanticLabel,
      frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
        final loaded = wasSynchronouslyLoaded || frame != null;
        return Padding(
          padding: outerPadding,
          child: ClipRRect(
            borderRadius: borderRadius,
            child: SizedBox(
              width: width ?? double.infinity,
              height: height,
              child: ColoredBox(
                color: KfcOpsTokens.surfaceContainerLow,
                child: loaded
                    ? child
                    : Semantics(
                        image: true,
                        label: semanticLabel,
                        child: const SizedBox.expand(),
                      ),
              ),
            ),
          ),
        );
      },
      errorBuilder: (context, error, stackTrace) => const SizedBox.shrink(),
    );
  }
}

class FirstCartMedia {
  const FirstCartMedia({
    required this.imageUrl,
    required this.identity,
    required this.semanticLabel,
  });
  final String imageUrl;
  final String identity;
  final String semanticLabel;
}

FirstCartMedia? selectFirstMainCartMedia(List<Map<String, Object?>> items) {
  final explicitMainItems = items.where(
    (item) => _text(item['category']).toLowerCase() == 'main',
  );
  final candidate = explicitMainItems.isNotEmpty
      ? explicitMainItems.first
      : _firstWithImageUrl(items);
  if (candidate == null) return null;
  final imageUrl = _text(candidate['imageUrl']);
  if (!_isOfficialKfcImageUrl(imageUrl)) return null;
  final identity = [
    candidate['mediaKey'],
    candidate['itemCode'],
    candidate['code'],
    imageUrl,
  ].map(_text).firstWhere((value) => value.isNotEmpty);
  final name = _text(candidate['name']);
  return FirstCartMedia(
    imageUrl: imageUrl,
    identity: identity,
    semanticLabel: name.isEmpty ? 'Hình món KFC' : 'Hình món $name',
  );
}

Map<String, Object?>? _firstWithImageUrl(List<Map<String, Object?>> items) {
  for (final item in items) {
    if (_isOfficialKfcImageUrl(_text(item['imageUrl']))) return item;
  }
  return null;
}

bool _isOfficialKfcImageUrl(String value) {
  final uri = Uri.tryParse(value);
  return uri != null &&
      uri.scheme == 'https' &&
      uri.host == 'static.kfcvietnam.com.vn';
}

String _text(Object? value) => value?.toString().trim() ?? '';

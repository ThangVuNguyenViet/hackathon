import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import 'verified_remote_media.dart';

class DecisionMediaReference {
  const DecisionMediaReference({
    required this.mediaKey,
    required this.url,
    required this.altText,
    this.width,
    this.height,
  });

  final String mediaKey;
  final String url;
  final String altText;
  final int? width;
  final int? height;
}

DecisionMediaReference? decisionMedia(Object? value) {
  final direct = KfcVerifiedMedia.tryFromJson(value);
  if (direct != null) {
    return DecisionMediaReference(
      mediaKey: direct.mediaKey,
      url: direct.url,
      altText: direct.altText,
      width: direct.width,
      height: direct.height,
    );
  }
  if (value is Map) {
    final map = Map<String, Object?>.from(value);
    final nested = decisionMedia(map['media']);
    if (nested != null) return nested;
    final imageUrl = decisionText(map['imageUrl']);
    final uri = Uri.tryParse(imageUrl);
    if (uri != null &&
        uri.scheme == 'https' &&
        uri.host == 'static.kfcvietnam.com.vn') {
      return DecisionMediaReference(
        mediaKey: imageUrl,
        url: imageUrl,
        altText: decisionText(map['name'], fallback: 'Hình món KFC'),
      );
    }
  }
  return null;
}

Map<String, Object?> decisionMap(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is Map) return Map<String, Object?>.from(value);
  return const <String, Object?>{};
}

List<Map<String, Object?>> decisionList(Object? value) {
  if (value is! List) return const <Map<String, Object?>>[];
  return value
      .whereType<Map>()
      .map((entry) => Map<String, Object?>.from(entry))
      .toList(growable: false);
}

String decisionText(Object? value, {String fallback = ''}) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? fallback : text;
}

class DecisionHeroMedia extends StatelessWidget {
  const DecisionHeroMedia({
    super.key,
    required this.media,
    required this.imageKey,
  });

  final DecisionMediaReference? media;
  final Key imageKey;

  @override
  Widget build(BuildContext context) {
    final value = media;
    if (value == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingMd),
      child: VerifiedRemoteMedia(
        imageKey: imageKey,
        imageUrl: value.url,
        semanticLabel: value.altText,
        height: _heroHeight(value),
      ),
    );
  }
}

double _heroHeight(DecisionMediaReference media) {
  final width = media.width;
  final height = media.height;
  if (width == null || height == null) return 210;
  return (320 * height / width).clamp(150, 250).toDouble();
}

const decisionTitleStyle = TextStyle(
  color: KfcOpsTokens.onSurface,
  fontSize: 16,
  fontWeight: FontWeight.w800,
  height: 21 / 16,
);

const decisionBodyStyle = TextStyle(
  color: KfcOpsTokens.secondary,
  fontSize: 12,
  height: 17 / 12,
);

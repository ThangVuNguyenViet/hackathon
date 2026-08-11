import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import 'app/theme/kfc_ops_theme.dart';
import 'features/automatic_recommendations/application/automatic_recommendation_kiosk_controller.dart';
import 'features/automatic_recommendations/data/automatic_recommendation_client.dart';
import 'features/automatic_recommendations/presentation/automatic_recommendation_kiosk_screen.dart';

const _backendUrl = String.fromEnvironment('KFC_AGENT_BACKEND_URL');
const _contextJson = String.fromEnvironment('KFC_KIOSK_CONTEXT_JSON');

void main() {
  final client = AutomaticRecommendationClient(
    baseUri: Uri.tryParse(_backendUrl) ?? Uri.parse('http://127.0.0.1:9'),
  );
  runApp(_KioskApp(client: client, context: _parseContext(_contextJson)));
}

class _KioskApp extends StatefulWidget {
  const _KioskApp({required this.client, required this.context});

  final AutomaticRecommendationClient client;
  final RecommendationKioskContext? context;

  @override
  State<_KioskApp> createState() => _KioskAppState();
}

class _KioskAppState extends State<_KioskApp> {
  late final controller = AutomaticRecommendationKioskController(
    client: widget.client,
    context: widget.context,
  );

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ShadApp(
      title: 'KFC Automatic Recommendation Kiosk',
      theme: buildKfcOpsTheme(),
      home: AutomaticRecommendationKioskScreen(controller: controller),
    );
  }
}

RecommendationKioskContext? _parseContext(String value) {
  if (value.trim().isEmpty) return null;
  try {
    final decoded = jsonDecode(value);
    if (decoded is! Map) return null;
    final map = Map<String, dynamic>.from(decoded);
    final cart = map['cart'];
    if (cart is! Map) return null;
    return RecommendationKioskContext(
      storeId: map['storeId'] as String,
      fulfilmentMode: map['fulfilmentMode'] as String,
      locale: map['locale'] as String,
      orderingJourneyRef: map['orderingJourneyRef'] as String,
      opportunityRef: map['opportunityRef'] as String,
      cart: Map<String, dynamic>.from(cart),
      verifiedCustomerRef: map['verifiedCustomerRef'] as String?,
      parentCartLineId: map['parentCartLineId'] as String?,
    );
  } on Object {
    return null;
  }
}

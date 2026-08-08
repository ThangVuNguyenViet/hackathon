import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:kfc_live_monitor/features/automatic_recommendations/application/automatic_recommendation_kiosk_controller.dart';
import 'package:kfc_live_monitor/features/automatic_recommendations/data/automatic_recommendation_client.dart';
import 'package:kfc_live_monitor/features/automatic_recommendations/presentation/automatic_recommendation_kiosk_screen.dart';
import '../test_app.dart';

void main() {
  testWidgets(
    'renders the three kiosk regions and fails closed without context',
    (tester) async {
      final controller = AutomaticRecommendationKioskController(
        client: AutomaticRecommendationClient(
          baseUri: Uri.parse('https://backend.example/'),
          httpClient: _NeverNetworkClient(),
        ),
      );
      await tester.pumpWidget(
        TestApp(
          child: AutomaticRecommendationKioskScreen(controller: controller),
        ),
      );

      expect(find.text('01 · Context'), findsOneWidget);
      expect(find.text('02 · Recommendations'), findsOneWidget);
      expect(find.text('03 · Evidence'), findsOneWidget);
      expect(
        find.text(
          'Configure KFC_KIOSK_CONTEXT_JSON before launching this kiosk.',
        ),
        findsOneWidget,
      );
      expect(find.text('Serving unavailable'), findsNothing);
      controller.dispose();
    },
  );

  testWidgets(
    'shows all four exact decision operations for a configured kiosk',
    (tester) async {
      final controller = AutomaticRecommendationKioskController(
        client: AutomaticRecommendationClient(
          baseUri: Uri.parse('https://backend.example/'),
          httpClient: _NeverNetworkClient(),
        ),
        context: const RecommendationKioskContext(
          storeId: 'KFCVN0002',
          fulfilmentMode: 'pickup',
          locale: 'vi-VN',
          orderingJourneyRef: 'journey-001',
          opportunityRef: 'opportunity-001',
          cart: {
            'cartId': 'cart-001',
            'revision': 'revision-001',
            'subtotal': {'amount': 0, 'currency': 'VND'},
            'lines': <Object?>[],
          },
          verifiedCustomerRef: 'customer-001',
          parentCartLineId: 'line-001',
        ),
      );
      await tester.pumpWidget(
        TestApp(
          child: AutomaticRecommendationKioskScreen(controller: controller),
        ),
      );
      await tester.pump();

      expect(find.text('Local favorite'), findsOneWidget);
      expect(find.text('For you'), findsOneWidget);
      expect(find.text('Modifier upsell'), findsOneWidget);
      expect(find.text('Smart cross-sell'), findsOneWidget);
      controller.dispose();
    },
  );
}

class _NeverNetworkClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    throw StateError('network should not be reached by this widget test');
  }
}

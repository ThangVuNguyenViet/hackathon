import 'package:flutter/material.dart';

import '../features/kiosk_prototype/presentation/kiosk_recommendation_prototype_screen.dart';
import 'theme/kfc_ops_tokens.dart';

/// THROWAWAY PROTOTYPE.
///
/// This entrypoint explores kiosk recommendation journeys. It is deliberately
/// isolated from the customer chat and production monitor entrypoints.
class KfcKioskPrototypeApp extends StatelessWidget {
  const KfcKioskPrototypeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'KFC automatic recommendation prototype',
      theme: ThemeData(
        useMaterial3: true,
        fontFamily: KfcOpsTokens.fontFamily,
        scaffoldBackgroundColor: const Color(0xFFF7F4EF),
        colorScheme: ColorScheme.fromSeed(
          seedColor: KfcOpsTokens.primary,
          primary: KfcOpsTokens.primaryContainer,
          surface: Colors.white,
        ),
      ),
      home: const KioskRecommendationPrototypeScreen(),
    );
  }
}

import 'package:flutter/widgets.dart';

import 'app/kfc_customer_chat_app.dart';
import 'app/kfc_showcase_app.dart';

void main() {
  final path = Uri.base.path;
  runApp(
    path == '/demo' || path == '/demo/'
        ? const KfcShowcaseApp()
        : const KfcCustomerChatApp(),
  );
}

import 'package:fdb_helper/fdb_helper.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'app/kfc_customer_chat_app.dart';
import 'app/kfc_showcase_app.dart';

void main() {
  if (!kReleaseMode) FdbBinding.ensureInitialized();
  final path = Uri.base.path;
  runApp(
    path == '/demo' || path == '/demo/'
        ? const KfcShowcaseApp()
        : const KfcCustomerChatApp(),
  );
}

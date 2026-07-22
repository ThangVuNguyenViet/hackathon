import 'package:fdb_helper/fdb_helper.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'app/kfc_customer_chat_app.dart';
import 'features/customer_chat/application/customer_chat_controller.dart';
import 'features/customer_chat/data/customer_chat_repository.dart';

void main() {
  if (!kReleaseMode) FdbBinding.ensureInitialized();
  runApp(
    KfcCustomerChatApp(
      controller: CustomerChatController(
        repository: BackendCustomerChatRepository(
          baseUrl: 'http://127.0.0.1:18090',
        ),
      ),
    ),
  );
}

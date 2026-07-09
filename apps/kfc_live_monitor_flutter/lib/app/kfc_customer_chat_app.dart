import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../features/customer_chat/application/customer_chat_controller.dart';
import '../features/customer_chat/data/customer_chat_repository.dart';
import '../features/customer_chat/presentation/customer_chat_screen.dart';
import 'theme/kfc_ops_theme.dart';

const _customerBackendUrl = String.fromEnvironment('KFC_AGENT_BACKEND_URL');

class KfcCustomerChatApp extends StatelessWidget {
  const KfcCustomerChatApp({super.key, this.controller});

  final CustomerChatController? controller;

  @override
  Widget build(BuildContext context) {
    return ShadApp(
      title: 'KFC Ordering Chat',
      theme: buildKfcOpsTheme(),
      home: CustomerChatScreen(
        controller:
            controller ??
            CustomerChatController(
              repository: _customerBackendUrl.isEmpty
                  ? const FixtureCustomerChatRepository()
                  : BackendCustomerChatRepository(baseUrl: _customerBackendUrl),
            ),
      ),
    );
  }
}

import 'package:flutter/widgets.dart';

import '../domain/kfc_genui_models.dart';

abstract final class CustomerChatKeys {
  static const screen = Key('customerChatScreen');
  static const transcript = Key('customerChatTranscript');
  static const messageInput = Key('customerChatMessageInput');
  static const sendButton = Key('customerChatSendButton');
  static const errorBanner = Key('customerChatErrorBanner');

  static Key quickPrompt(String id) => Key('customerChatQuickPrompt_$id');

  static Key genUi(KfcGenUiWidgetKind kind) => Key('kfcGenUi_${kind.wireName}');

  static Key genUiAction(String attachmentId, String actionId) {
    return Key('kfcGenUiAction_${attachmentId}_$actionId');
  }
}

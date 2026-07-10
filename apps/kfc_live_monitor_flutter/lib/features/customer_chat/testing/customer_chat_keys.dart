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

  static Key genUiMenuQuantity(String attachmentId, String itemCode) {
    return Key('kfcGenUiMenuQuantity_${attachmentId}_$itemCode');
  }

  static Key genUiMenuQuantityDecrease(String attachmentId, String itemCode) {
    return Key('kfcGenUiMenuQuantityDecrease_${attachmentId}_$itemCode');
  }

  static Key genUiMenuQuantityIncrease(String attachmentId, String itemCode) {
    return Key('kfcGenUiMenuQuantityIncrease_${attachmentId}_$itemCode');
  }

  static Key genUiMenuAddItem(String attachmentId, String itemCode) {
    return Key('kfcGenUiMenuAddItem_${attachmentId}_$itemCode');
  }
}

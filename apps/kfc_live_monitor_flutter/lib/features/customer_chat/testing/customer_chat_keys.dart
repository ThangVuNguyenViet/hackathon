import 'package:flutter/widgets.dart';

import '../domain/kfc_genui_models.dart';

abstract final class CustomerChatKeys {
  static const screen = Key('customerChatScreen');
  static const transcript = Key('customerChatTranscript');
  static const messageInput = Key('customerChatMessageInput');
  static const sendButton = Key('customerChatSendButton');
  static const stopButton = Key('customerChatStopButton');
  static const responseBlock = Key('customerChatResponseBlock');
  static const progressLabel = Key('customerChatProgressLabel');
  static const errorBanner = Key('customerChatErrorBanner');
  static const approvalCard = Key('customerChatApprovalCard');
  static const approvalApproveButton = Key('customerChatApprovalApproveButton');
  static const approvalRejectButton = Key('customerChatApprovalRejectButton');
  static const modelSelector = Key('customerChatModelSelector');

  static Key modelLabel(String candidateId) =>
      Key('customerChatModelLabel_$candidateId');

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

  static Key genUiCartQuantityDecrease(String attachmentId, String itemCode) {
    return Key('kfcGenUiCartQuantityDecrease_${attachmentId}_$itemCode');
  }

  static Key genUiCartQuantityIncrease(String attachmentId, String itemCode) {
    return Key('kfcGenUiCartQuantityIncrease_${attachmentId}_$itemCode');
  }

  static Key genUiCartRemove(String attachmentId, String itemCode) {
    return Key('kfcGenUiCartRemove_${attachmentId}_$itemCode');
  }

  static Key genUiCartQuantity(String attachmentId, String itemCode) {
    return Key('kfcGenUiCartQuantity_${attachmentId}_$itemCode');
  }

  static Key genUiCartImage(String attachmentId, String itemCode) {
    return Key('kfcGenUiCartImage_${attachmentId}_$itemCode');
  }

  static Key genUiAddressField(String attachmentId, String field) {
    return Key('kfcGenUiAddressField_${attachmentId}_$field');
  }

  static Key genUiAddressMissingField(String attachmentId, String field) {
    return Key('kfcGenUiAddressMissingField_${attachmentId}_$field');
  }

  static Key genUiMenuImage(String attachmentId, String itemCode) =>
      Key('kfcGenUiMenuImage_${attachmentId}_$itemCode');

  static Key genUiMenuItem(String attachmentId, String itemCode) =>
      Key('kfcGenUiMenuItem_${attachmentId}_$itemCode');

  static Key genUiMenuCategory(String attachmentId, String category) =>
      Key('kfcGenUiMenuCategory_${attachmentId}_$category');

  static Key genUiMenuSelectionLimit(String attachmentId) =>
      Key('kfcGenUiMenuSelectionLimit_$attachmentId');

  static Key genUiModifierOption(
    String attachmentId,
    String optionOrGroupId, [
    String? modifierId,
  ]) => Key(
    modifierId == null
        ? 'kfcGenUiModifierOption_${attachmentId}_$optionOrGroupId'
        : 'kfcGenUiModifierOption_${attachmentId}_${optionOrGroupId}_$modifierId',
  );

  static Key genUiDecisionImage(String attachmentId, String mediaIdentity) =>
      Key('kfcGenUiDecisionImage_${attachmentId}_$mediaIdentity');

  static Key genUiRecommendationItem(
    String attachmentId,
    String recommendationActionId,
  ) =>
      Key('kfcGenUiRecommendationItem_${attachmentId}_$recommendationActionId');

  static Key genUiRecommendationImage(
    String attachmentId,
    String recommendationActionId,
  ) => Key(
    'kfcGenUiRecommendationImage_${attachmentId}_$recommendationActionId',
  );

  static Key genUiRecommendationState(String attachmentId) =>
      Key('kfcGenUiRecommendationState_$attachmentId');
}

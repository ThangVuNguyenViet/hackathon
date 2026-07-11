import 'package:flutter/material.dart'
    show Colors, InputBorder, InputDecoration, Material, Scrollbar, TextField;
import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:state_beacon/state_beacon.dart';

import '../../../app/theme/kfc_ops_tokens.dart';
import '../application/customer_chat_controller.dart';
import '../domain/customer_run_models.dart';
import '../domain/kfc_genui_models.dart';
import '../testing/customer_chat_keys.dart';
import 'genui/kfc_genui_renderer.dart';
import 'customer_response_block.dart';

class CustomerChatScreen extends StatefulWidget {
  const CustomerChatScreen({super.key, required this.controller});

  final CustomerChatController controller;

  @override
  State<CustomerChatScreen> createState() => _CustomerChatScreenState();
}

class _CustomerChatScreenState extends State<CustomerChatScreen> {
  late final TextEditingController _textController;
  late final ScrollController _scrollController;
  String? _renderedContentVersion;
  var _followLatestScheduled = false;
  final _bottomKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _textController = TextEditingController();
    _scrollController = ScrollController();
  }

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.controller.state.watch(context);
    if (_textController.text != state.draftText) {
      _textController.value = _textController.value.copyWith(
        text: state.draftText,
        selection: TextSelection.collapsed(offset: state.draftText.length),
      );
    }
    _scheduleFollowLatest(
      '${state.messages.length}:${state.activeDraft?.runId}:'
      '${state.activeDraft?.lastSequence}',
    );

    return DefaultTextStyle(
      style: const TextStyle(
        fontFamily: KfcOpsTokens.fontFamily,
        color: KfcOpsTokens.onSurface,
        letterSpacing: 0,
      ),
      child: ColoredBox(
        key: CustomerChatKeys.screen,
        color: KfcOpsTokens.surface,
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1040),
              child: Column(
                children: [
                  const _CustomerChatHeader(),
                  Expanded(
                    child: Scrollbar(
                      controller: _scrollController,
                      thickness: 3,
                      radius: const Radius.circular(2),
                      child: ListView(
                        key: CustomerChatKeys.transcript,
                        controller: _scrollController,
                        padding: const EdgeInsets.fromLTRB(
                          KfcOpsTokens.gutter,
                          KfcOpsTokens.gutter,
                          KfcOpsTokens.gutter,
                          88,
                        ),
                        children: [
                          if (!state.messages.any(
                            (message) =>
                                message.role == CustomerChatRole.customer,
                          )) ...[
                            _QuickPromptRow(
                              onPrompt: widget.controller.sendQuickPrompt,
                            ),
                            const SizedBox(height: KfcOpsTokens.spacingMd),
                          ],
                          for (final message in state.messages)
                            _MessageBlock(
                              message: message,
                              onAction: widget.controller.submitAction,
                              handoffStatus: state.handoffStatus,
                            ),
                          if (state.activeDraft case final draft?
                              when !(draft.materialized &&
                                  draft.terminal ==
                                      CustomerRunTerminal.completed))
                            Padding(
                              padding: EdgeInsets.only(
                                top: KfcOpsTokens.spacingSm,
                              ),
                              child: CustomerResponseBlock(
                                key: ValueKey(draft.runId),
                                draft: draft,
                                onAction: widget.controller.submitAction,
                                handoffStatus: state.handoffStatus,
                              ),
                            ),
                          if (state.errorMessage case final error?)
                            Padding(
                              padding: const EdgeInsets.only(
                                top: KfcOpsTokens.spacingSm,
                              ),
                              child: _ErrorBanner(error: error),
                            ),
                          SizedBox(key: _bottomKey, height: 1),
                        ],
                      ),
                    ),
                  ),
                  _Composer(
                    controller: _textController,
                    isSending: state.isSending,
                    canStop:
                        state.activeDraft?.cancellable == true &&
                        state.activeDraft?.isStopping != true,
                    onChanged: widget.controller.updateDraft,
                    onSend: widget.controller.sendDraft,
                    onStop: widget.controller.stopActiveRun,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _scheduleFollowLatest(String contentVersion) {
    if (contentVersion == _renderedContentVersion) return;
    _renderedContentVersion = contentVersion;

    final shouldFollow =
        !_scrollController.hasClients ||
        _scrollController.position.maxScrollExtent -
                _scrollController.position.pixels <=
            80;
    if (!shouldFollow || _followLatestScheduled) return;
    _followLatestScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _followLatestScheduled = false;
      if (!mounted || !_scrollController.hasClients) return;
      _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
    });
  }
}

class _CustomerChatHeader extends StatelessWidget {
  const _CustomerChatHeader();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLowest,
        border: Border(
          bottom: BorderSide(color: KfcOpsTokens.secondaryContainer),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: KfcOpsTokens.marginDesktop,
          vertical: KfcOpsTokens.spacingMd,
        ),
        child: Row(
          children: [
            DecoratedBox(
              decoration: const BoxDecoration(
                color: KfcOpsTokens.primary,
                borderRadius: BorderRadius.all(KfcOpsTokens.radiusMd),
              ),
              child: const SizedBox(
                width: 42,
                height: 42,
                child: Center(
                  child: Text(
                    'KFC',
                    style: TextStyle(
                      color: KfcOpsTokens.onPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: KfcOpsTokens.spacingMd),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'KFC Ordering Chat',
                    style: TextStyle(
                      color: KfcOpsTokens.primary,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      height: 28 / 22,
                      letterSpacing: 0,
                    ),
                  ),
                  Text(
                    'Đặt món nhanh với trợ lý KFC',
                    style: TextStyle(
                      color: KfcOpsTokens.secondary,
                      fontSize: 13,
                      height: 18 / 13,
                      letterSpacing: 0,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              LucideIcons.messageCircle,
              color: KfcOpsTokens.secondary,
              size: 22,
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickPromptRow extends StatelessWidget {
  const _QuickPromptRow({required this.onPrompt});

  final ValueChanged<String> onPrompt;

  @override
  Widget build(BuildContext context) {
    final prompts = const [
      ('menu', 'Gợi ý combo'),
      ('delivery', 'Kiểm tra giao hàng'),
      ('support', 'Gặp nhân viên'),
    ];
    return Wrap(
      spacing: KfcOpsTokens.spacingSm,
      runSpacing: KfcOpsTokens.spacingSm,
      children: [
        for (final prompt in prompts)
          ShadButton.outline(
            key: CustomerChatKeys.quickPrompt(prompt.$1),
            size: ShadButtonSize.sm,
            height: 32,
            padding: const EdgeInsets.symmetric(
              horizontal: KfcOpsTokens.spacingMd,
              vertical: KfcOpsTokens.spacingSm,
            ),
            backgroundColor: KfcOpsTokens.surfaceContainerLowest,
            foregroundColor: KfcOpsTokens.onSurface,
            hoverBackgroundColor: KfcOpsTokens.surfaceContainerLow,
            onPressed: () => onPrompt(prompt.$2),
            child: Text(
              prompt.$2,
              style: const TextStyle(
                color: KfcOpsTokens.onSurface,
                fontSize: 12,
                fontWeight: FontWeight.w700,
                height: 16 / 12,
                letterSpacing: 0,
              ),
            ),
          ),
      ],
    );
  }
}

class _MessageBlock extends StatelessWidget {
  const _MessageBlock({
    required this.message,
    required this.onAction,
    this.handoffStatus,
  });

  final CustomerChatMessage message;
  final ValueChanged<KfcGenUiAction> onAction;
  final String? handoffStatus;

  @override
  Widget build(BuildContext context) {
    final isCustomer = message.role == CustomerChatRole.customer;
    return Padding(
      padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingMd),
      child: Align(
        alignment: isCustomer ? Alignment.centerRight : Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 700),
          child: Column(
            crossAxisAlignment: isCustomer
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: isCustomer
                      ? KfcOpsTokens.primary
                      : KfcOpsTokens.surfaceContainerLowest,
                  border: Border.all(
                    color: isCustomer
                        ? KfcOpsTokens.primary
                        : KfcOpsTokens.secondaryContainer,
                  ),
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(8),
                    topRight: const Radius.circular(8),
                    bottomLeft: Radius.circular(isCustomer ? 8 : 2),
                    bottomRight: Radius.circular(isCustomer ? 2 : 8),
                  ),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: KfcOpsTokens.spacingMd,
                    vertical: KfcOpsTokens.spacingSm,
                  ),
                  child: Text(
                    message.text,
                    style: TextStyle(
                      color: isCustomer
                          ? KfcOpsTokens.onPrimary
                          : KfcOpsTokens.onSurface,
                      fontSize: 14,
                      height: 20 / 14,
                      letterSpacing: 0,
                    ),
                  ),
                ),
              ),
              if (message.genUi case final genUi?) ...[
                const SizedBox(height: KfcOpsTokens.spacingSm),
                KfcGenUiRenderer(
                  attachment: genUi,
                  onAction: onAction,
                  handoffStatus: handoffStatus,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.error});

  final String error;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: CustomerChatKeys.errorBanner,
      decoration: BoxDecoration(
        color: KfcOpsTokens.criticalContainer,
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
        child: Text(
          error,
          style: const TextStyle(
            color: KfcOpsTokens.critical,
            fontSize: 12,
            height: 16 / 12,
            letterSpacing: 0,
          ),
        ),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.isSending,
    required this.canStop,
    required this.onChanged,
    required this.onSend,
    required this.onStop,
  });

  final TextEditingController controller;
  final bool isSending;
  final bool canStop;
  final ValueChanged<String> onChanged;
  final VoidCallback onSend;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLowest,
        border: Border(top: BorderSide(color: KfcOpsTokens.secondaryContainer)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.gutter),
        child: Row(
          children: [
            Expanded(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: KfcOpsTokens.surfaceContainerLow,
                  borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
                  border: Border.all(color: KfcOpsTokens.secondaryContainer),
                ),
                child: Material(
                  color: Colors.transparent,
                  child: TextField(
                    key: CustomerChatKeys.messageInput,
                    controller: controller,
                    enabled: !isSending,
                    onChanged: onChanged,
                    onSubmitted: (_) => onSend(),
                    style: const TextStyle(
                      fontFamily: KfcOpsTokens.fontFamily,
                      fontSize: 14,
                      height: 20 / 14,
                      letterSpacing: 0,
                    ),
                    decoration: const InputDecoration(
                      hintText: 'Nhắn KFC...',
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: KfcOpsTokens.spacingMd,
                        vertical: KfcOpsTokens.spacingSm,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: KfcOpsTokens.spacingSm),
            ShadIconButton(
              key: canStop
                  ? CustomerChatKeys.stopButton
                  : CustomerChatKeys.sendButton,
              width: 42,
              height: 42,
              backgroundColor: canStop
                  ? KfcOpsTokens.critical
                  : isSending
                  ? KfcOpsTokens.secondaryContainer
                  : KfcOpsTokens.primary,
              hoverBackgroundColor: KfcOpsTokens.primary,
              foregroundColor: KfcOpsTokens.onPrimary,
              iconSize: 18,
              enabled: !isSending || canStop,
              onPressed: () {
                if (canStop) {
                  onStop();
                } else {
                  onSend();
                }
              },
              icon: Icon(
                canStop ? LucideIcons.square : LucideIcons.send,
                color: KfcOpsTokens.onPrimary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

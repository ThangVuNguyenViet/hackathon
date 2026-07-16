import 'dart:async';

import 'package:flutter/material.dart' show CircularProgressIndicator, Divider;
import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:state_beacon/state_beacon.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme/kfc_ops_tokens.dart';
import '../customer_chat/application/mutation_beacon.dart';
import '../customer_chat/domain/customer_run_models.dart';
import '../customer_chat/presentation/genui/kfc_genui_renderer.dart';
import 'showcase_controller.dart';
import 'showcase_models.dart';

part 'showcase_layout.dart';
part 'showcase_content.dart';

const _paper = Color(0xFFF4EFE5);
const _paperRaised = Color(0xFFFFFCF6);
const _ink = Color(0xFF211D19);
const _mutedInk = Color(0xFF71685F);
const _rule = Color(0xFFD9CFC1);
const _kfcRed = Color(0xFFC8102E);

class ShowcaseScreen extends StatelessWidget {
  const ShowcaseScreen({super.key, required this.controller});

  final ShowcaseController controller;

  @override
  Widget build(BuildContext context) {
    final catalogState = controller.catalog.watch(context);
    final catalog = catalogState.lastData;
    final selectedScenario = controller.selectedScenario.watch(context);
    final selectedMode = controller.selectedMode.watch(context);
    final attempt = controller.activeAttempt.watch(context);
    final showLastComplete = controller.showLastComplete.watch(context);
    final replayState = controller.replay.watch(context);

    return DefaultTextStyle(
      style: const TextStyle(
        fontFamily: KfcOpsTokens.fontFamily,
        color: _ink,
        fontSize: 14,
        height: 1.45,
      ),
      child: ColoredBox(
        color: _paper,
        child: SafeArea(
          child: Column(
            children: [
              const _KitchenHeader(),
              Expanded(
                child: switch ((catalog, selectedScenario)) {
                  (null, _) when catalogState.isLoading =>
                    const _LoadingState(),
                  (null, _) when catalogState.isError => _LoadError(
                    onRetry: controller.catalog.reset,
                  ),
                  (final ShowcaseCatalog value, null)
                      when value.scenarios.isEmpty =>
                    const _EmptyState(),
                  (
                    final ShowcaseCatalog value,
                    final ShowcaseScenario scenario,
                  ) =>
                    _ShowcaseWorkspace(
                      catalog: value,
                      scenario: scenario,
                      mode: selectedMode,
                      attempt: attempt,
                      showLastComplete: showLastComplete,
                      replaying: replayState.isLoading,
                      onSelectScenario: controller.selectScenario,
                      onSelectMode: controller.selectMode,
                      onToggleLastComplete: controller.toggleLastComplete,
                      onReplay: () => unawaited(
                        controller.replay.run(
                          ShowcaseReplayRequest(scenario, selectedMode),
                        ),
                      ),
                    ),
                  _ => const _EmptyState(),
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

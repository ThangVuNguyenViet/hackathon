import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderFlutterGenUiScenarioData } from '../../src/genui/flutterScenarioData.js';
import {
  assertApprovedGoldenPlan,
  assertFlutterRelease,
  assertLocalFlutterRelease,
  assertProofRuntimeMatches,
  assertRuntimeBinding,
  buildPersistedBranchArtifact,
  LEGACY_GENUI_CAPTURE_PLAN_VERSION,
  LEGACY_GENUI_CAPTURE_SCENARIO_COUNT,
  LEGACY_GENUI_CAPTURE_TURN_COUNT,
  lifecycleControlRequest,
  lifecycleControlRequests,
  sha256Json,
  type ApprovedGoldenPlan,
  type BranchSessionPlan,
  type FlutterReleaseBinding,
  type PersistedTurnInput,
  type ProofRuntimeBinding,
  type SourceScenario,
} from '../../src/proof/kfcGenUiDeployedProof.js';

const counts = [6, 5, 5, 8, 5, 6, 5, 4];

function runtime(): ProofRuntimeBinding {
  return {
    deployment: {
      gitSha: 'backend-sha',
      deploymentId: 'worker-deployment-1',
      builtAt: '2026-07-14T00:00:00.000Z',
      dirty: false,
    },
    commerceEnvironment: 'sandbox',
    providerFingerprint: 'provider-hash',
    catalogObservation: {
      id: 'catalog-observation-1',
      sha256: 'catalog-hash',
      observedAt: '2026-07-14T00:00:00.000Z',
      expiresAt: null,
      itemCount: 118,
      modifierTreeCount: 56,
    },
    lifecycle: {
      provider: 'd1',
      controlsRegistered: true,
    },
    graph: {
      runtime: 'langgraph-stategraph-v1',
      checkpoint: 'configured-v1',
    },
    versions: {
      agent: {
        provider: 'google',
        model: 'gemini-3.1-flash-lite',
        profile: 'google-gemini-3.1-flash-lite-thinking-low',
      },
      toolCatalog: 'tools-v1',
      ranker: 'ranker-v1',
      ledger: '2026-07-14.2',
    },
  };
}

function flutter(): FlutterReleaseBinding {
  return {
    gitSha: 'flutter-sha',
    deploymentId: 'pages-deployment-1',
    buildId: 'flutter-build-1',
    releaseUrl: 'https://kfc-ai-chatbot.pages.dev',
    project: 'kfc-ai-chatbot',
    releaseAssetSha256: 'a'.repeat(64),
    releaseBuiltAt: '2026-07-14T00:00:00.000Z',
    dirty: false,
  };
}

function sources(): SourceScenario[] {
  return counts.map((count, scenarioIndex) => ({
    id: `0${scenarioIndex + 1}-scenario`,
    fileName: `0${scenarioIndex + 1}-scenario.json`,
    userTurns: Array.from({ length: count }, (_, turnIndex) => ({
      index: turnIndex * 2 + 1,
      text: `scenario ${scenarioIndex + 1} turn ${turnIndex + 1}`,
      useCases: [`UC-${scenarioIndex + 1}`],
    })),
  }));
}

function plan(): BranchSessionPlan {
  return {
    schemaVersion: 1,
    artifactKind: 'deployed-live-scenario-sessions',
    bindings: sources().map((source, index) => ({
      scenarioId: source.id,
      fileName: source.fileName,
      sessionId: `kfc:durable-session-${index + 1}`,
      customerId: `customer-${index + 1}`,
    })),
  };
}

function turnsBySession(planValue = plan(), sourceValue = sources()) {
  return new Map(planValue.bindings.map((binding, index) => {
    const turns = sourceValue[index]!.userTurns.flatMap((sourceTurn, turnIndex): PersistedTurnInput[] => [
      {
        id: `user-${index}-${turnIndex}`,
        sessionId: binding.sessionId,
        role: 'user',
        text: sourceTurn.text,
        externalUserId: binding.customerId,
        deliveryStatus: 'received',
        metadata: { release: runtime().deployment },
      },
      {
        id: `assistant-${index}-${turnIndex}`,
        sessionId: binding.sessionId,
        role: 'assistant',
        text: `reply ${turnIndex}`,
        deliveryStatus: 'sent',
        metadata: {
          release: runtime().deployment,
          genUi: turnIndex === 0
            ? {
                id: `attachment-${index}-${turnIndex}`,
                lifecycleStage: 'discovery',
                widgetKind: 'smartMenuPicker',
                status: 'active',
                title: 'Menu',
                data: {},
                actions: [{ id: 'add_items', label: 'Add', intent: 'primary' }],
              }
            : undefined,
        },
      },
    ]);
    return [binding.sessionId, turns];
  }));
}

describe('deployed KFC GenUI proof admission', () => {
  it('renders the counted deployed branches without replaying their model turns', () => {
    const script = readFileSync(resolve(import.meta.dirname, '../../scripts/run-live-genui-integration-proof.ts'), 'utf8');
    expect(script).toContain("readJson<BranchSessionPlan>(requiredEnv('KFC_GENUI_BRANCH_SESSIONS'))");
    expect(script).not.toContain('/chat/kfc/message');
    expect(script).toContain('/admin/lifecycle/sessions/');
    expect(script).toContain('randomUUID()');
    expect(script).toContain('LEGACY_GENUI_CAPTURE_PLAN_VERSION');
    expect(script).not.toContain('LIVE_QUALITY_EXPECTED_SCENARIO_COUNT');
  });

  it('keeps the tracked Flutter branch input byte-exact without regenerating it during proof', () => {
    const backendRoot = resolve(import.meta.dirname, '../..');
    const capturePlan = resolve(backendRoot, 'fixtures/genui-scenario-capture-plan.json');
    const scenarios = resolve(backendRoot, '../../ai-talent-tracks/fnb/conversations');
    const tracked = resolve(
      backendRoot,
      '../../apps/kfc_live_monitor_flutter/integration_test/support/generated_genui_scenario_capture_data.dart',
    );
    expect(readFileSync(tracked, 'utf8')).toBe(renderFlutterGenUiScenarioData(capturePlan, scenarios));
  });

  it('builds the exact legacy v3 8-scenario/44-turn artifact only from durable deployed sessions', async () => {
    const planValue = plan();
    const turns = turnsBySession(planValue);
    const artifact = await buildPersistedBranchArtifact({
      generatedAt: '2026-07-14T01:00:00.000Z',
      runtime: runtime(),
      flutter: flutter(),
      plan: planValue,
      sources: sources(),
      readPersistedTurns: async (sessionId) => turns.get(sessionId)!,
    });

    expect(artifact).toMatchObject({
      artifactKind: 'deployed-persisted-genui-branches',
      capturePlanVersion: LEGACY_GENUI_CAPTURE_PLAN_VERSION,
      scenarioCount: LEGACY_GENUI_CAPTURE_SCENARIO_COUNT,
      customerTurnCount: LEGACY_GENUI_CAPTURE_TURN_COUNT,
      runtime: runtime(),
      flutter: flutter(),
    });
    expect(artifact).not.toHaveProperty('canonicalModeCaseCount');
    expect(artifact.scenarios.every((scenario) => scenario.pairs.length > 0)).toBe(true);
    expect(artifact.scenarios[0]?.pairs[0]).toMatchObject({
      sourceTurnIndex: 1,
      genUiSnapshot: { widgetKind: 'smartMenuPicker' },
      actions: [{ id: 'add_items', label: 'Add', intent: 'primary' }],
    });
    const { sha256, ...scenario } = artifact.scenarios[0]!;
    expect(sha256).toBe(sha256Json(scenario));
  });

  it('rejects synthetic replay sessions, missing source turns, and incomplete release bindings', async () => {
    const synthetic = plan();
    synthetic.bindings[0]!.sessionId = 'replay_01-scenario';
    await expect(buildPersistedBranchArtifact({
      generatedAt: '2026-07-14T01:00:00.000Z',
      runtime: runtime(),
      flutter: flutter(),
      plan: synthetic,
      sources: sources(),
      readPersistedTurns: async () => [],
    })).rejects.toThrow('real durable KFC session');

    const durable = plan();
    const turns = turnsBySession(durable);
    turns.set(durable.bindings[0]!.sessionId, turns.get(durable.bindings[0]!.sessionId)!.slice(2));
    await expect(buildPersistedBranchArtifact({
      generatedAt: '2026-07-14T01:00:00.000Z',
      runtime: runtime(),
      flutter: flutter(),
      plan: durable,
      sources: sources(),
      readPersistedTurns: async (sessionId) => turns.get(sessionId)!,
    })).rejects.toThrow('not clean or complete');

    expect(() => assertRuntimeBinding({
      ...runtime(),
      graph: { ...runtime().graph, runtime: '' },
    })).toThrow('StateGraph runtime');
    expect(() => assertRuntimeBinding({
      ...runtime(),
      graph: { ...runtime().graph, runtime: 'langchain-create-agent-v1' },
    })).toThrow('StateGraph runtime');
    expect(() => assertRuntimeBinding({
      ...runtime(),
      versions: {
        ...runtime().versions,
        plannerModel: 'legacy-split-identity',
      },
    } as unknown as ProofRuntimeBinding)).toThrow('mixed or unknown version identity');
    expect(() => assertRuntimeBinding({
      ...runtime(),
      versions: {
        ...runtime().versions,
        agent: {
          ...runtime().versions.agent,
          responseModel: 'mixed-role-identity',
        },
      },
    } as unknown as ProofRuntimeBinding)).toThrow('invalid agent identity');
    expect(() => assertProofRuntimeMatches(runtime(), {
      ...runtime(),
      catalogObservation: { ...runtime().catalogObservation, sha256: 'changed' },
    })).toThrow('does not match');
    expect(() => assertFlutterRelease({ ...flutter(), buildId: '' })).toThrow('buildId');
    expect(() => assertLocalFlutterRelease({
      expected: flutter(),
      releaseAsset: {
        gitSha: 'flutter-sha',
        deploymentId: 'pages-deployment-1',
        buildId: 'flutter-build-1',
        canonicalUrl: 'https://kfc-ai-chatbot.pages.dev',
        project: 'kfc-ai-chatbot',
        releaseBuiltAt: '2026-07-14T00:00:00.000Z',
        dirty: false,
      },
      releaseAssetSha256: 'a'.repeat(64),
      gitSha: 'different-sha',
      dirty: false,
    })).toThrow('Local Flutter source');

    const deployed = {
      gitSha: 'flutter-sha',
      deploymentId: 'pages-deployment-1',
      buildId: 'flutter-build-1',
      canonicalUrl: 'https://kfc-ai-chatbot.pages.dev',
      project: 'kfc-ai-chatbot',
      releaseBuiltAt: '2026-07-14T00:00:00.000Z',
      dirty: false as const,
    };
    for (const [field, value] of [
      ['deploymentId', 'wrong-deployment'],
      ['buildId', 'wrong-build'],
      ['canonicalUrl', 'https://preview.pages.dev'],
      ['project', 'wrong-project'],
    ] as const) {
      expect(() => assertLocalFlutterRelease({
        expected: flutter(),
        releaseAsset: { ...deployed, [field]: value },
        releaseAssetSha256: 'a'.repeat(64),
        gitSha: 'flutter-sha',
        dirty: false,
      })).toThrow('does not match');
    }
  });

  it('rejects non-exact durable sequences, customer drift, unsent replies, and malformed GenUI', async () => {
    async function rejectsAfter(
      mutate: (turns: Map<string, PersistedTurnInput[]>, planValue: BranchSessionPlan) => void,
      message: string,
    ) {
      const planValue = plan();
      const turns = turnsBySession(planValue);
      mutate(turns, planValue);
      await expect(buildPersistedBranchArtifact({
        generatedAt: '2026-07-14T01:00:00.000Z',
        runtime: runtime(),
        flutter: flutter(),
        plan: planValue,
        sources: sources(),
        readPersistedTurns: async (sessionId) => turns.get(sessionId)!,
      })).rejects.toThrow(message);
    }

    await rejectsAfter((turns, planValue) => {
      turns.get(planValue.bindings[0]!.sessionId)!.splice(1, 0, {
        id: 'extra-assistant',
        sessionId: planValue.bindings[0]!.sessionId,
        role: 'assistant',
        text: 'extra',
        deliveryStatus: 'sent',
      });
    }, 'not clean or complete');

    await rejectsAfter((turns, planValue) => {
      turns.get(planValue.bindings[0]!.sessionId)![2]!.externalUserId = 'wrong-customer';
    }, 'customer binding');

    await rejectsAfter((turns, planValue) => {
      turns.get(planValue.bindings[0]!.sessionId)![1]!.deliveryStatus = 'delivered';
    }, 'not durably received and sent');

    await rejectsAfter((turns, planValue) => {
      turns.get(planValue.bindings[0]!.sessionId)![0]!.metadata!.release!.deploymentId = 'stale-worker';
    }, 'not produced by the qualified deployment');

    await rejectsAfter((turns, planValue) => {
      const snapshot = turns.get(planValue.bindings[0]!.sessionId)![1]!.metadata!.genUi!;
      snapshot.actions = [{ id: 'add_items' }, null] as unknown as Array<Record<string, unknown>>;
    }, 'invalid GenUI action schema');

    await rejectsAfter((turns, planValue) => {
      const snapshot = turns.get(planValue.bindings[0]!.sessionId)![1]!.metadata!.genUi!;
      snapshot.unexpected = true;
    }, 'invalid GenUI snapshot');
  });

  it('accepts only the exact typed golden sequence and builds one allowlisted lifecycle request', () => {
    const approved = approvedGoldenPlan();
    expect(() => assertApprovedGoldenPlan(approved)).not.toThrow();
    expect(lifecycleControlRequest(approved, approved.operations[10]!)).toEqual({
      path: '/admin/lifecycle/instances/lifecycle-1/events',
      body: {
        expectedRevision: 4,
        idempotencyKey: 'golden:advance_payment_paid:4',
        event: { type: 'payment_paid' },
      },
    });
    expect(lifecycleControlRequests(approved, approved.operations[14]!)).toEqual([
      { path: '/admin/lifecycle/instances/lifecycle-1/events', body: { expectedRevision: 6, idempotencyKey: 'golden:advance_order_delivering:6', event: { type: 'order_ready' } } },
      { path: '/admin/lifecycle/instances/lifecycle-1/events', body: { expectedRevision: 7, idempotencyKey: 'golden:advance_order_delivering:7', event: { type: 'delivery_pending', attemptId: 'golden-delivery-lifecycle-1' } } },
      { path: '/admin/lifecycle/instances/lifecycle-1/events', body: { expectedRevision: 8, idempotencyKey: 'golden:advance_order_delivering:8', event: { type: 'delivery_assigned' } } },
      { path: '/admin/lifecycle/instances/lifecycle-1/events', body: { expectedRevision: 9, idempotencyKey: 'golden:advance_order_delivering:9', event: { type: 'delivery_started' } } },
    ]);

    const arbitrary = structuredClone(approved);
    arbitrary.operations[10] = {
      operation: 'advance_payment_paid',
      expectedRevision: -1,
    };
    expect(() => assertApprovedGoldenPlan(arbitrary)).toThrow('expected revision');
    expect(() => lifecycleControlRequest(approved, approved.operations[0]!)).toThrow('not a lifecycle control');
  });
});

function approvedGoldenPlan(): ApprovedGoldenPlan {
  return {
    schemaVersion: 1,
    artifactKind: 'approved-kfc-golden-plan',
    sessionId: 'kfc:golden-1',
    customerId: 'golden-customer-1',
    lifecycleScenarioId: 'lifecycle-1',
    operations: [
      { operation: 'ask_discovery', text: 'Có combo gà cay không?' },
      {
        operation: 'add_approved_combo',
        actionId: 'add_items',
        itemCode: '20702',
        quantity: 1,
        modifierIds: [
          '41036', '41042', '41063',
          '60254:70012', '60254:70012', '60258:70443', '4:41090', '5:41090',
        ],
      },
      { operation: 'upsize_drink_1', actionId: 'customize_item:4:41091' },
      { operation: 'upsize_drink_2', actionId: 'customize_item:5:41091' },
      { operation: 'continue_fulfillment', actionId: 'continue_to_fulfillment' },
      {
        operation: 'submit_approved_address',
        actionId: 'submit_address',
        address: {
          line1: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ',
          ward: 'phường Tân Hưng',
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
      },
      { operation: 'accept_fulfillment', actionId: 'accept_fulfillment' },
      { operation: 'ask_payment_method', text: 'ZaloPay được không?' },
      { operation: 'select_zalopay', actionId: 'select_payment_method', methodId: 'zalopay_wallet' },
      { operation: 'confirm_order', actionId: 'confirm_order' },
      { operation: 'advance_payment_paid', expectedRevision: 4 },
      { operation: 'ask_payment_status', text: 'Thanh toán xong chưa?' },
      { operation: 'advance_order_preparing', expectedRevision: 5 },
      { operation: 'ask_order_status', text: 'Đơn đang làm chưa?' },
      { operation: 'advance_order_delivering', expectedRevision: 6, remainingEtaMinutes: 15 },
      { operation: 'ask_delivery_status', text: 'Bao giờ giao tới?' },
    ],
  };
}

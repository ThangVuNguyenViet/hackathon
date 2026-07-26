import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DIRECT_AGENT_MANUAL_REGRESSION_BANK,
  loadCanonicalDirectAgentScenarios,
  redactedDirectScenarioProgress,
  renderDirectAgentTranscriptMarkdown,
  resolveDirectAgentTrustedCartAction,
  runDirectAgentScenario,
  writeDirectAgentTranscriptArtifacts,
  type DirectAgentScenarioTurn,
  type DirectAgentScenario,
  type DirectAgentTurnService,
} from '../../src/evaluation/directAgentLiveScenarios.js';

const temporaryDirectories: string[] = [];
const conversationsRoot = resolve(
  process.cwd(),
  '../../ai-talent-tracks/fnb/conversations',
);

function genUiAttachment(
  widgetKind: 'smartMenuPicker' | 'cartBuilder',
  data: Record<string, unknown> = {},
  options: {
    status?: 'active' | 'answered' | 'expired' | 'blocked';
    actionIds?: string[];
  } = {},
) {
  return {
    id: `test-${widgetKind}`,
    lifecycleStage: 'menu',
    widgetKind,
    status: options.status ?? ('active' as const),
    title: 'Test widget',
    data,
    actions: (options.actionIds ?? []).map((id) => ({
      id,
      label: `Test ${id}`,
    })),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('direct Agents SDK live scenarios', () => {
  it('discovers exactly the 11 canonical conversations in stable order', async () => {
    const scenarios =
      await loadCanonicalDirectAgentScenarios(conversationsRoot);

    expect(scenarios.map(({ id }) => id)).toEqual([
      '01-dat-mon-ro-rang-giao-hang',
      '02-tu-van-combo-va-upsell',
      '03-ton-kho-dia-chi-va-cua-hang',
      '04-sau-khi-dat-don',
      '05-khieu-nai-va-human-handoff',
      '06-ngon-ngu-tu-nhien-va-an-toan',
      '07-ca-nhan-hoa-va-loyalty',
      '08-thanh-toan-loi-va-don-bat-thuong',
      '09-phuong-thuc-thanh-toan',
      '10-so-sanh-mon-va-giai-thich',
      '11-khau-vi-va-di-ung',
    ]);
    expect(scenarios).toHaveLength(11);
    expect(scenarios[0]?.turns.every(({ kind }) => kind === 'customer')).toBe(
      true,
    );
    expect(scenarios[0]?.referenceAssistantTurns.length).toBeGreaterThan(0);
  });

  it('is wired to the deployed direct service and has no StateGraph dependency', async () => {
    const [runnerSource, scriptSource, packageSource] = await Promise.all([
      readFile(
        resolve(process.cwd(), 'src/evaluation/directAgentLiveScenarios.ts'),
        'utf8',
      ),
      readFile(
        resolve(process.cwd(), 'scripts/run-direct-agent-live-scenarios.ts'),
        'utf8',
      ),
      readFile(resolve(process.cwd(), 'package.json'), 'utf8'),
    ]);

    expect(runnerSource).toContain("from '../agent/kfcDirectTurnService.js'");
    expect(scriptSource).toContain('new KfcDirectTurnService');
    expect(scriptSource).toContain('new OpenAiKfcAgent');
    expect(`${runnerSource}\n${scriptSource}`).not.toMatch(
      /StateGraph|agentStateGraph|scenarios\/runner/iu,
    );
    expect(scriptSource).toContain(
      "process.env.RUN_LIVE_DIRECT_AGENT_SCENARIOS === '1'",
    );
    expect(scriptSource).toContain('KFC_DIRECT_LIVE_SCENARIO_IDS');
    expect(scriptSource).toContain(
      'KFC_DIRECT_LIVE_COMPACTION_THRESHOLD_BYTES',
    );
    expect(packageSource).toContain('[ ! -f ../../.env ] || . ../../.env');
    expect(packageSource).toContain('"test:live:direct-agents-sdk"');
  });

  it('contains every required manual regression without quality scores or assertions', () => {
    expect(
      DIRECT_AGENT_MANUAL_REGRESSION_BANK.map(({ coverage }) => coverage),
    ).toEqual(
      expect.arrayContaining([
        'corrected-menu-search-retry',
        'combo-hop-gu-continuity',
        'standalone-drink-fallback',
        'delegated-budget-500k',
        'delegated-budget-1m',
        'delegated-cart-replacement',
        'non-spicy-and-modifier-query',
        'multi-turn-cart-preservation',
        'reward-and-voucher-execution',
        'free-form-delivery-address',
        'one-turn-checkout-progression',
        'modifier-preservation-through-checkout',
        'genui-selection-and-cart-actions',
        'sdk-compaction-continuity',
      ]),
    );
    expect(
      DIRECT_AGENT_MANUAL_REGRESSION_BANK.flatMap(({ turns }) => turns).some(
        ({ kind }) => kind === 'trusted_action',
      ),
    ).toBe(true);
    expect(JSON.stringify(DIRECT_AGENT_MANUAL_REGRESSION_BANK)).not.toMatch(
      /qualityScore|assertion/iu,
    );
  });

  it('records exact turns, calls, retry evidence, result summaries, usage, latency, GenUI, and observations', async () => {
    const scenario: DirectAgentScenario = {
      id: 'retry-evidence',
      title: 'Retry evidence',
      source: 'manual-regression',
      coverage: 'corrected-menu-search-retry',
      turns: [{ kind: 'customer', text: 'Cho mình đồ uống.' }],
      referenceAssistantTurns: [],
      observations: ['Review whether the corrected category call recovered.'],
    };
    const service = {
      run: async (input: Parameters<DirectAgentTurnService['run']>[0]) => {
        await input.lifecycle?.onCompactionEnd?.({
          status: 'success',
          latencyMs: 18,
          beforeItems: 12,
          beforeBytes: 5_120,
          afterItems: 2,
          afterBytes: 1_024,
          usage: {
            inputTokens: 120,
            outputTokens: 20,
            totalTokens: 140,
          },
        });
        return {
          responseText: 'Mình tìm thấy Pepsi.',
          toolCalls: [
            {
              name: 'searchMenu',
              arguments: { query: 'đồ uống', category: 'Thức Uống' },
              result: {
                ok: true,
                value: { mode: 'search', total: 0, items: [] },
              },
              status: 'success' as const,
              durationMs: 12,
            },
            {
              name: 'searchMenu',
              arguments: { category: 'Thức Uống' },
              result: {
                ok: true,
                value: {
                  mode: 'search',
                  total: 3,
                  items: [{ code: 'safe' }],
                },
              },
              status: 'success' as const,
              durationMs: 9,
            },
          ],
          usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
          genUi: genUiAttachment('smartMenuPicker'),
        };
      },
    };

    const artifact = await runDirectAgentScenario({
      service,
      scenario,
      clock: (() => {
        const values = [100, 145];
        return () => values.shift() ?? 145;
      })(),
    });

    expect(artifact.turns).toEqual([
      expect.objectContaining({
        user: { text: 'Cho mình đồ uống.', kind: 'customer' },
        assistant: { text: 'Mình tìm thấy Pepsi.' },
        latencyMs: 45,
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        genUiKind: 'smartMenuPicker',
        compaction: {
          status: 'success',
          latencyMs: 18,
          beforeItems: 12,
          beforeBytes: 5_120,
          afterItems: 2,
          afterBytes: 1_024,
          usage: {
            inputTokens: 120,
            outputTokens: 20,
            totalTokens: 140,
          },
        },
        observations: ['Review whether the corrected category call recovered.'],
        toolCalls: [
          expect.objectContaining({
            name: 'searchMenu',
            arguments: { query: 'đồ uống', category: 'Thức Uống' },
            attempt: 1,
            repeatedCall: false,
            result: { status: 'success', total: 0, itemCount: 0 },
          }),
          expect.objectContaining({
            name: 'searchMenu',
            arguments: { category: 'Thức Uống' },
            attempt: 2,
            repeatedCall: true,
            result: { status: 'success', total: 3, itemCount: 1 },
          }),
        ],
      }),
    ]);
  });

  it('routes trusted GenUI actions through the direct service required-tool path', async () => {
    const inputs: Parameters<DirectAgentTurnService['run']>[0][] = [];
    const trustedAction = {
      kind: 'trusted_action',
      text: 'Thêm 2 phần vào giỏ',
      selection: {
        kind: 'first_menu_item',
        quantity: 2,
        requiredActionId: 'add_items',
      },
    } satisfies Extract<DirectAgentScenarioTurn, { kind: 'trusted_action' }>;
    const cartEditAction = {
      kind: 'trusted_action',
      text: 'Giảm còn 1 phần',
      selection: {
        kind: 'selected_menu_item',
        quantity: 1,
        requiredActionId: 'update_cart',
      },
    } satisfies Extract<DirectAgentScenarioTurn, { kind: 'trusted_action' }>;
    const scenario: DirectAgentScenario = {
      id: 'trusted-action',
      title: 'Trusted action',
      source: 'manual-regression',
      coverage: 'genui-selection-and-cart-actions',
      mode: 'genui',
      turns: [
        { kind: 'customer', text: 'Gợi ý combo' },
        trustedAction,
        cartEditAction,
      ],
      referenceAssistantTurns: [],
      observations: [],
    };
    const serviceInputs: Parameters<DirectAgentTurnService['run']>[0][] = [];
    const service = {
      run: async (input: Parameters<DirectAgentTurnService['run']>[0]) => {
        inputs.push(input);
        serviceInputs.push(input);
        if (serviceInputs.length === 1) {
          return {
            responseText: 'Mời bạn chọn.',
            toolCalls: [],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            genUi: genUiAttachment(
              'smartMenuPicker',
              {
                items: [
                  {
                    code: 'fixture-dynamic-code',
                    name: 'Fixture-selected combo',
                    available: true,
                  },
                ],
              },
              { actionIds: ['add_items'] },
            ),
          };
        }
        if (serviceInputs.length === 2) {
          return {
            responseText: 'Đã thêm vào giỏ.',
            toolCalls: [],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            genUi: genUiAttachment(
              'cartBuilder',
              {
                cart: {
                  items: [{ itemCode: 'fixture-dynamic-code', quantity: 2 }],
                },
              },
              { actionIds: ['update_cart'] },
            ),
          };
        }
        return {
          responseText: 'Đã cập nhật giỏ.',
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          genUi: genUiAttachment(
            'cartBuilder',
            {
              cart: {
                items: [{ itemCode: 'fixture-dynamic-code', quantity: 1 }],
              },
            },
            { actionIds: ['update_cart'] },
          ),
        };
      },
    };

    await runDirectAgentScenario({ service, scenario });

    expect(inputs).toHaveLength(3);
    expect(inputs[1]).toMatchObject({
      metadata: {
        responseProfile: 'genui',
        customerCommand: {
          kind: 'cart_update',
          itemCode: 'fixture-dynamic-code',
          quantity: 2,
        },
      },
    });
    expect(typeof serviceInputs[1]?.prepareSession).toBe('function');
    expect(inputs[2]).toMatchObject({
      metadata: {
        responseProfile: 'genui',
        customerCommand: {
          kind: 'cart_update',
          itemCode: 'fixture-dynamic-code',
          quantity: 1,
        },
      },
    });
    expect(
      resolveDirectAgentTrustedCartAction({
        turn: trustedAction,
        latestGenUi: genUiAttachment(
          'smartMenuPicker',
          { items: [{ code: 'fixture-dynamic-code', available: true }] },
          { actionIds: ['add_items'] },
        ),
        selectedItemCode: undefined,
      }),
    ).toEqual({
      itemCode: 'fixture-dynamic-code',
      customerCommand: {
        kind: 'cart_update',
        itemCode: 'fixture-dynamic-code',
        quantity: 2,
      },
      requiredToolCalls: [
        {
          name: 'updateCart',
          arguments: {
            mode: 'patch',
            changes: [
              {
                itemCode: 'fixture-dynamic-code',
                orderedMenuItemQuantity: 2,
                modifiers: null,
              },
            ],
          },
        },
      ],
    });
    expect(JSON.stringify(scenario.turns)).not.toContain('20751');
    expect(scenario.turns[1]).toEqual({
      kind: 'trusted_action',
      text: 'Thêm 2 phần vào giỏ',
      selection: {
        kind: 'first_menu_item',
        quantity: 2,
        requiredActionId: 'add_items',
      },
    });
  });

  it('rejects a trusted action unless the immediately preceding active widget offers and contains it', () => {
    const pickerTurn = {
      kind: 'trusted_action',
      text: 'Thêm 2 phần vào giỏ',
      selection: {
        kind: 'first_menu_item',
        quantity: 2,
        requiredActionId: 'add_items',
      },
    } satisfies Extract<DirectAgentScenarioTurn, { kind: 'trusted_action' }>;
    const cartTurn = {
      kind: 'trusted_action',
      text: 'Giảm còn 1 phần',
      selection: {
        kind: 'selected_menu_item',
        quantity: 1,
        requiredActionId: 'update_cart',
      },
    } satisfies Extract<DirectAgentScenarioTurn, { kind: 'trusted_action' }>;
    const pickerData = {
      items: [{ code: 'fixture-dynamic-code', available: true }],
    };

    expect(() =>
      resolveDirectAgentTrustedCartAction({
        turn: pickerTurn,
        latestGenUi: undefined,
        selectedItemCode: undefined,
      }),
    ).toThrow(/preceding attachment/iu);
    expect(() =>
      resolveDirectAgentTrustedCartAction({
        turn: pickerTurn,
        latestGenUi: genUiAttachment('smartMenuPicker', pickerData),
        selectedItemCode: undefined,
      }),
    ).toThrow(/add_items/iu);
    expect(() =>
      resolveDirectAgentTrustedCartAction({
        turn: pickerTurn,
        latestGenUi: genUiAttachment('smartMenuPicker', pickerData, {
          status: 'expired',
          actionIds: ['add_items'],
        }),
        selectedItemCode: undefined,
      }),
    ).toThrow(/active/iu);
    expect(() =>
      resolveDirectAgentTrustedCartAction({
        turn: cartTurn,
        latestGenUi: genUiAttachment(
          'cartBuilder',
          { cart: { items: [] } },
          { actionIds: ['update_cart'] },
        ),
        selectedItemCode: 'fixture-dynamic-code',
      }),
    ).toThrow(/current cart/iu);
  });

  it('writes deterministic JSON and readable Markdown while redacting machine progress', async () => {
    const outputDirectory = await mkdtemp(
      resolve(tmpdir(), 'kfc-direct-agent-eval-'),
    );
    temporaryDirectories.push(outputDirectory);
    const artifact = {
      schemaVersion: 'kfc-direct-agent-live-transcript-v1' as const,
      runtime: 'openai-agents-sdk' as const,
      model: 'gpt-4.1-mini',
      generatedAt: '2026-07-26T00:00:00.000Z',
      scenarios: [
        {
          scenarioId: 'sensitive',
          title: 'Sensitive',
          source: 'manual-regression' as const,
          turns: [
            {
              index: 1,
              user: {
                kind: 'customer' as const,
                text: 'Giao tới 54/2 Nguyễn Hồng Đào, 0983238576',
              },
              assistant: { text: 'Mình đã ghi nhận địa chỉ.' },
              toolCalls: [
                {
                  name: 'quoteFulfillment',
                  arguments: {
                    address: '54/2 Nguyễn Hồng Đào',
                    phone: '0983238576',
                    method: 'delivery',
                  },
                  attempt: 1,
                  repeatedCall: false,
                  status: 'success' as const,
                  durationMs: 10,
                  result: { status: 'success' as const },
                },
              ],
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              latencyMs: 15,
              genUiKind: null,
              compaction: null,
              observations: [],
            },
          ],
          referenceAssistantTurns: [],
        },
      ],
    };

    const paths = await writeDirectAgentTranscriptArtifacts({
      artifact,
      outputDirectory,
    });
    const json = await readFile(paths.jsonPath, 'utf8');
    const markdown = await readFile(paths.markdownPath, 'utf8');
    const machineProgress = JSON.stringify(
      redactedDirectScenarioProgress(artifact.scenarios[0]!.turns[0]!),
    );

    expect(JSON.parse(json)).toEqual(artifact);
    expect(markdown).toBe(renderDirectAgentTranscriptMarkdown(artifact));
    expect(markdown).toContain('Giao tới 54/2 Nguyễn Hồng Đào');
    expect(markdown).toContain('quoteFulfillment');
    expect(machineProgress).not.toContain('0983238576');
    expect(machineProgress).not.toContain('Nguyễn Hồng Đào');
    expect(machineProgress).toContain('"argumentKeys"');
  });
});

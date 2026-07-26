import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { KfcDirectTurnService } from '../agent/kfcDirectTurnService.js';
import { selectKfcOpenAiGenUi } from '../agent/kfcOpenAiGenUi.js';
import type {
  OpenAiToolCallTrace,
  OpenAiUsage,
} from '../agent/openAiKfcAgent.js';
import type { CustomerCommand } from '../domain/customerCommand.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import {
  loadScenarioScript,
  type ScenarioTurn,
} from '../scenarios/scenarioScript.js';

export type DirectAgentRegressionCoverage =
  | 'corrected-menu-search-retry'
  | 'combo-hop-gu-continuity'
  | 'standalone-drink-fallback'
  | 'delegated-budget-500k'
  | 'delegated-budget-1m'
  | 'non-spicy-and-modifier-query'
  | 'multi-turn-cart-preservation'
  | 'reward-and-voucher-execution'
  | 'free-form-delivery-address'
  | 'one-turn-checkout-progression'
  | 'modifier-preservation-through-checkout'
  | 'genui-selection-and-cart-actions';

export type DirectAgentScenarioTurn =
  | {
      kind: 'customer';
      text: string;
    }
  | {
      kind: 'trusted_action';
      text: string;
      selection:
        | {
            kind: 'first_menu_item';
            quantity: number;
            requiredActionId: 'add_items';
          }
        | {
            kind: 'selected_menu_item';
            quantity: number;
            requiredActionId: 'update_cart';
          };
    };

export interface DirectAgentScenario {
  id: string;
  title: string;
  source: 'canonical' | 'manual-regression';
  coverage?: DirectAgentRegressionCoverage;
  mode?: 'text' | 'genui';
  turns: DirectAgentScenarioTurn[];
  referenceAssistantTurns: Array<{
    index: number;
    text: string;
  }>;
  observations: string[];
}

export interface DirectAgentToolResultSummary {
  status: 'success' | 'error';
  total?: number;
  itemCount?: number;
  errorCode?: string;
}

export interface DirectAgentToolCallEvidence {
  name: string;
  arguments: Record<string, unknown>;
  attempt: number;
  repeatedCall: boolean;
  status: 'success' | 'error';
  durationMs?: number;
  result: DirectAgentToolResultSummary;
}

export interface DirectAgentTurnEvidence {
  index: number;
  user: {
    kind: DirectAgentScenarioTurn['kind'];
    text: string;
  };
  assistant: {
    text: string;
  };
  toolCalls: DirectAgentToolCallEvidence[];
  usage: OpenAiUsage;
  latencyMs: number;
  genUiKind: KfcGenUiAttachment['widgetKind'] | null;
  observations: string[];
}

export interface DirectAgentScenarioEvidence {
  scenarioId: string;
  title: string;
  source: DirectAgentScenario['source'];
  coverage?: DirectAgentRegressionCoverage;
  turns: DirectAgentTurnEvidence[];
  referenceAssistantTurns: DirectAgentScenario['referenceAssistantTurns'];
}

export interface DirectAgentTranscriptArtifact {
  schemaVersion: 'kfc-direct-agent-live-transcript-v1';
  runtime: 'openai-agents-sdk';
  model: string;
  generatedAt: string;
  scenarios: DirectAgentScenarioEvidence[];
}

interface DirectTurnEvidence {
  responseText: string;
  toolCalls: OpenAiToolCallTrace[];
  usage: OpenAiUsage;
  genUi?: KfcGenUiAttachment;
}

type DirectTurnInput = Parameters<KfcDirectTurnService['run']>[0];

export interface DirectAgentTurnService {
  run(input: DirectTurnInput): Promise<DirectTurnEvidence>;
}

const canonicalScenarioCount = 11;

function customerTurn(turn: ScenarioTurn): DirectAgentScenarioTurn {
  return { kind: 'customer', text: turn.text };
}

export async function loadCanonicalDirectAgentScenarios(
  conversationsRoot: string,
): Promise<DirectAgentScenario[]> {
  const fileNames = (await readdir(conversationsRoot))
    .filter((fileName) => fileName.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));
  if (fileNames.length !== canonicalScenarioCount) {
    throw new Error(
      `Expected exactly ${canonicalScenarioCount} canonical KFC conversations, found ${fileNames.length}`,
    );
  }
  return Promise.all(
    fileNames.map(async (fileName) => {
      const script = await loadScenarioScript(
        resolve(conversationsRoot, fileName),
      );
      return {
        id: script.id,
        title: script.title,
        source: 'canonical' as const,
        mode: 'text' as const,
        turns: script.userTurns.map(customerTurn),
        referenceAssistantTurns: script.turns
          .filter(({ speaker }) => speaker === 'Bot')
          .map(({ index, text }) => ({ index, text })),
        observations: [
          'Evaluate the direct agent conversation against the customer objective and fixture limitations; the scripted assistant rows are reference-only.',
        ],
      };
    }),
  );
}

export const DIRECT_AGENT_MANUAL_REGRESSION_BANK: DirectAgentScenario[] = [
  {
    id: 'regression-menu-search-retry',
    title: 'Corrected menu-search parameters after an empty result',
    source: 'manual-regression',
    coverage: 'corrected-menu-search-retry',
    turns: [
      { kind: 'customer', text: 'Cho mình xem menu có gì?' },
      {
        kind: 'customer',
        text: 'Mình muốn chọn một món đồ uống riêng trong menu.',
      },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Inspect whether an empty overly constrained search is followed by a materially broader category-only call in the same turn.',
    ],
  },
  {
    id: 'regression-combo-hop-gu-continuity',
    title: 'Combo Hợp Gu continuity',
    source: 'manual-regression',
    coverage: 'combo-hop-gu-continuity',
    turns: [
      { kind: 'customer', text: 'Menu có gì?' },
      {
        kind: 'customer',
        text: 'Gợi ý cho tôi món nào không cay đi.',
      },
      {
        kind: 'customer',
        text: 'Tôi thích Combo Hợp Gu 99K. Cho tôi thêm phần nước nữa nhé.',
      },
      { kind: 'customer', text: '7Up vừa.' },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Verify that the selected combo remains the same verified product and is not silently substituted after later modifier or drink turns.',
    ],
  },
  {
    id: 'regression-standalone-drink-fallback',
    title: 'Standalone drink fallback',
    source: 'manual-regression',
    coverage: 'standalone-drink-fallback',
    turns: [
      {
        kind: 'customer',
        text: 'Thêm cho mình một combo gà không kèm nước.',
      },
      {
        kind: 'customer',
        text: 'Chọn giúp mình một món đồ uống riêng trong menu để thêm vào giỏ.',
      },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Verify that the agent prefers a combo-contained drink when possible, then searches the standalone beverage category instead of rejecting the request.',
    ],
  },
  {
    id: 'regression-delegated-budget-500k',
    title: 'Delegated 500k budget',
    source: 'manual-regression',
    coverage: 'delegated-budget-500k',
    turns: [
      {
        kind: 'customer',
        text: 'Bạn tự chọn món cho nhóm mình, tổng ngân sách tối đa 500.000đ, có gà rán và nước.',
      },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Evaluate whether the agent independently selects and executes a complete verified cart within the delegated maximum.',
    ],
  },
  {
    id: 'regression-delegated-budget-1m',
    title: 'Delegated one-million-VND budget',
    source: 'manual-regression',
    coverage: 'delegated-budget-1m',
    turns: [
      {
        kind: 'customer',
        text: 'Tự chọn đủ đồ ăn và nước cho một nhóm đông người, ngân sách tối đa 1.000.000đ.',
      },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Evaluate whether the model plans quantities itself, respects the budget ceiling, and reports the verified cart.',
    ],
  },
  {
    id: 'regression-non-spicy-modifiers',
    title: 'Non-spicy and modifier queries',
    source: 'manual-regression',
    coverage: 'non-spicy-and-modifier-query',
    turns: [
      {
        kind: 'customer',
        text: 'Gợi ý cho mình món gà không cay và không thêm phô mai.',
      },
      {
        kind: 'customer',
        text: 'Kiểm tra tùy chọn của món phù hợp nhất rồi chọn đúng giúp mình.',
      },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Inspect whether product search and modifier evidence are queried separately and the verified modifier selection is preserved.',
    ],
  },
  {
    id: 'regression-cart-preservation',
    title: 'Multi-turn cart preservation',
    source: 'manual-regression',
    coverage: 'multi-turn-cart-preservation',
    turns: [
      { kind: 'customer', text: 'Thêm một combo gà cho mình.' },
      { kind: 'customer', text: 'Cho mình xem các ưu đãi hiện có.' },
      { kind: 'customer', text: 'Giỏ hàng của mình hiện có gì?' },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Confirm that an unrelated read-only turn does not clear or reconstruct the verified cart.',
    ],
  },
  {
    id: 'regression-reward-voucher',
    title: 'Reward and voucher execution',
    source: 'manual-regression',
    coverage: 'reward-and-voucher-execution',
    turns: [
      {
        kind: 'customer',
        text: 'Cho mình xem điểm, phần thưởng có thể đổi và voucher trong ví.',
      },
      {
        kind: 'customer',
        text: 'Mình xác nhận đổi Mã Giảm 10k và dùng Ưu Đãi Chào Bạn Mới.',
      },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Verify that fixture-backed reward and voucher mutations execute with exact eligible identifiers and remain reflected in state.',
    ],
  },
  {
    id: 'regression-free-form-address',
    title: 'Free-form delivery address',
    source: 'manual-regression',
    coverage: 'free-form-delivery-address',
    turns: [
      {
        kind: 'customer',
        text: 'Giao đến 54/2 Nguyễn Hồng Đào, phường 14, quận Tân Bình, TP.HCM.',
      },
      { kind: 'customer', text: 'Số điện thoại nhận hàng là 0900000000.' },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Treat the free-form fixture address as acceptable and ask naturally only for genuinely missing checkout information.',
    ],
  },
  {
    id: 'regression-one-turn-checkout',
    title: 'One-turn combo, fulfillment, and checkout progression',
    source: 'manual-regression',
    coverage: 'one-turn-checkout-progression',
    turns: [
      {
        kind: 'customer',
        text: 'Cho tôi 1 combo gà giòn, giao về 54/2 Nguyễn Hồng Đào, phường 14, quận Tân Bình, TP.HCM, số điện thoại 0900000000.',
      },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Evaluate whether the SDK loop completes every safe reversible step in one turn and reaches the final explicit-confirmation step.',
    ],
  },
  {
    id: 'regression-modifier-checkout',
    title: 'Explicit modifier preservation through checkout',
    source: 'manual-regression',
    coverage: 'modifier-preservation-through-checkout',
    turns: [
      {
        kind: 'customer',
        text: 'Thêm một combo có gà giòn không cay và giữ đúng lựa chọn đó.',
      },
      {
        kind: 'customer',
        text: 'Giao đến 54/2 Nguyễn Hồng Đào, phường 14, quận Tân Bình, TP.HCM, số điện thoại 0900000000.',
      },
      { kind: 'customer', text: 'Cho mình xem lại đơn trước khi xác nhận.' },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Inspect the verified cart and order preview to ensure the explicit modifier survives every later tool call.',
    ],
  },
  {
    id: 'regression-genui-cart-actions',
    title: 'GenUI selection and cart actions',
    source: 'manual-regression',
    coverage: 'genui-selection-and-cart-actions',
    mode: 'genui',
    turns: [
      { kind: 'customer', text: 'Gợi ý combo cho mình.' },
      {
        kind: 'trusted_action',
        text: 'Thêm 2 phần của món đầu tiên đang hiển thị vào giỏ',
        selection: {
          kind: 'first_menu_item',
          quantity: 2,
          requiredActionId: 'add_items',
        },
      },
      {
        kind: 'trusted_action',
        text: 'Giảm món vừa chọn còn 1 phần',
        selection: {
          kind: 'selected_menu_item',
          quantity: 1,
          requiredActionId: 'update_cart',
        },
      },
    ],
    referenceAssistantTurns: [],
    observations: [
      'Verify that trusted selection and cart quantity actions execute through the same SDK tool validation path and return updated GenUI.',
    ],
  },
];

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

function toolResultSummary(
  call: OpenAiToolCallTrace,
): DirectAgentToolResultSummary {
  const envelope = record(call.result);
  const value =
    envelope?.ok === true && record(envelope.value)
      ? record(envelope.value)
      : envelope?.ok === true && Array.isArray(envelope.value)
        ? envelope.value
        : envelope;
  const status =
    call.status === 'error' || envelope?.ok === false ? 'error' : 'success';
  if (Array.isArray(value)) {
    return { status, itemCount: value.length };
  }
  const items = Array.isArray(value?.items) ? value.items : undefined;
  return {
    status,
    ...(typeof value?.total === 'number' ? { total: value.total } : {}),
    ...(items ? { itemCount: items.length } : {}),
    ...(status === 'error' && typeof envelope?.errorCode === 'string'
      ? { errorCode: envelope.errorCode }
      : {}),
  };
}

function toolCallEvidence(
  calls: readonly OpenAiToolCallTrace[],
): DirectAgentToolCallEvidence[] {
  const attemptByName = new Map<string, number>();
  return calls.map((call) => {
    const attempt = (attemptByName.get(call.name) ?? 0) + 1;
    attemptByName.set(call.name, attempt);
    const result = toolResultSummary(call);
    return {
      name: call.name,
      arguments: structuredClone(call.arguments),
      attempt,
      repeatedCall: attempt > 1,
      status: result.status,
      ...(call.durationMs === undefined ? {} : { durationMs: call.durationMs }),
      result,
    };
  });
}

export function resolveDirectAgentTrustedCartAction(input: {
  turn: Extract<DirectAgentScenarioTurn, { kind: 'trusted_action' }>;
  latestGenUi: KfcGenUiAttachment | undefined;
  selectedItemCode: string | undefined;
}): {
  itemCode: string;
  customerCommand: CustomerCommand;
  requiredToolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
} {
  const attachment = input.latestGenUi;
  if (!attachment) {
    throw new Error(
      'Trusted GenUI cart action requires an immediately preceding attachment',
    );
  }
  if (attachment.status !== 'active') {
    throw new Error(
      'Trusted GenUI cart action requires an active immediately preceding attachment',
    );
  }
  const requiredWidgetKind =
    input.turn.selection.kind === 'first_menu_item'
      ? 'smartMenuPicker'
      : 'cartBuilder';
  if (attachment.widgetKind !== requiredWidgetKind) {
    throw new Error(
      `Trusted GenUI cart action requires preceding ${requiredWidgetKind}`,
    );
  }
  if (
    !attachment.actions.some(
      ({ id }) => id === input.turn.selection.requiredActionId,
    )
  ) {
    throw new Error(
      `Preceding GenUI attachment does not offer ${input.turn.selection.requiredActionId}`,
    );
  }
  let itemCode = input.selectedItemCode;
  if (input.turn.selection.kind === 'first_menu_item') {
    const items = Array.isArray(attachment.data.items)
      ? attachment.data.items
      : [];
    const firstItem = items.find(
      (item) =>
        record(item)?.available !== false &&
        typeof record(item)?.code === 'string',
    );
    const code = record(firstItem)?.code;
    itemCode = typeof code === 'string' ? code : undefined;
  } else {
    const cart = record(attachment.data.cart);
    const cartItems = Array.isArray(cart?.items) ? cart.items : [];
    const selectedItemIsCurrent = cartItems.some(
      (item) => record(item)?.itemCode === itemCode,
    );
    if (!selectedItemIsCurrent) {
      throw new Error(
        'Trusted GenUI cart action requires the selected item in the current cart widget',
      );
    }
  }
  if (!itemCode) {
    throw new Error(
      'Trusted GenUI cart action requires a selected item from the preceding attachment',
    );
  }
  const quantity = input.turn.selection.quantity;
  return {
    itemCode,
    customerCommand: { kind: 'cart_update', itemCode, quantity },
    requiredToolCalls: [
      {
        name: 'updateCart',
        arguments: {
          changes: [
            {
              itemCode,
              orderedMenuItemQuantity: quantity,
              modifiers: null,
            },
          ],
        },
      },
    ],
  };
}

export async function runDirectAgentScenario(input: {
  service: DirectAgentTurnService;
  scenario: DirectAgentScenario;
  customerId?: string;
  sessionId?: string;
  clock?: () => number;
}): Promise<DirectAgentScenarioEvidence> {
  const clock = input.clock ?? Date.now;
  const customerId = input.customerId ?? `live-eval-${input.scenario.id}`;
  const sessionId =
    input.sessionId ?? `kfc:direct-live-eval:${input.scenario.id}`;
  const turns: DirectAgentTurnEvidence[] = [];
  let latestGenUi: KfcGenUiAttachment | undefined;
  let selectedItemCode: string | undefined;
  for (const [offset, turn] of input.scenario.turns.entries()) {
    const startedAt = clock();
    const trustedAction =
      turn.kind === 'trusted_action'
        ? resolveDirectAgentTrustedCartAction({
            turn,
            latestGenUi,
            selectedItemCode,
          })
        : undefined;
    if (trustedAction) selectedItemCode = trustedAction.itemCode;
    const result = await input.service.run({
      sessionId,
      customerId,
      channel: 'kfc',
      text: turn.text,
      externalMessageId: `direct-live:${input.scenario.id}:${offset + 1}`,
      metadata: {
        responseProfile: input.scenario.mode === 'genui' ? 'genui' : 'social',
        ...(trustedAction
          ? { customerCommand: trustedAction.customerCommand }
          : {}),
      },
      ...(trustedAction
        ? {
            prepareSession: async () => ({
              requiredToolCalls: trustedAction.requiredToolCalls,
              allowModelToolCalls: false,
            }),
          }
        : {}),
      ...(input.scenario.mode === 'genui'
        ? {
            selectGenUi: (execution, session) =>
              selectKfcOpenAiGenUi({
                session,
                latestUserMessage: turn.text,
                toolCalls: execution.toolCalls,
                customerCommand: trustedAction?.customerCommand,
              }),
          }
        : {}),
    });
    turns.push({
      index: offset + 1,
      user: { kind: turn.kind, text: turn.text },
      assistant: { text: result.responseText },
      toolCalls: toolCallEvidence(result.toolCalls),
      usage: structuredClone(result.usage),
      latencyMs: Math.max(0, clock() - startedAt),
      genUiKind: result.genUi?.widgetKind ?? null,
      observations: [...input.scenario.observations],
    });
    latestGenUi = result.genUi;
  }
  return {
    scenarioId: input.scenario.id,
    title: input.scenario.title,
    source: input.scenario.source,
    ...(input.scenario.coverage ? { coverage: input.scenario.coverage } : {}),
    turns,
    referenceAssistantTurns: structuredClone(
      input.scenario.referenceAssistantTurns,
    ),
  };
}

export async function runDirectAgentScenarioCollection(input: {
  service: DirectAgentTurnService;
  scenarios: readonly DirectAgentScenario[];
  model?: string;
  generatedAt?: string;
  onTurn?: (turn: DirectAgentTurnEvidence) => Promise<void> | void;
}): Promise<DirectAgentTranscriptArtifact> {
  const scenarios: DirectAgentScenarioEvidence[] = [];
  for (const scenario of input.scenarios) {
    const evidence = await runDirectAgentScenario({
      service: input.service,
      scenario,
    });
    scenarios.push(evidence);
    for (const turn of evidence.turns) await input.onTurn?.(turn);
  }
  return {
    schemaVersion: 'kfc-direct-agent-live-transcript-v1',
    runtime: 'openai-agents-sdk',
    model: input.model ?? 'gpt-4.1-mini',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scenarios,
  };
}

function markdownJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

export function renderDirectAgentTranscriptMarkdown(
  artifact: DirectAgentTranscriptArtifact,
): string {
  const lines = [
    '# KFC Direct OpenAI Agents SDK Live Transcript',
    '',
    `- Runtime: \`${artifact.runtime}\``,
    `- Model: \`${artifact.model}\``,
    `- Generated: \`${artifact.generatedAt}\``,
    '',
  ];
  for (const scenario of artifact.scenarios) {
    lines.push(
      `## ${scenario.scenarioId} — ${scenario.title}`,
      '',
      `Source: \`${scenario.source}\`${
        scenario.coverage ? `; coverage: \`${scenario.coverage}\`` : ''
      }`,
      '',
    );
    for (const turn of scenario.turns) {
      lines.push(
        `### Turn ${turn.index}`,
        '',
        `**User (${turn.user.kind}):** ${turn.user.text}`,
        '',
        `**Assistant:** ${turn.assistant.text}`,
        '',
        `- Latency: ${turn.latencyMs} ms`,
        `- Usage: ${turn.usage.inputTokens} input / ${turn.usage.outputTokens} output / ${turn.usage.totalTokens} total tokens`,
        `- GenUI: ${turn.genUiKind ?? 'none'}`,
        '',
        '**Tool calls:**',
        '',
      );
      if (turn.toolCalls.length === 0) {
        lines.push('None.', '');
      } else {
        for (const call of turn.toolCalls) {
          lines.push(
            `- \`${call.name}\` — attempt ${call.attempt}${
              call.repeatedCall ? ' (repeated call)' : ''
            }, ${call.status}${
              call.durationMs === undefined ? '' : `, ${call.durationMs} ms`
            }`,
            '',
            markdownJson({
              arguments: call.arguments,
              result: call.result,
            }),
            '',
          );
        }
      }
      lines.push('**Codex observations:**', '');
      if (turn.observations.length === 0) {
        lines.push('Pending live review.', '');
      } else {
        for (const observation of turn.observations) {
          lines.push(`- ${observation}`);
        }
        lines.push('');
      }
    }
    if (scenario.referenceAssistantTurns.length > 0) {
      lines.push(
        '<details>',
        '<summary>Reference-only scripted assistant rows (not executed or asserted)</summary>',
        '',
      );
      for (const reference of scenario.referenceAssistantTurns) {
        lines.push(`- Script row ${reference.index}: ${reference.text}`);
      }
      lines.push('', '</details>', '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function writeDirectAgentTranscriptArtifacts(input: {
  artifact: DirectAgentTranscriptArtifact;
  outputDirectory: string;
  baseName?: string;
}): Promise<{ jsonPath: string; markdownPath: string }> {
  const baseName = input.baseName ?? 'direct-agent-live-transcript';
  const jsonPath = resolve(input.outputDirectory, `${baseName}.json`);
  const markdownPath = resolve(input.outputDirectory, `${baseName}.md`);
  await mkdir(input.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(input.artifact, null, 2)}\n`, 'utf8'),
    writeFile(
      markdownPath,
      renderDirectAgentTranscriptMarkdown(input.artifact),
      'utf8',
    ),
  ]);
  return { jsonPath, markdownPath };
}

export function redactedDirectScenarioProgress(
  turn: DirectAgentTurnEvidence,
): Record<string, unknown> {
  return {
    turn: turn.index,
    toolCalls: turn.toolCalls.map((call) => ({
      name: call.name,
      argumentKeys: Object.keys(call.arguments).sort(),
      attempt: call.attempt,
      repeatedCall: call.repeatedCall,
      status: call.status,
      result: call.result,
      ...(call.durationMs === undefined ? {} : { durationMs: call.durationMs }),
    })),
    usage: turn.usage,
    latencyMs: turn.latencyMs,
    genUiKind: turn.genUiKind,
  };
}

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KfcGenUiWidgetKind } from '../../src/genui/kfcGenUi.js';
import { OpenAIToolPlanner } from '../../src/llm/toolPlanner.js';
import { runScenario } from '../../src/scenarios/runner.js';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';

const scenariosRoot = join(process.cwd(), '../../ai-talent-tracks/fnb/conversations');
const liveRequested = process.env.RUN_LIVE_AI_GENUI === '1';
const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
const openAiModel = process.env.OPENAI_TOOL_PLANNER_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1';

interface LiveGenUiScenarioCase {
  fileName: string;
  expectedWidgetKinds: KfcGenUiWidgetKind[];
}

const liveGenUiScenarioCases: LiveGenUiScenarioCase[] = [
  {
    fileName: '01-dat-mon-ro-rang-giao-hang.json',
    expectedWidgetKinds: ['cartBuilder', 'addressFulfillmentCheck', 'orderReviewConfirm', 'paymentOrderStatus'],
  },
  {
    fileName: '02-tu-van-combo-va-upsell.json',
    expectedWidgetKinds: ['smartMenuPicker', 'cartBuilder'],
  },
  {
    fileName: '03-ton-kho-dia-chi-va-cua-hang.json',
    expectedWidgetKinds: ['smartMenuPicker', 'addressFulfillmentCheck'],
  },
  {
    fileName: '04-sau-khi-dat-don.json',
    expectedWidgetKinds: ['paymentOrderStatus'],
  },
  {
    fileName: '05-khieu-nai-va-human-handoff.json',
    expectedWidgetKinds: ['supportHandoff'],
  },
  {
    fileName: '06-ngon-ngu-tu-nhien-va-an-toan.json',
    expectedWidgetKinds: ['smartMenuPicker'],
  },
  {
    fileName: '07-ca-nhan-hoa-va-loyalty.json',
    expectedWidgetKinds: ['cartBuilder'],
  },
  {
    fileName: '08-thanh-toan-loi-va-don-bat-thuong.json',
    expectedWidgetKinds: ['paymentOrderStatus', 'supportHandoff'],
  },
];

function genUiAttachments(result: Awaited<ReturnType<typeof runScenario>>) {
  return result.transcript
    .map((turn) => turn.metadata?.genUi)
    .filter((genUi): genUi is NonNullable<typeof genUi> => Boolean(genUi));
}

if (liveRequested && !openAiApiKey) {
  describe('live OpenAI GenUI scenario replay', () => {
    it('requires OPENAI_API_KEY when RUN_LIVE_AI_GENUI=1', () => {
      throw new Error('Set OPENAI_API_KEY before running npm run test:live:genui');
    });
  });
} else {
  describe('live OpenAI GenUI scenario replay contract', () => {
    it('defines eight scenarios that cover the six-widget MVP catalog', () => {
      expect(liveGenUiScenarioCases).toHaveLength(8);
      const coveredKinds = new Set(liveGenUiScenarioCases.flatMap((scenarioCase) => scenarioCase.expectedWidgetKinds));
      expect([...coveredKinds].sort()).toEqual([
        'addressFulfillmentCheck',
        'cartBuilder',
        'orderReviewConfirm',
        'paymentOrderStatus',
        'smartMenuPicker',
        'supportHandoff',
      ]);
    });
  });

  const describeLive = liveRequested ? describe : describe.skip;

  describeLive('live OpenAI GenUI scenario replay', () => {
    it.each(liveGenUiScenarioCases)(
      '$fileName emits expected GenUI attachments with live model planning',
      async (scenarioCase) => {
        const script = await loadScenarioScript(join(scenariosRoot, scenarioCase.fileName));
        const result = await runScenario(script, {
          toolPlanner: new OpenAIToolPlanner({
            apiKey: openAiApiKey ?? '',
            model: openAiModel,
          }),
          testFulfillmentQuoteProvider: async () => ({
            ok: true,
            value: { feeVnd: 18000, etaMinutes: 25 },
            message: 'live_ai_genui_quote_fixture',
          }),
        });

        const attachments = genUiAttachments(result);
        const actualKinds = new Set(attachments.map((attachment) => attachment.widgetKind));
        for (const expectedKind of scenarioCase.expectedWidgetKinds) {
          expect(
            actualKinds.has(expectedKind),
            `expected ${scenarioCase.fileName} to emit ${expectedKind}; actual: ${[...actualKinds].join(', ')}`,
          ).toBe(true);
        }

        const confirmOrderAttachments = attachments.filter((attachment) =>
          attachment.actions.some((action) => action.id === 'confirm_order'),
        );
        expect(confirmOrderAttachments.every((attachment) => attachment.widgetKind === 'orderReviewConfirm')).toBe(true);
      },
      300_000,
    );
  });
}

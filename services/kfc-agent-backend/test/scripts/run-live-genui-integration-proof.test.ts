import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ScenarioScript {
  id: string;
  useCases: string[];
  turns: Array<{
    index: number;
    speaker: 'User' | 'Bot';
    useCases?: string[];
  }>;
}

interface CapturePlan {
  scenarios: Array<{
    fileName: string;
    requiredWidgetKinds: string[];
    expectedWidgetsByUserTurn: Record<string, string>;
  }>;
}

const repoRoot = join(process.cwd(), '../..');
const scenarioRoot = join(repoRoot, 'ai-talent-tracks/fnb/conversations');
const capturePlanPath = join(process.cwd(), 'fixtures/genui-scenario-capture-plan.json');
const runnerPath = join(process.cwd(), 'scripts/run-live-genui-integration-proof.ts');
const flutterConversationTestPath = join(
  repoRoot,
  'apps/kfc_live_monitor_flutter/integration_test/customer_chat_genui_conversation_test.dart',
);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('GenUI integration screenshot capture plan', () => {
  it('covers every scripted user turn across the current backend scenario taxonomy', () => {
    expect(existsSync(capturePlanPath), `${capturePlanPath} must exist`).toBe(true);

    const plan = readJson<CapturePlan>(capturePlanPath);
    const scenarioFiles = [
      '01-dat-mon-ro-rang-giao-hang.json',
      '02-tu-van-combo-va-upsell.json',
      '03-ton-kho-dia-chi-va-cua-hang.json',
      '04-sau-khi-dat-don.json',
      '05-khieu-nai-va-human-handoff.json',
      '06-ngon-ngu-tu-nhien-va-an-toan.json',
      '07-ca-nhan-hoa-va-loyalty.json',
      '08-thanh-toan-loi-va-don-bat-thuong.json',
      '09-phuong-thuc-thanh-toan.json',
    ];

    expect(plan.scenarios.map((scenario) => scenario.fileName)).toEqual(scenarioFiles);

    let captureCount = 0;
    const coveredUseCases = new Set<string>();
    const coveredWidgets = new Set<string>();

    for (const scenarioFile of scenarioFiles) {
      const script = readJson<ScenarioScript>(join(scenarioRoot, scenarioFile));
      const planScenario = plan.scenarios.find((scenario) => scenario.fileName === scenarioFile);
      expect(planScenario, `${scenarioFile} must be in the capture plan`).toBeDefined();

      for (const useCase of script.useCases) coveredUseCases.add(useCase);

      const userTurns = script.turns.filter((turn) => turn.speaker === 'User');
      captureCount += userTurns.length;
      expect(
        Object.keys(planScenario?.expectedWidgetsByUserTurn ?? {}).every((turnIndex) => {
          return userTurns.some((turn) => String(turn.index) === turnIndex);
        }),
      ).toBe(true);

      for (const widgetKind of Object.values(planScenario?.expectedWidgetsByUserTurn ?? {})) {
        expect(typeof widgetKind).toBe('string');
      }
      for (const widgetKind of planScenario?.requiredWidgetKinds ?? []) {
        coveredWidgets.add(widgetKind);
      }
    }

    expect(captureCount).toBe(49);
    expect([...coveredUseCases].sort()).toEqual(Array.from({ length: 39 }, (_, index) => `UC-${String(index + 1).padStart(2, '0')}`));
    expect([...coveredWidgets].sort()).toEqual([
      'addressFulfillmentCheck',
      'cartBuilder',
      'orderReviewConfirm',
      'orderTrackingStatus',
      'paymentOrderStatus',
      'smartMenuPicker',
      'supportHandoff',
    ]);
  });

  it('is consumed by the Flutter integration proof runner instead of a seven-screenshot hard-code', () => {
    const runner = readFileSync(runnerPath, 'utf8');

    expect(runner).toContain('genui-scenario-capture-plan.json');
    expect(runner).toContain('buildCustomerChatScreenshotsFromCapturePlan');
    expect(runner).toContain('const label = `turn_${String(turn.index).padStart(2, \'0\')}`');
    expect(runner).toContain('KFC_GENUI_SCENARIO_FILTER');
    expect(runner).not.toContain('const customerChatScreenshots: ExpectedScreenshot[] = [');
  });

  it('keeps Flutter integration on the live backend path instead of a static-planner fixture path', () => {
    const runner = readFileSync(runnerPath, 'utf8');

    expect(runner).toContain('OPENAI_API_KEY is required');
    expect(runner).toContain('buildServerOptionsFromEnv');
    expect(runner).toContain('liveAi: true');
    expect(runner).not.toContain('fixtureToolPlanner');
    expect(runner).not.toContain('StaticToolPlanner');
    expect(runner).not.toContain('KFC_GENUI_USE_LIVE_BACKEND');
    expect(runner).not.toContain('integration_test/live_monitor_conversation_test.dart');
  });

  it('captures and catalogs the state rendered after GenUI actions', () => {
    const runner = readFileSync(runnerPath, 'utf8');
    const flutterTest = readFileSync(flutterConversationTestPath, 'utf8');

    expect(flutterTest).toContain("'action_${actionId}_${widgetKind.wireName}'");
    expect(flutterTest).toContain('KFC_GENUI_ACTION_SCREENSHOT=');
    expect(flutterTest).toContain('CustomerChatKeys.genUi(widgetKind)');
    expect(flutterTest).toContain('tester.ensureVisible(latestCard)');
    expect(flutterTest).toContain('timeout: const Timeout(Duration(minutes: 10))');
    expect(runner).toContain('discoverActionScreenshots');
    expect(runner).toContain("captureType: 'genuiAction'");
  });
});

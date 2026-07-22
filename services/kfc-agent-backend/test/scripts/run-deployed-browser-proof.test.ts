import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('deployed browser proof', () => {
  it('resolves deployed browser scenarios from the repository root', () => {
    const runner = readFileSync(
      join(process.cwd(), 'scripts/run-deployed-browser-proof.ts'),
      'utf8',
    );

    expect(runner).toContain('const root = resolve(here, "../../..");');
    expect(runner).toContain('createKfcMessageRouteCapture');
    expect(runner).toContain('const chatbotMessageEndpoint = new URL("/chat/kfc/message", chatbotUrl);');
    expect(runner).toContain('url.origin === chatbotMessageEndpoint.origin');
    expect(runner).toContain('url.pathname === chatbotMessageEndpoint.pathname');
    expect(runner).toContain(
      'const scenariosRoot = join(root, "ai-talent-tracks/fnb/conversations");',
    );
    expect(runner).toContain(
      'page.locator(\'input[aria-label="Nhắn KFC..."]\').last()',
    );
    expect(runner).toContain('isExactKfcMessageEndpoint(candidate.url(), chatbotUrl)');
    expect(runner).toContain(
      'isExactKfcMessageEndpoint(candidate.request().url(), chatbotUrl)',
    );
    expect(runner).not.toContain('globalObject.fetch = async');
    expect(runner).not.toContain('const originalFetch = globalObject.fetch.bind(globalObject);');
  });

  it('uses a shared live-safe timeout for route capture and submit waits', () => {
    const runner = readFileSync(
      join(process.cwd(), 'scripts/run-deployed-browser-proof.ts'),
      'utf8',
    );

    expect(runner).toContain('const liveTurnTimeoutMs = resolveDeployedBrowserProofLiveTimeoutMs();');
    expect(runner).toContain("createKfcMessageRouteCapture(chatbotUrl, {");
    expect(runner).toContain("routeFetchTimeoutMs: liveTurnTimeoutMs");
    expect(runner).toContain("adminToken: demoAdminToken");
    expect(runner).toContain("mockedUpstreamApi");
    expect(runner).toContain('submitResponseTimeoutMs: liveTurnTimeoutMs');
    expect(runner).toContain('input.waitFor({ state: "attached", timeout: liveTurnTimeoutMs })');
    expect(runner).toContain('document.querySelector(\'input[aria-label="Nhắn KFC..."]\')');
    expect(runner).toContain('document.querySelector("flt-semantics-placeholder")');
    expect(runner).toContain('(placeholder as HTMLElement).click()');
    expect(runner).toContain('{ timeout: liveTurnTimeoutMs }');
    expect(runner).not.toContain('input.waitFor({ state: "attached", timeout: 30_000 })');
    expect(runner).not.toContain('{ timeout: 10_000 }');
    expect(runner).toContain(
      'page.goto(chatbotUrl, { waitUntil: "domcontentloaded", timeout: liveTurnTimeoutMs })',
    );
    expect(runner).not.toContain('page.goto(chatbotUrl, { waitUntil: "networkidle" })');
    expect(runner).toContain('const releaseProbeAttempts = 6');
    expect(runner).toContain('await delay(5_000)');
    expect(runner).toContain('function delay(milliseconds: number): Promise<void>');
    expect(runner).not.toContain('const delay =');
    expect(runner).not.toContain('{ timeout: 45_000 }');
  });

  it('writes judge-ready redacted evidence for every deployed scenario', () => {
    const runner = readFileSync(
      join(process.cwd(), 'scripts/run-deployed-browser-proof.ts'),
      'utf8',
    );

    expect(runner).toContain('outcome-evidence.json');
    expect(runner).toContain('useCases: script.useCases');
    expect(runner).toContain('expectations: input.script.expectations');
    expect(runner).toContain('durableTurnCount');
    expect(runner).toContain('monitorEvents');
    expect(runner).toContain('toolTrace');
    expect(runner).toContain('genUiAttachments');
    expect(runner).toContain('redact');
    expect(runner).toContain('scripts.length !== 9');
    expect(runner.indexOf('const sensitiveKeyPattern')).toBeLessThan(
      runner.indexOf('await Promise.all'),
    );
  });

  it('marks the intended shrimp-burger fixture unavailable in scenario 03', () => {
    const runner = readFileSync(
      join(process.cwd(), 'scripts/run-deployed-browser-proof.ts'),
      'utf8',
    );

    expect(runner).toContain(
      'if (turnIndex === 1) return { unavailableItemCodes: ["41140"] };',
    );
  });

  it('runs the consolidated live qualification suites without the retired outcome-judgment path', () => {
    const acceptance = readFileSync(
      join(process.cwd(), '../../scripts/run-kfc-deployed-acceptance.sh'),
      'utf8',
    );

    expect(acceptance).toContain(
      'npm run test:live:qualification:text',
    );
    expect(acceptance).toContain('npm run test:live:genui:integration');
    expect(acceptance).toContain('npm run proof:live:messenger');
    expect(acceptance).toContain('npm run proof:production:latency');
    expect(acceptance).not.toContain('run-outcome-judgments.ts');
    expect(acceptance).not.toContain('validate-outcome-judgments.ts');
    expect(acceptance).not.toContain('KFC_OUTCOME_JUDGE_ENV_FILE');
    expect(acceptance).not.toContain('KFC_GENUI_SCENARIO_FILTER');
    expect(acceptance).not.toContain('test:live:small-talk-router');
    expect(acceptance).not.toContain('test:live:direct-catalog');
    expect(acceptance).not.toContain('npm run test:live:genui\n');
  });
});

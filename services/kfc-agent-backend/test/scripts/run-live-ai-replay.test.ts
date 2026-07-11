import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('live AI replay KFC ingress', () => {
  it('uses a first-party KFC session and idempotent message identities', () => {
    const runner = readFileSync(
      join(process.cwd(), 'scripts/run-live-ai-replay.ts'),
      'utf8',
    );

    expect(runner).toContain("url: '/chat/kfc/message'");
    expect(runner).toContain('const sessionId = `kfc:live_replay_');
    expect(runner).toContain('clientMessageId: `live_replay_${script.id}_${turn.index}`');
    expect(runner).not.toContain('channel: script.channel,\n        text: turn.text');
  });

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
    expect(runner).toContain(
      'createKfcMessageRouteCapture(chatbotUrl, { routeFetchTimeoutMs: liveTurnTimeoutMs })',
    );
    expect(runner).toContain('submitResponseTimeoutMs: liveTurnTimeoutMs');
    expect(runner).toContain('input.waitFor({ state: "attached", timeout: liveTurnTimeoutMs })');
    expect(runner).toContain('const placeholder = page.locator("flt-semantics-placeholder")');
    expect(runner).toContain('placeholder.waitFor({ state: "attached", timeout: liveTurnTimeoutMs })');
    expect(runner).toContain('placeholder.evaluate((element) => (element as HTMLElement).click())');
    expect(runner).toContain('{ timeout: liveTurnTimeoutMs }');
    expect(runner).not.toContain('input.waitFor({ state: "attached", timeout: 30_000 })');
    expect(runner).toContain(
      'page.goto(chatbotUrl, { waitUntil: "domcontentloaded", timeout: liveTurnTimeoutMs })',
    );
    expect(runner).not.toContain('page.goto(chatbotUrl, { waitUntil: "networkidle" })');
    expect(runner).toContain('const releaseProbeAttempts = 6');
    expect(runner).toContain('await delay(5_000)');
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

  it('keeps outcome judgment execution opt-in to the live acceptance path', () => {
    const acceptance = readFileSync(
      join(process.cwd(), '../../scripts/run-kfc-deployed-acceptance.sh'),
      'utf8',
    );

    expect(acceptance).not.toContain('. "$ROOT_DIR/.env"');
    expect(acceptance).toContain('KFC_OUTCOME_JUDGE_ENV_FILE');
    expect(acceptance).toContain('resolve-outcome-judge-env-file.ts');
    expect(acceptance).toContain('outcome_judge_env_args=()');
    expect(acceptance).toContain('run-outcome-judgments.ts');
    expect(acceptance).toContain('--evidence "$OUTPUT_DIR/browser/outcome-evidence.json"');
    expect(acceptance).toContain('--release-metadata "$OUTPUT_DIR/release.json"');
    expect(acceptance).toContain('$BACKEND_DIR/scripts/validate-outcome-judgments.ts');
  });
});

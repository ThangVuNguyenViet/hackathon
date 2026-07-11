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
    expect(runner).toContain(
      'const scenariosRoot = join(root, "ai-talent-tracks/fnb/conversations");',
    );
    expect(runner).toContain(
      'page.locator(\'input[aria-label="Nhắn KFC..."]\').last()',
    );
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
  });

  it('keeps outcome judgment execution opt-in to the live acceptance path', () => {
    const acceptance = readFileSync(
      join(process.cwd(), '../../scripts/run-kfc-deployed-acceptance.sh'),
      'utf8',
    );

    expect(acceptance).toContain('[ ! -f "$ROOT_DIR/.env" ] || . "$ROOT_DIR/.env"');
    expect(acceptance).toContain('run-outcome-judgments.ts');
    expect(acceptance).toContain('--evidence "$OUTPUT_DIR/browser/outcome-evidence.json"');
    expect(acceptance).toContain('--release-metadata "$OUTPUT_DIR/release.json"');
    expect(acceptance).toContain('Outcome judgments must contain exactly nine passing judgments');
  });
});

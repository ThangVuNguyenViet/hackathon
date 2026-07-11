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
});

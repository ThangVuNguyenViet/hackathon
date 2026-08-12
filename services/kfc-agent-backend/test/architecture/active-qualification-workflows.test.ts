import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = join(import.meta.dirname, '../../../..');

describe('active qualification workflows', () => {
  it('keeps deterministic PR gates without dispatching retired runtime commands', () => {
    const workflow = readFileSync(
      join(repositoryRoot, '.github/workflows/kfc-genui.yml'),
      'utf8',
    );

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('backend:');
    expect(workflow).toContain('flutter:');
    expect(workflow).toContain('TINYFISH_API_KEY:');
    expect(workflow).toContain('RUN_LIVE_TINYFISH: "1"');
    expect(workflow).toContain('npm run test:live:tinyfish');
    expect(workflow).not.toMatch(
      /test:live:qualification:text|test:live:interruption|StateGraph|OPENAI_API_KEY|KFC_AGENT_PROVIDER/u,
    );
  });

  it('does not schedule an orphan OpenAI geographic probe', () => {
    expect(() =>
      readFileSync(
        join(repositoryRoot, '.github/workflows/openai-geo-canary.yml'),
        'utf8',
      ),
    ).toThrow();
  });
});

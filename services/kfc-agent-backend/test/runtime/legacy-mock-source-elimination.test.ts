import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');
const protectedTests = new Set([
  'services/kfc-agent-backend/test/api/chat.test.ts',
  'services/kfc-agent-backend/test/worker/worker.test.ts',
  'services/kfc-agent-backend/test/genui/kfc-genui-action.test.ts',
]);

const retiredLiterals = [
  ['web', 'mock'].join('_'),
  ['web', 'kfc-customer'].join(':'),
  ['', 'chat', 'mock'].join('/'),
  ['', 'chat', 'genui-action'].join('/'),
];

function isOwnedPath(file: string): boolean {
  if (protectedTests.has(file)) return false;
  return (
    file === 'CONTEXT.md' ||
    file === 'services/kfc-agent-backend/README.md' ||
    file.startsWith('docs/') ||
    file.startsWith('ai-talent-tracks/fnb/conversations/') ||
    file.startsWith('services/kfc-agent-backend/src/evaluation/') ||
    file === 'services/kfc-agent-backend/src/scenarios/scenarioScript.ts' ||
    file.startsWith('services/kfc-agent-backend/test/')
  );
}

describe('legacy mock source elimination', () => {
  it('keeps retired source, session, and route literals out of owned tracked files', () => {
    const trackedFiles = execFileSync('git', ['ls-files'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(isOwnedPath)
      .filter((file) => existsSync(resolve(repositoryRoot, file)));

    const violations = trackedFiles.flatMap((file) => {
      const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
      return retiredLiterals.flatMap((literal) =>
        text.includes(literal) ? [`${file}: ${literal}`] : [],
      );
    });

    expect(violations).toEqual([]);
  });
});

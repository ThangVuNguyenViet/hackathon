import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arenaCandidate, arenaCandidates } from '../../src/evaluation/modelArena.js';

const repositoryRoot = resolve(process.cwd(), '../..');
const executableRoots = [
  'services/kfc-agent-backend/src',
  'services/kfc-agent-backend/scripts',
];
const executableFiles = [
  'services/kfc-agent-backend/package.json',
];
const forbiddenFullModel = /gpt-4\.1(?!-(?:mini|nano))/;

function filesUnder(relativePath: string): string[] {
  const absolutePath = resolve(repositoryRoot, relativePath);
  if (!statSync(absolutePath).isDirectory()) return [relativePath];
  return readdirSync(absolutePath).flatMap((entry) => filesUnder(join(relativePath, entry)));
}

describe('OpenAI model cost guard', () => {
  it('keeps full GPT-4.1 out of owned runtime, proof scripts, and package defaults', () => {
    const violations = [...executableRoots, ...executableFiles]
      .flatMap(filesUnder)
      .filter((file) => /\.(?:ts|js|mjs|cjs|sh|json|ya?ml)$/.test(file) || file.endsWith('.env.example'))
      .filter((file) => forbiddenFullModel.test(readFileSync(resolve(repositoryRoot, file), 'utf8')));

    expect(violations).toEqual([]);
  });

  it('does not expose full GPT-4.1 as an arena candidate', () => {
    expect(arenaCandidates.map(({ id }) => id)).not.toContain('openai-gpt-4.1');
    expect(() => arenaCandidate('openai-gpt-4.1')).toThrow('Unknown arena candidate');
  });
});

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const forbiddenProductionRuntime = [
  ['local OpenAI Agents runtime', /@kfc\/openai-agents-runtime/u],
  ['OpenAI Agents SDK', /@openai\/agents(?:[-/]|['"])/u],
  [
    'direct OpenAI SDK import',
    /(?:from\s+|import\s*\(|require\s*\()\s*['"]openai['"]/u,
  ],
  ['direct OpenAI SDK dependency', /^[ \t]*["']openai["']\s*:/mu],
  ['direct LangGraph dependency', /@langchain\/langgraph(?:-checkpoint)?/u],
  ['legacy OpenAI Responses executor', /OpenAiResponsesExecutor/u],
  ['application-authored StateGraph runtime', /\bStateGraph\b/u],
  ['legacy runtime selector', /KFC_AGENT_RUNTIME/u],
  ['legacy runtime name', /openai-responses/u],
] as const;

const skippedDirectories = new Set([
  '.git',
  '.superpowers',
  '.wrangler',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'docs',
  'fixtures',
  'migrations',
  'node_modules',
  'reports',
  'test',
]);

const executableExtensions = new Set([
  '.cjs',
  '.js',
  '.json',
  '.mjs',
  '.toml',
  '.ts',
]);

async function executableSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        files.push(...(await executableSourceFiles(path)));
      }
      continue;
    }
    if (
      entry.isFile() &&
      entry.name !== 'package-lock.json' &&
      executableExtensions.has(extname(entry.name))
    ) {
      files.push(path);
    }
  }
  return files;
}

describe('LangChain-only production runtime', () => {
  it('contains no executable legacy SDK, LangGraph, or dual-runtime dependency', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const sources = await Promise.all(
      (await executableSourceFiles(root)).map(async (path) => ({
        path,
        source: await readFile(path, 'utf8'),
      })),
    );

    const violations = sources.flatMap(({ path, source }) =>
      forbiddenProductionRuntime.flatMap(([artifact, pattern]) =>
        pattern.test(source) ? [`${relative(root, path)}: ${artifact}`] : [],
      ),
    );

    expect(
      violations,
      `Expected no forbidden production runtime artifacts, found ${violations.length}:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});

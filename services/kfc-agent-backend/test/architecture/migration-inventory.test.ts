import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory()
        ? sourceFiles(path)
        : Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

describe('migration architecture inventory', () => {
  it('has one LangChain semantic loop and no direct StateGraph or OpenAI SDK orchestration', async () => {
    const root = resolve(process.cwd(), 'src');
    const files = await sourceFiles(root);
    const sources = await Promise.all(
      files.map(async (file) => ({
        file,
        text: await readFile(file, 'utf8'),
      })),
    );

    const createAgentOwners = sources.filter(({ text }) =>
      /\bcreateAgent\s*\(\s*\{/u.test(text),
    );
    expect(createAgentOwners.map(({ file }) => file)).toEqual([
      resolve(root, 'agent/kfcAgent.ts'),
    ]);
    expect(sources.some(({ text }) => /\bStateGraph\b/u.test(text))).toBe(false);
    expect(
      sources.some(({ text }) => /from\s+['"]openai['"]/u.test(text)),
    ).toBe(false);
  });

  it('records business-pack isolation as a Task 2 seam rather than inventing it in Task 1', async () => {
    const root = resolve(process.cwd(), 'src');
    const files = await sourceFiles(root);

    expect(
      files.some((file) => file.includes('/businessPacks/')),
      'Task 2 must replace this baseline assertion with pack-isolation contract tests',
    ).toBe(false);
  });

  it('keeps scenario surfaces read-only instead of replaying scripted turns', async () => {
    const backendRoot = process.cwd();
    const repositoryRoot = resolve(backendRoot, '../..');
    const [inventoryCli, flutterController, workerRoutes] = await Promise.all([
      readFile(resolve(backendRoot, 'scripts/export-scenario-inventory.ts'), 'utf8'),
      readFile(
        resolve(
          repositoryRoot,
          'apps/kfc_live_monitor_flutter/lib/features/showcase/showcase_controller.dart',
        ),
        'utf8',
      ),
      readFile(resolve(backendRoot, 'src/worker.ts'), 'utf8'),
    ]);

    expect(inventoryCli).not.toMatch(/runScenario|createAgentChatModel/u);
    expect(flutterController).not.toMatch(
      /scenario\.turns|startTurn|watchTurn|showcase\/results/u,
    );
    expect(workerRoutes).not.toContain('/showcase/results');
  });
});

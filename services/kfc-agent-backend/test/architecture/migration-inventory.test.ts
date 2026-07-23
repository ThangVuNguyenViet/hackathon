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
      resolve(root, 'runtime/kernel.ts'),
    ]);
    expect(sources.some(({ text }) => /\bStateGraph\b/u.test(text))).toBe(false);
    expect(
      sources.some(({ text }) =>
        /(?:from\s+|import\s*\(\s*)['"]openai(?:\/|['"])/u.test(text),
      ),
    ).toBe(false);
  });

  it('keeps the semantic kernel business, storage, and provider neutral', async () => {
    const root = resolve(process.cwd(), 'src');
    const kernel = await readFile(resolve(root, 'runtime/kernel.ts'), 'utf8');

    expect(kernel).not.toMatch(
      /kfc|ordering|persistence|StateGraph|@langchain\/openai|from\s+['"]openai['"]/iu,
    );
  });

  it('places KFC behavior behind a versioned business pack', async () => {
    const root = resolve(process.cwd(), 'src');
    const facade = await readFile(resolve(root, 'agent/kfcAgent.ts'), 'utf8');
    const pack = await readFile(
      resolve(root, 'businessPacks/kfcVietnam/kfcVietnamPack.ts'),
      'utf8',
    );

    expect(facade).not.toMatch(
      /export\s+const\s+KFC_AGENT_INSTRUCTIONS|createAgent\s*\(|createKfcTools|executeToolCall/u,
    );
    for (const ownedBehavior of [
      'KFC_AGENT_INSTRUCTIONS',
      'createKfcTools',
      'executeToolCall',
      'loadPriorVerifiedState',
      'persistCompletedTurn',
    ]) {
      expect(pack).toContain(ownedBehavior);
    }
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

  it('has no executable deterministic replay engine or per-turn fixture applicator', async () => {
    const scenarioRoot = resolve(process.cwd(), 'src/scenarios');
    const files = await sourceFiles(scenarioRoot);
    const source = (
      await Promise.all(files.map((file) => readFile(file, 'utf8')))
    ).join('\n');

    expect(source).not.toMatch(
      /runAgentTurn|runScenario|liveScenarioFixtures|mockedUpstreamApiForTurn|replay_|userTurns\.entries/u,
    );
  });
});

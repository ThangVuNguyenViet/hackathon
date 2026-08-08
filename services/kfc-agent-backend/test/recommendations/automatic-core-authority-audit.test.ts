import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const backendRoot = path.resolve(import.meta.dirname, '../..');
const repositoryRoot = path.resolve(backendRoot, '../..');
const coreRoot = path.join(backendRoot, 'src/recommendations/automatic-core');

const dispositionSchema = z.enum([
  'Adopt',
  'Redesign',
  'Delete',
  'Preserve unrelated',
  'Historical superseded',
]);
const inventorySchema = z
  .object({
    schemaVersion: z.literal('kfc-automatic-donor-disposition-v1'),
    donorCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    capture: z
      .object({
        description: z.string().min(1),
        pathCount: z.number().int(),
        roots: z.array(z.string().min(1)),
        explicitPaths: z.array(z.string().min(1)),
      })
      .strict(),
    allowedDispositions: z.array(dispositionSchema),
    entries: z.array(
      z
        .object({ path: z.string().min(1), disposition: dispositionSchema })
        .strict(),
    ),
  })
  .strict();
const packageJsonSchema = z
  .object({ scripts: z.record(z.string(), z.string()) })
  .passthrough();

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const absolutePath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(absolutePath)
        : Promise.resolve(entry.name.endsWith('.ts') ? [absolutePath] : []);
    }),
  );
  return nested.flat();
}

async function relativeImportGraph(entrypoints: readonly string[]) {
  const visited = new Set<string>();
  const pending = [...entrypoints];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)]
      .map((match) => match[1]!)
      .filter((specifier) => specifier.startsWith('.'));
    for (const specifier of imports) {
      const imported = path.resolve(
        path.dirname(file),
        specifier.replace(/\.js$/u, '.ts'),
      );
      if (!visited.has(imported)) pending.push(imported);
    }
  }
  return visited;
}

describe('automatic recommendation donor disposition coverage', () => {
  it('assigns exactly one allowed disposition to every captured donor path', async () => {
    const inventory = inventorySchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            repositoryRoot,
            'docs/kfc-automatic-recommendation-donor-dispositions.json',
          ),
          'utf8',
        ),
      ),
    );
    const paths = inventory.entries.map(({ path: donorPath }) => donorPath);

    expect(paths).toHaveLength(inventory.capture.pathCount);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([...paths].sort());
    expect(new Set(inventory.allowedDispositions)).toEqual(
      new Set(dispositionSchema.options),
    );
    expect(
      new Set(inventory.entries.map(({ disposition }) => disposition)),
    ).toEqual(new Set(dispositionSchema.options));
  });

  it('covers runtime, scripts, config, CI, docs, evidence, and cross-cutting imports at exact paths', async () => {
    const inventory = inventorySchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            repositoryRoot,
            'docs/kfc-automatic-recommendation-donor-dispositions.json',
          ),
          'utf8',
        ),
      ),
    );
    const paths = inventory.entries.map(({ path: donorPath }) => donorPath);
    const requiredExamples = [
      'services/kfc-agent-backend/src/recommendations/automatic/engine.ts',
      'services/kfc-agent-backend/scripts/compose-automatic-slates.ts',
      'services/kfc-agent-backend/.env.example',
      '.github/workflows/kfc-genui.yml',
      'docs/recommendation-engine/automatic-ranking-deep-dive.md',
      'docs/recommendation-engine/automatic-ranking-deep-dive.evidence.json',
      'services/kfc-agent-backend/src/api/routeRecommendationHandlers.ts',
      'services/kfc-agent-backend/src/persistence/d1StoreRecommendationOperations.ts',
      'services/kfc-recommendation-sanity/sanity.config.ts',
      'services/kfc-recommendation-shadow-runtime/serve.py',
    ];

    expect(paths).toEqual(expect.arrayContaining(requiredExamples));

    const donorCommitTreeStatus = spawnSync(
      'git',
      ['cat-file', '-e', `${inventory.donorCommit}^{tree}`],
      { cwd: repositoryRoot },
    ).status;
    expect(inventory.donorCommit).toMatch(/^[a-f0-9]{40}$/u);
    if (donorCommitTreeStatus !== 0) return;
    const donorPaths = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', inventory.donorCommit],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )
      .trim()
      .split('\n');
    const derivedPaths = donorPaths
      .filter((donorPath) =>
        inventory.capture.roots.some((root) => donorPath.startsWith(root)),
      )
      .concat(inventory.capture.explicitPaths)
      .sort();
    expect(new Set(derivedPaths).size).toBe(derivedPaths.length);
    expect(paths).toEqual(derivedPaths);
  });
});

describe('automatic recommendation single-authority source and config audit', () => {
  it('keeps the clean boundary free of alternate ranking, fallback, provider, and persistence authority', async () => {
    const forbiddenAuthority =
      /(merchandis|manual|shadow|fallback|popularity|random|personalize|sanity|keras|transformer|embedding|stategraph|openai|d1|@aws)/iu;
    const files = await sourceFiles(coreRoot);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, path.relative(repositoryRoot, file)).not.toMatch(
        forbiddenAuthority,
      );
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map(
        (match) => match[1],
      );
      expect(
        imports.every(
          (specifier) =>
            specifier === 'zod' ||
            specifier === 'node:crypto' ||
            specifier?.startsWith('./') ||
            specifier?.startsWith('../contracts/'),
        ),
        path.relative(repositoryRoot, file),
      ).toBe(true);
    }
  });

  it('keeps chat ranking out of the automatic recommendation graph', async () => {
    const targetEntrypoints = [path.join(coreRoot, 'index.ts')];
    const targetGraph = await relativeImportGraph(targetEntrypoints);
    const unrelatedChatAuthorityAllowlist = [
      path.join(backendRoot, 'src/ordering/recommendationRanking.ts'),
    ];
    const forbiddenAuthority =
      /(merchandis|manual|shadow|fallback|popularity|random|personalize|sanity|keras|transformer|embedding|stategraph|openai|d1|@aws)/iu;

    expect(targetGraph.size).toBeGreaterThan(1);
    for (const file of targetGraph) {
      expect(unrelatedChatAuthorityAllowlist).not.toContain(file);
      expect(
        await readFile(file, 'utf8'),
        path.relative(repositoryRoot, file),
      ).not.toMatch(forbiddenAuthority);
    }

    const rankingImporters: string[] = [];
    for (const file of await sourceFiles(path.join(backendRoot, 'src'))) {
      if (
        (await readFile(file, 'utf8')).includes(
          'ordering/recommendationRanking.js',
        )
      ) {
        rankingImporters.push(file);
      }
    }
    expect(rankingImporters).toEqual([]);
    expect(unrelatedChatAuthorityAllowlist).toEqual(
      expect.arrayContaining([
        ...rankingImporters,
        path.join(backendRoot, 'src/ordering/recommendationRanking.ts'),
      ]),
    );
  });

  it('has no parallel recommendation authority or forbidden target config', async () => {
    const recommendationDirectories = await readdir(
      path.join(backendRoot, 'src/recommendations'),
    );
    expect(recommendationDirectories.sort()).toEqual([
      'automatic-core',
      'contracts',
      'serving',
    ]);

    const workflowRoot = path.join(repositoryRoot, '.github/workflows');
    const deploymentSurfaces = [
      path.join(backendRoot, '.env.example'),
      path.join(backendRoot, 'wrangler.toml'),
      path.join(backendRoot, 'package.json'),
      ...(await readdir(workflowRoot)).map((file) =>
        path.join(workflowRoot, file),
      ),
    ];
    const configText = await Promise.all(
      deploymentSurfaces.map((file) => readFile(file, 'utf8')),
    );
    expect(configText.join('\n')).not.toMatch(
      /(SANITY_|KFC_RECOMMENDATION_|PERSONALIZE|HUGGING_FACE|SHADOW_SCORER|MERCHANDISING)/u,
    );

    const packageJson = packageJsonSchema.parse(
      JSON.parse(
        await readFile(path.join(backendRoot, 'package.json'), 'utf8'),
      ),
    );
    expect(packageJson.scripts).toMatchObject({
      'check:automatic-recommendation-authority':
        'vitest run test/recommendations/automatic-core-authority-audit.test.ts',
    });
  });
});

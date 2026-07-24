import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLiveScenarioPaths } from '../../src/config/liveScenarioPaths.js';

const originalWorkingDirectory = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  process.chdir(originalWorkingDirectory);
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('resolveLiveScenarioPaths', () => {
  it('derives stable roots from the entrypoint across working directories', async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const repoRoot = join(temporaryRoot, 'checkout');
    const serviceRoot = join(repoRoot, 'services', 'kfc-agent-backend');
    const entrypointUrl = pathToFileURL(
      join(serviceRoot, 'scripts', 'run-live-scenario.ts'),
    ).href;
    const firstWorkingDirectory = join(temporaryRoot, 'first-caller');
    const secondWorkingDirectory = join(temporaryRoot, 'second-caller');
    await Promise.all([
      mkdir(firstWorkingDirectory),
      mkdir(secondWorkingDirectory),
    ]);

    for (const workingDirectory of [
      firstWorkingDirectory,
      secondWorkingDirectory,
    ]) {
      process.chdir(workingDirectory);
      expect(resolveLiveScenarioPaths(entrypointUrl)).toEqual({
        serviceRoot,
        repoRoot,
      });
    }
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'kfc-live-paths-'));
  temporaryDirectories.push(directory);
  return directory;
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOptionalEnvFile } from '../../src/config/optionalEnvFile.js';

const originalLangSmithApiKey = process.env.LANGSMITH_API_KEY;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalLangSmithApiKey === undefined) {
    delete process.env.LANGSMITH_API_KEY;
  } else {
    process.env.LANGSMITH_API_KEY = originalLangSmithApiKey;
  }

  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('loadOptionalEnvFile', () => {
  it('keeps an explicitly empty environment value', async () => {
    const directory = await createTemporaryDirectory();
    const envPath = join(directory, '.env');
    await writeFile(envPath, 'LANGSMITH_API_KEY=file-value\\n', 'utf8');
    process.env.LANGSMITH_API_KEY = '';

    loadOptionalEnvFile(envPath);

    expect(process.env.LANGSMITH_API_KEY).toBe('');
  });

  it('ignores a missing optional file', async () => {
    const directory = await createTemporaryDirectory();

    expect(() => loadOptionalEnvFile(join(directory, '.env'))).not.toThrow();
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'kfc-live-env-'));
  temporaryDirectories.push(directory);
  return directory;
}

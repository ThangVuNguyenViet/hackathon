import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

export interface RuntimeSourceSnapshot {
  algorithm: 'sha256';
  digest: string;
  files: number;
  roots: string[];
}

export async function createRuntimeSourceSnapshot(input: {
  baseDirectory: string;
  roots: readonly string[];
}): Promise<RuntimeSourceSnapshot> {
  const baseDirectory = resolve(input.baseDirectory);
  const roots = [...input.roots].sort();
  const files = (
    await Promise.all(
      roots.map((root) =>
        collectFiles(baseDirectory, resolve(baseDirectory, root)),
      ),
    )
  )
    .flat()
    .sort((left, right) => left.localeCompare(right));
  const hash = createHash('sha256');
  for (const file of files) {
    const path = relative(baseDirectory, file).replaceAll('\\', '/');
    hash.update(path);
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return {
    algorithm: 'sha256',
    digest: hash.digest('hex'),
    files: files.length,
    roots,
  };
}

async function collectFiles(
  baseDirectory: string,
  target: string,
): Promise<string[]> {
  const targetStat = await stat(target);
  if (targetStat.isFile()) return [target];
  if (!targetStat.isDirectory()) {
    throw new Error('runtime_source_snapshot_target_invalid');
  }
  const entries = await readdir(target, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const child = resolve(target, entry.name);
        if (!child.startsWith(`${baseDirectory}/`)) {
          throw new Error('runtime_source_snapshot_target_outside_base');
        }
        if (entry.isDirectory()) return collectFiles(baseDirectory, child);
        if (entry.isFile()) return Promise.resolve([child]);
        return Promise.resolve([]);
      }),
    )
  ).flat();
}

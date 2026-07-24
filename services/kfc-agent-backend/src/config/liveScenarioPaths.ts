import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LiveScenarioPaths {
  serviceRoot: string;
  repoRoot: string;
}

export function resolveLiveScenarioPaths(
  entrypointUrl: string,
): LiveScenarioPaths {
  const serviceRoot = resolve(dirname(fileURLToPath(entrypointUrl)), '..');
  return {
    serviceRoot,
    repoRoot: resolve(serviceRoot, '../..'),
  };
}

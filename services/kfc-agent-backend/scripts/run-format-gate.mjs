import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import prettier from 'prettier';

const root = process.cwd();
const mode = process.argv[2];

if (mode !== '--check' && mode !== '--write') {
  console.error('Usage: node scripts/run-format-gate.mjs <--check|--write>');
  process.exit(2);
}

const baseline = JSON.parse(
  await readFile(path.join(root, '.prettier-legacy.json'), 'utf8'),
);
const legacyFiles = new Set(baseline.files);
const candidates = new Set([
  '.prettier-legacy.json',
  '.prettierrc.json',
  'eslint-warning-baseline.json',
  'eslint.config.mjs',
  'package-lock.json',
  'package.json',
  'tsconfig.json',
  'vitest.config.ts',
  '../../.github/workflows/kfc-genui.yml',
]);
const sourceExtensions = new Set(['.json', '.mjs', '.mts', '.ts']);

async function collectSourceFiles(directory) {
  const entries = await readdir(path.join(root, directory), {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const relativePath = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(relativePath);
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      candidates.add(relativePath);
    }
  }
}

// The frozen legacy list makes the incremental scope explicit: new files and
// files removed from the list must be formatted without rewriting old sources.
for (const directory of ['scripts', 'src', 'test']) {
  await collectSourceFiles(directory);
}

const unformatted = [];
let written = 0;
for (const relativePath of [...candidates].sort()) {
  if (legacyFiles.has(relativePath)) {
    continue;
  }

  const filePath = path.resolve(root, relativePath);
  const source = await readFile(filePath, 'utf8');
  const config = (await prettier.resolveConfig(filePath)) ?? {};
  const formatted = await prettier.format(source, {
    ...config,
    filepath: filePath,
  });

  if (source === formatted) {
    continue;
  }

  if (mode === '--write') {
    await writeFile(filePath, formatted);
    written += 1;
  } else {
    unformatted.push(relativePath);
  }
}

if (mode === '--write') {
  console.log(`Formatted ${written} maintained file(s).`);
} else if (unformatted.length > 0) {
  console.error('Maintained files are not formatted:');
  for (const relativePath of unformatted) {
    console.error(`- ${relativePath}`);
  }
  process.exit(1);
} else {
  console.log('All maintained files are formatted.');
}

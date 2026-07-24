#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const roots = [
  'services/kfc-agent-backend/src',
  'services/kfc-agent-backend/scripts',
  'apps/kfc_live_monitor_flutter/lib',
  'scripts',
];
const extensions = new Set(['.ts', '.js', '.mjs', '.dart', '.sh']);
const generatedSuffixes = ['.g.dart', '.freezed.dart'];
const limit = 900;
const baseline = JSON.parse(
  await readFile(resolve(import.meta.dirname, 'source-file-size-baseline.json'), 'utf8'),
);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    if (!extensions.has(extname(entry.name))) return [];
    if (generatedSuffixes.some((suffix) => entry.name.endsWith(suffix))) return [];
    return [path];
  }));
  return nested.flat();
}

const files = (await Promise.all(roots.map((directory) => sourceFiles(resolve(root, directory))))).flat();
const violations = [];
for (const file of files) {
  const lines = (await readFile(file, 'utf8')).split('\n').length;
  const path = relative(root, file);
  const allowedLines = Math.max(limit, baseline[path] ?? 0);
  if (lines > allowedLines) {
    violations.push(
      `${path}: ${lines} lines (allowed ${allowedLines})`,
    );
  }
}

if (violations.length > 0) {
  console.error(
    `Handwritten production files must not exceed the ${limit}-line ceiling or their recorded baseline:\n${violations.join('\n')}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Architecture size check passed (${files.length} files, ${limit}-line ceiling with no baseline growth).`,
  );
}

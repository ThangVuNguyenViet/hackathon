import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ESLint } from 'eslint';

const root = process.cwd();
const baseline = JSON.parse(
  await readFile(path.join(root, 'eslint-warning-baseline.json'), 'utf8'),
);
const eslint = new ESLint({ cwd: root });
const results = await eslint.lintFiles(['.']);
const regressions = [];
let errorCount = 0;
let warningCount = 0;

for (const result of results) {
  const relativePath = path
    .relative(root, result.filePath)
    .split(path.sep)
    .join('/');
  const actualByRule = new Map();

  errorCount += result.errorCount;
  warningCount += result.warningCount;
  for (const message of result.messages) {
    if (message.severity !== 1) {
      continue;
    }

    const ruleId = message.ruleId ?? '<unknown>';
    actualByRule.set(ruleId, (actualByRule.get(ruleId) ?? 0) + 1);
  }

  for (const [ruleId, actual] of actualByRule) {
    const allowed = baseline.warnings[relativePath]?.[ruleId] ?? 0;
    if (actual > allowed) {
      regressions.push({ actual, allowed, relativePath, ruleId });
    }
  }
}

if (errorCount > 0) {
  console.error(`ESLint reported ${errorCount} error(s).`);
  process.exit(1);
}

if (regressions.length > 0) {
  console.error('ESLint warning budget regressions:');
  for (const regression of regressions) {
    console.error(
      `- ${regression.relativePath}: ${regression.ruleId} ` +
        `${regression.actual} warning(s), budget ${regression.allowed}`,
    );
  }
  process.exit(1);
}

console.log(
  `ESLint warning budget preserved: ${warningCount} warning(s), ` +
    `${Object.keys(baseline.warnings).length} legacy file budget(s).`,
);

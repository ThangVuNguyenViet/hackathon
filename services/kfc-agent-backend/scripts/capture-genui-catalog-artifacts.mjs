import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const flutterAppDir = join(repoRoot, 'apps/kfc_live_monitor_flutter');
const goldenDir = join(flutterAppDir, 'test/goldens/customer_chat_genui');
const componentGoldenDir = join(goldenDir, 'components');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = join(repoRoot, 'artifacts/genui-live-proof', timestamp);
const screenshotDir = join(artifactDir, 'screenshots');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function copyPng(sourcePath, fileName, screenshots) {
  const targetPath = join(screenshotDir, fileName);
  copyFileSync(sourcePath, targetPath);
  screenshots.push({
    name: fileName.replace(/\.png$/, ''),
    path: targetPath,
  });
}

run('flutter', ['test', 'test/goldens/customer_chat_genui'], flutterAppDir);

mkdirSync(screenshotDir, { recursive: true });

const screenshots = [];
copyPng(join(goldenDir, 'kfc_genui_catalog.png'), 'kfc_genui_catalog.png', screenshots);

for (const fileName of readdirSync(componentGoldenDir).filter((file) => file.endsWith('.png')).sort()) {
  copyPng(join(componentGoldenDir, fileName), `components_${fileName}`, screenshots);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: goldenDir,
  screenshots,
};

const markdown = [
  '# KFC GenUI Live Proof Catalog',
  '',
  `Generated at: ${manifest.generatedAt}`,
  '',
  ...screenshots.flatMap((screenshot) => [
    `## ${screenshot.name}`,
    '',
    `![${screenshot.name}](${screenshot.path})`,
    '',
  ]),
].join('\n');

writeFileSync(join(artifactDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(artifactDir, 'catalog.md'), markdown);
writeFileSync(join(repoRoot, 'artifacts/genui-live-proof/latest-catalog.md'), markdown);
writeFileSync(join(repoRoot, 'artifacts/genui-live-proof/latest-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`GenUI screenshot catalog written to ${join(artifactDir, 'catalog.md')}`);

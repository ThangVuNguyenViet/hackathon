import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(backendRoot, '../../apps/pvcfc_chat_web');
const webDist = resolve(webRoot, 'dist');
const packagedClient = resolve(backendRoot, 'dist/client');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(args) {
  const result = spawnSync(npm, args, {
    cwd: webRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`PVCFC web command failed: npm ${args.join(' ')}`);
  }
}

runNpm(['run', 'build']);

const indexHtml = await readFile(resolve(webDist, 'index.html'), 'utf8');
if (!indexHtml.includes('<div id="root"></div>')) {
  throw new Error('PVCFC React build marker is missing');
}
const assets = await readdir(resolve(webDist, 'assets'));
if (!assets.some((name) => name.endsWith('.js'))) {
  throw new Error('PVCFC React JavaScript bundle is missing');
}

await rm(packagedClient, { force: true, recursive: true });
await mkdir(packagedClient, { recursive: true });
await cp(webDist, packagedClient, { recursive: true });

console.log(`Packaged PVCFC React client at ${packagedClient}`);

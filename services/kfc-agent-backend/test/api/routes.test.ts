import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPvcfcWebsiteHtml } from '../../src/api/routes.js';

const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(
    sandboxes
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function serviceDirectory() {
  const sandbox = await mkdtemp(join(tmpdir(), 'pvcfc-route-'));
  sandboxes.push(sandbox);
  const cwd = join(sandbox, 'services', 'kfc-agent-backend');
  await mkdir(cwd, { recursive: true });
  return { sandbox, cwd };
}

describe('PVCFC website route source', () => {
  it('prefers the compiled React application and ignores standalone legacy HTML', async () => {
    const { sandbox, cwd } = await serviceDirectory();
    const reactIndex = join(
      sandbox,
      'apps',
      'pvcfc_chat_web',
      'dist',
      'index.html',
    );
    await mkdir(dirname(reactIndex), { recursive: true });
    await writeFile(reactIndex, '<main>compiled React PVCFC</main>');
    await writeFile(
      join(sandbox, 'pvcfc_website.html'),
      '<main>obsolete standalone fallback</main>',
    );

    expect(loadPvcfcWebsiteHtml(cwd)).toBe('<main>compiled React PVCFC</main>');
  });

  it('returns only the minimal backend placeholder when no React build exists', async () => {
    const { cwd } = await serviceDirectory();

    expect(loadPvcfcWebsiteHtml(cwd)).toBe('<h1>PVCFC Backend</h1>');
  });
});

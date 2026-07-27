import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntimeSourceSnapshot } from '../../src/liveEvidence/runtimeSourceSnapshot.js';

describe('live runtime source snapshot', () => {
  it('changes when an included source file changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-snapshot-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'agent.ts'), 'export const value = 1;\n');
    await writeFile(join(root, 'package.json'), '{}\n');

    const before = await createRuntimeSourceSnapshot({
      baseDirectory: root,
      roots: ['package.json', 'src'],
    });
    await writeFile(join(root, 'src', 'agent.ts'), 'export const value = 2;\n');
    const after = await createRuntimeSourceSnapshot({
      baseDirectory: root,
      roots: ['package.json', 'src'],
    });

    expect(before.files).toBe(2);
    expect(after.files).toBe(2);
    expect(before.digest).not.toBe(after.digest);
  });
});

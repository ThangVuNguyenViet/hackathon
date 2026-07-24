import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('deferred-work boundary', () => {
  it.each([
    '../../src/businessPacks/kfcVietnam/kfcVietnamPack.ts',
    '../../src/api/routeMonitorRuntime.ts',
  ])('does not invoke a deferred task inline in %s', async (path) => {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');

    expect(source).not.toContain('else void task()');
  });

  it('does not start Messenger history synchronization inline', async () => {
    const source = await readFile(
      new URL('../../src/channels/messengerHistory.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('void this.sync(options)');
  });
});

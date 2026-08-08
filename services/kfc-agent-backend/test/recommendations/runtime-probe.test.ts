import { describe, expect, it, vi } from 'vitest';
import { createOtelRuntimeProbe } from '../../src/observability/runtimeProbe.js';

describe('automatic recommendation runtime probe telemetry', () => {
  it('emits bounded release-bound OTLP trace and metric payloads plus a structured log', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );
    const writeLog = vi.fn();
    const probe = createOtelRuntimeProbe({
      endpoint: 'http://127.0.0.1:4318',
      releaseDigest: 'a'.repeat(64),
      fetchImpl,
      writeLog,
      timeoutMs: 500,
    });
    const result = await probe.emit();
    expect(result.traceId).toMatch(/^[a-f0-9]{32}$/u);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:4318/v1/traces',
      'http://127.0.0.1:4318/v1/metrics',
    ]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(String(init?.body)).toContain('a'.repeat(64));
      expect(init?.signal).toBeDefined();
    }
    expect(writeLog).toHaveBeenCalledWith(
      expect.stringContaining('recommendation_runtime_probe'),
    );
  });

  it('fails closed when either OTLP export fails', async () => {
    const probe = createOtelRuntimeProbe({
      endpoint: 'http://127.0.0.1:4318',
      releaseDigest: 'a'.repeat(64),
      fetchImpl: vi.fn<typeof fetch>(
        async () => new Response(null, { status: 503 }),
      ),
      writeLog: vi.fn(),
    });
    await expect(probe.emit()).rejects.toThrow('OTLP export failed');
  });
});

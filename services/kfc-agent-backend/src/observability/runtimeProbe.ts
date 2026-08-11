import { randomBytes } from 'node:crypto';

export interface RuntimeProbeResult {
  traceId: string;
}

export interface RuntimeProbe {
  emit(): Promise<RuntimeProbeResult>;
}

const otelAttributes = (releaseDigest: string) => [
  { key: 'service.name', value: { stringValue: 'kfc-recommendation-main' } },
  { key: 'kfc.release.digest', value: { stringValue: releaseDigest } },
  { key: 'kfc.probe.type', value: { stringValue: 'activation' } },
];

export function createOtelRuntimeProbe({
  endpoint,
  releaseDigest,
  fetchImpl = fetch,
  writeLog = console.log,
  timeoutMs = 1_500,
  clock = () => new Date(),
}: {
  endpoint: string;
  releaseDigest: string;
  fetchImpl?: typeof fetch;
  writeLog?: (line: string) => void;
  timeoutMs?: number;
  clock?: () => Date;
}): RuntimeProbe {
  const normalizedEndpoint = endpoint.replace(/\/$/u, '');
  return {
    async emit() {
      const traceId = randomBytes(16).toString('hex');
      const spanId = randomBytes(8).toString('hex');
      const timestamp = clock();
      const timeUnixNano = `${BigInt(timestamp.getTime()) * 1_000_000n}`;
      const attributes = otelAttributes(releaseDigest);
      const requests: ReadonlyArray<[string, unknown]> = [
        [
          '/v1/traces',
          {
            resourceSpans: [
              {
                resource: { attributes },
                scopeSpans: [
                  {
                    scope: { name: 'kfc.recommendations.activation' },
                    spans: [
                      {
                        traceId,
                        spanId,
                        name: 'recommendation_runtime_probe',
                        kind: 2,
                        startTimeUnixNano: timeUnixNano,
                        endTimeUnixNano: timeUnixNano,
                        attributes,
                        status: { code: 1 },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        [
          '/v1/metrics',
          {
            resourceMetrics: [
              {
                resource: { attributes },
                scopeMetrics: [
                  {
                    scope: { name: 'kfc.recommendations.activation' },
                    metrics: [
                      {
                        name: 'kfc.recommendation.activation.probe',
                        unit: '1',
                        gauge: {
                          dataPoints: [
                            { attributes, timeUnixNano, asDouble: 1 },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      ];
      for (const [path, body] of requests) {
        const response = await fetchImpl(`${normalizedEndpoint}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok)
          throw new Error(`OTLP export failed with ${response.status}`);
      }
      writeLog(
        JSON.stringify({
          event: 'recommendation_runtime_probe',
          releaseDigest,
          traceId,
          emittedAt: timestamp.toISOString(),
        }),
      );
      return { traceId };
    },
  };
}

import http from 'node:http';
import { URL } from 'node:url';
import type {
  AutomaticRecommendationScorerPort,
  AutomaticScorerRequest,
} from '../automatic-core/index.js';

export type AutomaticScorerFailureCode =
  | 'scorer_saturated'
  | 'scorer_timeout'
  | 'scorer_unavailable'
  | 'scorer_invalid_response';

export class AutomaticScorerUnavailableError extends Error {
  readonly retryable = true;

  constructor(
    readonly code: AutomaticScorerFailureCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'AutomaticScorerUnavailableError';
  }
}

export interface PersistentAutomaticScorerClient extends AutomaticRecommendationScorerPort {
  readiness(): Promise<boolean>;
  close(): void;
}

export function createPersistentAutomaticScorerClient({
  baseUrl,
  maxConcurrency,
  timeoutMs,
  maxResponseBytes = 1_048_576,
}: {
  baseUrl: string;
  maxConcurrency: number;
  timeoutMs: number;
  maxResponseBytes?: number;
}): PersistentAutomaticScorerClient {
  const origin = new URL(baseUrl);
  if (
    origin.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1'].includes(origin.hostname)
  ) {
    throw new Error('automatic scorer must use localhost HTTP');
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error('maxConcurrency must be a positive integer');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive finite integer');
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error('maxResponseBytes must be a positive finite integer');
  }
  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: maxConcurrency,
    maxFreeSockets: maxConcurrency,
    scheduling: 'lifo',
  });
  let active = 0;

  async function call(path: string, body?: unknown): Promise<unknown> {
    if (active >= maxConcurrency) {
      throw new AutomaticScorerUnavailableError('scorer_saturated');
    }
    active += 1;
    try {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      return await new Promise((resolve, reject) => {
        const request = http.request(
          new URL(path, origin),
          {
            agent,
            method: payload === undefined ? 'GET' : 'POST',
            headers:
              payload === undefined
                ? { accept: 'application/json' }
                : {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(payload),
                  },
            timeout: timeoutMs,
          },
          (response) => {
            const chunks: Buffer[] = [];
            let responseBytes = 0;
            let rejected = false;
            response.on('data', (chunk: Buffer) => {
              responseBytes += chunk.byteLength;
              if (responseBytes > maxResponseBytes) {
                rejected = true;
                response.destroy();
                reject(
                  new AutomaticScorerUnavailableError(
                    'scorer_invalid_response',
                  ),
                );
                return;
              }
              chunks.push(chunk);
            });
            response.on('end', () => {
              if (rejected) return;
              if (response.statusCode !== 200) {
                reject(
                  new AutomaticScorerUnavailableError('scorer_unavailable'),
                );
                return;
              }
              try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
              } catch (error) {
                reject(
                  new AutomaticScorerUnavailableError(
                    'scorer_invalid_response',
                    { cause: error },
                  ),
                );
              }
            });
          },
        );
        request.on('timeout', () => {
          request.destroy(
            new AutomaticScorerUnavailableError('scorer_timeout'),
          );
        });
        request.on('error', (error) =>
          reject(
            error instanceof AutomaticScorerUnavailableError
              ? error
              : new AutomaticScorerUnavailableError('scorer_unavailable', {
                  cause: error,
                }),
          ),
        );
        request.end(payload);
      });
    } finally {
      active -= 1;
    }
  }

  return {
    score: (request: AutomaticScorerRequest) => call('/v1/score', request),
    async readiness() {
      try {
        const result = await call('/ready');
        return (
          typeof result === 'object' &&
          result !== null &&
          'ready' in result &&
          result.ready === true
        );
      } catch {
        return false;
      }
    },
    close: () => agent.destroy(),
  };
}

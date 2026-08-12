import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  PVCFC_WEB_ALLOWED_HOSTNAMES,
  PVCFC_WEB_FETCH_TIMEOUT_MS,
  PVCFC_WEB_OPERATION_TIMEOUT_MS,
} from '../src/businesses/pvcfc/webPolicy.js';
import { validateBusinessWebUrl } from '../src/web/businessWebEvidence.js';
import {
  createTinyFishClient,
  type TinyFishClient,
} from '../src/web/tinyFishClient.js';

const CANARY_SEARCH_HOSTNAME = 'www.pvcfc.com.vn';

export type TinyFishLiveCanaryResult =
  | {
      readonly status: 'skipped';
      readonly reason: 'live_tinyfish_not_enabled' | 'tinyfish_api_key_missing';
    }
  | {
      readonly status: 'passed';
      readonly searchLatencyMs: number;
      readonly fetchLatencyMs: number;
      readonly contentSha256: string;
    };

export class TinyFishLiveCanaryError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'TinyFishLiveCanaryError';
    this.code = code;
  }
}

export interface TinyFishLiveCanaryOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clientFactory?: (apiKey: string) => TinyFishClient;
  readonly nowMs?: () => number;
  readonly writeLine?: (line: string) => void;
}

function emit(
  result: TinyFishLiveCanaryResult,
  writeLine: (line: string) => void,
): TinyFishLiveCanaryResult {
  writeLine(JSON.stringify(result));
  return result;
}

export async function runTinyFishLiveCanary(
  options: TinyFishLiveCanaryOptions,
): Promise<TinyFishLiveCanaryResult> {
  const writeLine = options.writeLine ?? console.log;
  if (options.env['RUN_LIVE_TINYFISH'] !== '1') {
    return emit(
      { status: 'skipped', reason: 'live_tinyfish_not_enabled' },
      writeLine,
    );
  }

  const apiKey = options.env['TINYFISH_API_KEY']?.trim();
  if (!apiKey) {
    return emit(
      { status: 'skipped', reason: 'tinyfish_api_key_missing' },
      writeLine,
    );
  }

  const nowMs = options.nowMs ?? Date.now;
  const client =
    options.clientFactory?.(apiKey) ??
    createTinyFishClient({
      apiKey,
      timeoutMs: PVCFC_WEB_OPERATION_TIMEOUT_MS,
    });

  try {
    const searchStartedAt = nowMs();
    const results = await client.search({
      query: 'sản phẩm dịch vụ PVCFC',
      includeDomains: [CANARY_SEARCH_HOSTNAME],
      language: 'vi',
      location: 'Việt Nam',
    });
    const searchLatencyMs = Math.max(0, nowMs() - searchStartedAt);
    const sourceUrl = results[0]?.sourceUrl;
    if (!sourceUrl) {
      throw new TinyFishLiveCanaryError(
        'tinyfish_live_canary_no_search_result',
      );
    }

    const fetchStartedAt = nowMs();
    const fetched = await client.fetch({
      url: sourceUrl,
      allowedHostnames: PVCFC_WEB_ALLOWED_HOSTNAMES,
      perUrlTimeoutMs: PVCFC_WEB_FETCH_TIMEOUT_MS,
    });
    const fetchLatencyMs = Math.max(0, nowMs() - fetchStartedAt);
    validateBusinessWebUrl(fetched.finalUrl, PVCFC_WEB_ALLOWED_HOSTNAMES);

    return emit(
      {
        status: 'passed',
        searchLatencyMs,
        fetchLatencyMs,
        contentSha256: createHash('sha256')
          .update(fetched.text, 'utf8')
          .digest('hex'),
      },
      writeLine,
    );
  } catch (error) {
    if (
      error instanceof TinyFishLiveCanaryError &&
      error.code === 'tinyfish_live_canary_no_search_result'
    ) {
      throw error;
    }
    throw new TinyFishLiveCanaryError('tinyfish_live_canary_failed');
  }
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  runTinyFishLiveCanary({ env: process.env }).catch(() => {
    console.error(
      JSON.stringify({
        status: 'failed',
        reason: 'tinyfish_live_canary_failed',
      }),
    );
    process.exitCode = 1;
  });
}

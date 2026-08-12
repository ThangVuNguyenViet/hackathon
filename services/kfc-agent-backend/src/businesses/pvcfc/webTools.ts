import { tool } from 'langchain';
import { z } from 'zod';
import { validateBusinessWebUrl } from '../../web/businessWebEvidence.js';
import {
  TinyFishClientError,
  type TinyFishClient,
} from '../../web/tinyFishClient.js';
import type { PvcfcToolTrace } from './tools.js';
import {
  PVCFC_WEB_ALLOWED_HOSTNAMES,
  PVCFC_WEB_FETCH_TIMEOUT_MS,
  PVCFC_WEB_MAX_FETCH_CALLS,
  PVCFC_WEB_MAX_SEARCH_CALLS,
  PVCFC_WEB_OPERATION_TIMEOUT_MS,
  PVCFC_WEB_TURN_BUDGET_MS,
} from './webPolicy.js';

export interface PvcfcWebTurnBudget {
  searchCalls: number;
  fetchCalls: number;
  readonly startedAt: number;
  readonly now: () => number;
}

export function createPvcfcWebTurnBudget(input?: {
  readonly now?: () => number;
}): PvcfcWebTurnBudget {
  const now = input?.now ?? Date.now;
  return { searchCalls: 0, fetchCalls: 0, startedAt: now(), now };
}

function requireRemainingTime(budget: PvcfcWebTurnBudget): void {
  const elapsed = Math.max(0, budget.now() - budget.startedAt);
  if (PVCFC_WEB_TURN_BUDGET_MS - elapsed < PVCFC_WEB_OPERATION_TIMEOUT_MS) {
    throw new Error('pvcfc_web_time_budget_exhausted');
  }
}

function trace(
  receipts: PvcfcToolTrace[],
  input: Omit<PvcfcToolTrace, 'durationMs'> & { startedAt: number },
): void {
  const { startedAt, ...receipt } = input;
  receipts.push({
    ...receipt,
    ...(receipt.sourceUrls === undefined
      ? {}
      : {
          sourceUrls: receipt.sourceUrls
            .slice(0, 5)
            .map((url) => url.slice(0, 2_048)),
        }),
    durationMs: Math.max(0, Date.now() - startedAt),
  });
}

export function createPvcfcWebTools(input: {
  client: TinyFishClient;
  inventoryUrls: readonly string[];
  receipts: PvcfcToolTrace[];
  budget: PvcfcWebTurnBudget;
}) {
  const inventoriedUrls = new Set(
    input.inventoryUrls.map((url) =>
      validateBusinessWebUrl(url, PVCFC_WEB_ALLOWED_HOSTNAMES),
    ),
  );
  const currentTurnSearchUrls = new Set<string>();

  const searchPvcfcWeb = tool(
    async ({ query }) => {
      const startedAt = Date.now();
      if (input.budget.searchCalls >= PVCFC_WEB_MAX_SEARCH_CALLS) {
        trace(input.receipts, {
          name: 'searchPvcfcWeb',
          status: 'error',
          evidenceMode: 'live_web',
          startedAt,
        });
        throw new Error('pvcfc_web_search_budget_exhausted');
      }
      try {
        requireRemainingTime(input.budget);
        input.budget.searchCalls += 1;
        const results = (
          await input.client.search({
            query,
            includeDomains: PVCFC_WEB_ALLOWED_HOSTNAMES,
            language: 'vi',
            location: 'Việt Nam',
          })
        ).slice(0, 5);
        for (const result of results) {
          currentTurnSearchUrls.add(
            validateBusinessWebUrl(
              result.sourceUrl,
              PVCFC_WEB_ALLOWED_HOSTNAMES,
            ),
          );
        }
        trace(input.receipts, {
          name: 'searchPvcfcWeb',
          status: 'success',
          evidenceMode: 'live_web',
          sourceUrls: results.map(({ sourceUrl }) => sourceUrl),
          startedAt,
        });
        return results;
      } catch (error) {
        trace(input.receipts, {
          name: 'searchPvcfcWeb',
          status: 'error',
          evidenceMode: 'live_web',
          startedAt,
        });
        if (error instanceof TinyFishClientError) {
          return { available: false as const };
        }
        throw error;
      }
    },
    {
      name: 'searchPvcfcWeb',
      description:
        'Search current public information only on approved official PVCFC websites. Use after canonical PVCFC data was checked and was missing, stale, or insufficient.',
      schema: z.object({ query: z.string().trim().min(1).max(500) }).strict(),
    },
  );

  const fetchPvcfcPage = tool(
    async ({ url }) => {
      const startedAt = Date.now();
      if (input.budget.fetchCalls >= PVCFC_WEB_MAX_FETCH_CALLS) {
        trace(input.receipts, {
          name: 'fetchPvcfcPage',
          status: 'error',
          evidenceMode: 'live_web',
          startedAt,
        });
        throw new Error('pvcfc_web_fetch_budget_exhausted');
      }
      try {
        requireRemainingTime(input.budget);
        input.budget.fetchCalls += 1;
        const normalized = validateBusinessWebUrl(
          url,
          PVCFC_WEB_ALLOWED_HOSTNAMES,
        );
        if (
          !inventoriedUrls.has(normalized) &&
          !currentTurnSearchUrls.has(normalized)
        ) {
          throw new Error('pvcfc_web_url_not_admitted');
        }
        const fetched = await input.client.fetch({
          url: normalized,
          allowedHostnames: PVCFC_WEB_ALLOWED_HOSTNAMES,
          perUrlTimeoutMs: PVCFC_WEB_FETCH_TIMEOUT_MS,
        });
        const fetchedSourceUrl = validateBusinessWebUrl(
          fetched.sourceUrl,
          PVCFC_WEB_ALLOWED_HOSTNAMES,
        );
        if (fetchedSourceUrl !== normalized) {
          throw new Error('pvcfc_web_source_url_mismatch');
        }
        const finalUrl = validateBusinessWebUrl(
          fetched.finalUrl,
          PVCFC_WEB_ALLOWED_HOSTNAMES,
        );
        const result = {
          ...fetched,
          sourceUrl: fetchedSourceUrl,
          finalUrl,
          text: fetched.text.slice(0, 8_000),
        };
        trace(input.receipts, {
          name: 'fetchPvcfcPage',
          status: 'success',
          evidenceMode: 'live_web',
          sourceUrls: [...new Set([result.sourceUrl, result.finalUrl])],
          startedAt,
        });
        return result;
      } catch (error) {
        trace(input.receipts, {
          name: 'fetchPvcfcPage',
          status: 'error',
          evidenceMode: 'live_web',
          startedAt,
        });
        if (error instanceof TinyFishClientError) {
          return { available: false as const };
        }
        throw error;
      }
    },
    {
      name: 'fetchPvcfcPage',
      description:
        'Fetch one approved official PVCFC page that is already inventoried or was returned by searchPvcfcWeb in this turn.',
      schema: z.object({ url: z.string().url().max(2_048) }).strict(),
    },
  );

  return [searchPvcfcWeb, fetchPvcfcPage] as const;
}

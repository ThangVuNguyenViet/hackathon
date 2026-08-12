import { tool } from 'langchain';
import { z } from 'zod';
import { validateBusinessWebUrl } from '../../web/businessWebEvidence.js';
import type { TinyFishClient } from '../../web/tinyFishClient.js';
import {
  KFC_WEB_ALLOWED_HOSTNAMES,
  KFC_WEB_FETCH_TIMEOUT_MS,
  KFC_WEB_OPERATION_TIMEOUT_MS,
  KFC_WEB_TURN_BUDGET_MS,
} from './webPolicy.js';
import type { KfcTurnToolReceipt, KfcWebToolReceipt } from './toolReceipts.js';

export type { KfcWebToolReceipt } from './toolReceipts.js';

export type KfcWebToolName = 'searchKfcWeb' | 'fetchKfcPage';

export interface KfcWebTurnBudget {
  searchCalls: number;
  fetchCalls: number;
  evidenceSequence: number;
  readonly startedAt: number;
  readonly now: () => number;
}

export function createKfcWebTurnBudget(input?: {
  readonly now?: () => number;
}): KfcWebTurnBudget {
  const now = input?.now ?? Date.now;
  return {
    searchCalls: 0,
    fetchCalls: 0,
    evidenceSequence: 0,
    startedAt: now(),
    now,
  };
}

function requireRemainingTime(budget: KfcWebTurnBudget): void {
  const elapsed = Math.max(0, budget.now() - budget.startedAt);
  if (KFC_WEB_TURN_BUDGET_MS - elapsed < KFC_WEB_OPERATION_TIMEOUT_MS) {
    throw new Error('kfc_web_time_budget_exhausted');
  }
}

function requireAuthorized(
  name: KfcWebToolName,
  resolveAuthorizedToolNames: () => readonly string[],
): void {
  if (!resolveAuthorizedToolNames().includes(name)) {
    throw new Error('kfc_web_tool_not_authorized');
  }
}

function record(
  receipts: KfcTurnToolReceipt[],
  budget: KfcWebTurnBudget,
  input: Omit<KfcWebToolReceipt, 'durationMs'> & { readonly startedAt: number },
): void {
  const { startedAt, ...receipt } = input;
  receipts.push({
    ...receipt,
    ...(receipt.sourceUrls
      ? {
          sourceUrls: Object.freeze(
            [...new Set(receipt.sourceUrls)]
              .slice(0, 5)
              .map((url) => url.slice(0, 2_048)),
          ),
        }
      : {}),
    durationMs: Math.max(0, budget.now() - startedAt),
  });
}

function evidenceId(budget: KfcWebTurnBudget, name: KfcWebToolName): string {
  budget.evidenceSequence += 1;
  return `web:${name}:${budget.evidenceSequence}`;
}

function compactSearchResult(result: {
  readonly sourceUrl: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedDate?: string;
  readonly retrievedAt: string;
}) {
  return {
    sourceUrl: validateBusinessWebUrl(
      result.sourceUrl,
      KFC_WEB_ALLOWED_HOSTNAMES,
    ),
    title: result.title.trim().slice(0, 300),
    snippet: result.snippet.trim().slice(0, 800),
    ...(result.publishedDate
      ? { publishedDate: result.publishedDate.trim().slice(0, 64) }
      : {}),
    retrievedAt: result.retrievedAt.trim().slice(0, 64),
  };
}

export function createKfcWebTools(input: {
  readonly client: TinyFishClient;
  readonly inventoryUrls: readonly string[];
  readonly receipts: KfcTurnToolReceipt[];
  readonly budget: KfcWebTurnBudget;
  readonly resolveAuthorizedToolNames: () => readonly string[];
}) {
  const inventoryUrls = new Set(
    input.inventoryUrls.map((url) =>
      validateBusinessWebUrl(url, KFC_WEB_ALLOWED_HOSTNAMES),
    ),
  );
  const currentTurnSearchUrls = new Set<string>();

  const searchKfcWeb = tool(
    async ({ query }) => {
      const startedAt = input.budget.now();
      try {
        requireAuthorized('searchKfcWeb', input.resolveAuthorizedToolNames);
        if (input.budget.searchCalls >= 1) {
          throw new Error('kfc_web_search_budget_exhausted');
        }
        requireRemainingTime(input.budget);
        input.budget.searchCalls += 1;
        const results = (
          await input.client.search({
            query,
            includeDomains: KFC_WEB_ALLOWED_HOSTNAMES,
            language: 'vi',
            location: 'Việt Nam',
          })
        )
          .slice(0, 5)
          .map(compactSearchResult);
        for (const { sourceUrl } of results) {
          currentTurnSearchUrls.add(sourceUrl);
        }
        const citations = results.map(({ sourceUrl }) => sourceUrl);
        const id = evidenceId(input.budget, 'searchKfcWeb');
        record(input.receipts, input.budget, {
          id,
          name: 'searchKfcWeb',
          effect: 'provider_read',
          status: 'success',
          evidenceMode: 'live_web',
          evidenceId: id,
          sourceUrls: citations,
          startedAt,
        });
        return { evidenceId: id, results, citations };
      } catch (error) {
        record(input.receipts, input.budget, {
          id: 'web:searchKfcWeb:error',
          name: 'searchKfcWeb',
          effect: 'provider_read',
          status: 'error',
          evidenceMode: 'live_web',
          startedAt,
        });
        throw error;
      }
    },
    {
      name: 'searchKfcWeb',
      description:
        'Search supplemental public background or policy information only on approved KFC Vietnam first-party websites. Commerce APIs remain authoritative.',
      schema: z.object({ query: z.string().trim().min(1).max(500) }).strict(),
    },
  );

  const fetchKfcPage = tool(
    async ({ url }) => {
      const startedAt = input.budget.now();
      try {
        requireAuthorized('fetchKfcPage', input.resolveAuthorizedToolNames);
        if (input.budget.fetchCalls >= 2) {
          throw new Error('kfc_web_fetch_budget_exhausted');
        }
        requireRemainingTime(input.budget);
        input.budget.fetchCalls += 1;
        const admittedUrl = validateBusinessWebUrl(
          url,
          KFC_WEB_ALLOWED_HOSTNAMES,
        );
        if (
          !inventoryUrls.has(admittedUrl) &&
          !currentTurnSearchUrls.has(admittedUrl)
        ) {
          throw new Error('kfc_web_url_not_admitted');
        }
        const fetched = await input.client.fetch({
          url: admittedUrl,
          allowedHostnames: KFC_WEB_ALLOWED_HOSTNAMES,
          perUrlTimeoutMs: KFC_WEB_FETCH_TIMEOUT_MS,
        });
        const sourceUrl = validateBusinessWebUrl(
          fetched.sourceUrl,
          KFC_WEB_ALLOWED_HOSTNAMES,
        );
        if (sourceUrl !== admittedUrl) {
          throw new Error('kfc_web_source_url_mismatch');
        }
        const finalUrl = validateBusinessWebUrl(
          fetched.finalUrl,
          KFC_WEB_ALLOWED_HOSTNAMES,
        );
        const page = {
          sourceUrl,
          finalUrl,
          title: fetched.title.trim().slice(0, 300),
          ...(fetched.publishedDate
            ? { publishedDate: fetched.publishedDate.trim().slice(0, 64) }
            : {}),
          text: fetched.text.trim().slice(0, 8_000),
          retrievedAt: fetched.retrievedAt.trim().slice(0, 64),
        };
        const citations = [...new Set([sourceUrl, finalUrl])];
        const id = evidenceId(input.budget, 'fetchKfcPage');
        record(input.receipts, input.budget, {
          id,
          name: 'fetchKfcPage',
          effect: 'provider_read',
          status: 'success',
          evidenceMode: 'live_web',
          evidenceId: id,
          sourceUrls: citations,
          startedAt,
        });
        return { evidenceId: id, page, citations };
      } catch (error) {
        record(input.receipts, input.budget, {
          id: 'web:fetchKfcPage:error',
          name: 'fetchKfcPage',
          effect: 'provider_read',
          status: 'error',
          evidenceMode: 'live_web',
          startedAt,
        });
        throw error;
      }
    },
    {
      name: 'fetchKfcPage',
      description:
        'Fetch one approved KFC Vietnam public page already in the small inventory or returned by searchKfcWeb in this turn.',
      schema: z.object({ url: z.string().url().max(2_048) }).strict(),
    },
  );

  return [searchKfcWeb, fetchKfcPage] as const;
}

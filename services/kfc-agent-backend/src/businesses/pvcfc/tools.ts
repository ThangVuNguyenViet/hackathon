import { tool } from 'langchain';
import { z } from 'zod';
import type { PvcfcPublicDataProvider } from './public-data/pvcfcPublicDataProvider.js';

const limitSchema = z.number().int().min(1).max(20).optional();
const cursorSchema = z.string().min(1).optional();

export interface PvcfcToolTrace {
  readonly name: string;
  readonly status: 'success' | 'error';
  readonly durationMs: number;
  readonly sourceUrls?: readonly string[];
  readonly evidenceMode?: 'canonical' | 'live_web';
}

export type PvcfcToolTraceSink = (trace: PvcfcToolTrace) => void;

function normalizeUrlValue(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch {
    // Preserve non-URL strings in provider extensions and free text.
  }
  return value;
}

function normalizeUrlFields(value: unknown, fieldName = ''): unknown {
  if (typeof value === 'string') {
    return /urls?$/iu.test(fieldName) ? normalizeUrlValue(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((child) => normalizeUrlFields(child, fieldName));
  }
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizeUrlFields(child, key),
    ]),
  );
}

function collectSourceUrls(value: unknown, sourceUrls: string[]): void {
  if (sourceUrls.length >= 5 || typeof value !== 'object' || value === null)
    return;
  if (Array.isArray(value)) {
    for (const child of value) collectSourceUrls(child, sourceUrls);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'sourceUrl' &&
      typeof child === 'string' &&
      /^https:\/\//u.test(child)
    ) {
      if (!sourceUrls.includes(child)) sourceUrls.push(child);
    } else {
      collectSourceUrls(child, sourceUrls);
    }
  }
}

async function traced<T>(
  name: string,
  sink: PvcfcToolTraceSink | undefined,
  operation: () => Promise<T>,
): Promise<T>;
async function traced(
  name: string,
  sink: PvcfcToolTraceSink | undefined,
  operation: () => Promise<unknown>,
): Promise<unknown> {
  const startedAt = Date.now();
  try {
    const result = normalizeUrlFields(await operation());
    const sourceUrls: string[] = [];
    collectSourceUrls(result, sourceUrls);
    sink?.({
      name,
      status: 'success',
      durationMs: Math.max(0, Date.now() - startedAt),
      evidenceMode: 'canonical',
      ...(sourceUrls.length === 0 ? {} : { sourceUrls }),
    });
    return result;
  } catch (error) {
    sink?.({
      name,
      status: 'error',
      durationMs: Math.max(0, Date.now() - startedAt),
      evidenceMode: 'canonical',
    });
    throw error;
  }
}

/** Read-only LangChain evidence tools owned by the PVCFC business pack. */
export function createPvcfcTools(
  provider: PvcfcPublicDataProvider,
  trace?: PvcfcToolTraceSink,
) {
  const listCollections = tool(
    async ({ limit, cursor }) =>
      traced('listPvcfcCollections', trace, () =>
        provider.listCollections({
          ...(limit === undefined ? {} : { limit }),
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ),
    {
      name: 'listPvcfcCollections',
      description:
        'List official PVCFC public-data collections, access modes, and record counts.',
      schema: z
        .object({
          limit: limitSchema,
          cursor: cursorSchema,
        })
        .strict(),
    },
  );

  const listRecords = tool(
    async ({ collection, limit, cursor, includeDetails }) =>
      traced('listPvcfcRecords', trace, async () => {
        const listed = await provider.listRecords({
          collection,
          ...(limit === undefined ? {} : { limit }),
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!includeDetails || !listed.ok) return listed;

        const details = await Promise.all(
          listed.value.records.map(({ collection: recordCollection, id }) =>
            provider.getRecord({ collection: recordCollection, id }),
          ),
        );
        return {
          ...listed,
          value: { ...listed.value, details },
        };
      }),
    {
      name: 'listPvcfcRecords',
      description:
        'List one bounded page from an official PVCFC collection, including discovery-only collections. Set includeDetails=true when the user asks to summarize or compare the page so all complete records are returned in this single tool call.',
      schema: z
        .object({
          collection: z.string().min(1),
          limit: limitSchema,
          cursor: cursorSchema,
          includeDetails: z.boolean().optional(),
        })
        .strict(),
    },
  );

  const searchRecords = tool(
    async ({ query, collections, limit, cursor }) =>
      traced('searchPvcfcRecords', trace, () =>
        provider.searchRecords({
          query,
          ...(collections === undefined ? {} : { collections }),
          ...(limit === undefined ? {} : { limit }),
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ),
    {
      name: 'searchPvcfcRecords',
      description:
        'Search verified official PVCFC public records. Results are compact and include source URLs.',
      schema: z
        .object({
          query: z.string().min(1).max(500),
          collections: z.array(z.string().min(1)).max(64).optional(),
          limit: limitSchema,
          cursor: cursorSchema,
        })
        .strict(),
    },
  );

  const getRecord = tool(
    async ({ collection, id }) =>
      traced('getPvcfcRecord', trace, () =>
        provider.getRecord({ collection, id }),
      ),
    {
      name: 'getPvcfcRecord',
      description:
        'Get one complete verified PVCFC public record by exact collection and record id.',
      schema: z
        .object({
          collection: z.string().min(1),
          id: z.string().min(1),
        })
        .strict(),
    },
  );

  return [listCollections, listRecords, searchRecords, getRecord] as const;
}

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

async function traced<T>(
  name: string,
  sink: PvcfcToolTraceSink | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    sink?.({
      name,
      status: 'success',
      durationMs: Math.max(0, Date.now() - startedAt),
      evidenceMode: 'canonical',
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
    async ({ collection, limit, cursor }) =>
      traced('listPvcfcRecords', trace, () =>
        provider.listRecords({
          collection,
          ...(limit === undefined ? {} : { limit }),
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ),
    {
      name: 'listPvcfcRecords',
      description:
        'List compact record locators from one official PVCFC collection, including discovery-only collections.',
      schema: z
        .object({
          collection: z.string().min(1),
          limit: limitSchema,
          cursor: cursorSchema,
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

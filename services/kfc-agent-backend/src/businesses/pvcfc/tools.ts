import { RunContext, tool } from '@kfc/openai-agents-runtime';
import type {
  OpenAiAgentRunContext,
  OpenAiFunctionTool,
  OpenAiStrictJsonObjectSchema,
} from '../../agent/openAiSdkTool.js';
import type { PvcfcPublicDataProvider } from './public-data/pvcfcPublicDataProvider.js';

const nullableLimit = {
  anyOf: [{ type: 'integer', minimum: 1, maximum: 20 }, { type: 'null' }],
} as const;
const nullableCursor = {
  anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
} as const;

const listCollectionsSchema: OpenAiStrictJsonObjectSchema = {
  type: 'object',
  properties: { limit: nullableLimit, cursor: nullableCursor },
  required: ['limit', 'cursor'],
  additionalProperties: false,
};

const listRecordsSchema: OpenAiStrictJsonObjectSchema = {
  type: 'object',
  properties: {
    collection: { type: 'string', minLength: 1 },
    limit: nullableLimit,
    cursor: nullableCursor,
  },
  required: ['collection', 'limit', 'cursor'],
  additionalProperties: false,
};

const searchRecordsSchema: OpenAiStrictJsonObjectSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 500 },
    collections: {
      anyOf: [
        {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        { type: 'null' },
      ],
    },
    limit: nullableLimit,
    cursor: nullableCursor,
  },
  required: ['query', 'collections', 'limit', 'cursor'],
  additionalProperties: false,
};

const getRecordSchema: OpenAiStrictJsonObjectSchema = {
  type: 'object',
  properties: {
    collection: { type: 'string', minLength: 1 },
    id: { type: 'string', minLength: 1 },
  },
  required: ['collection', 'id'],
  additionalProperties: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableLimit(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 20)
  );
}

function isNullableStringArray(value: unknown): value is string[] | null {
  return (
    value === null ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

function traceResult(
  runContext: RunContext<OpenAiAgentRunContext>,
  name: string,
  arguments_: Record<string, unknown>,
  result: unknown,
): unknown {
  runContext.context.toolCalls.push({ name, arguments: arguments_, result });
  return result;
}

function invalidInput(
  runContext: RunContext<OpenAiAgentRunContext> | undefined,
  name: string,
): unknown {
  const result = {
    ok: false,
    error: { code: 'invalid_request', message: 'Invalid tool input.' },
  };
  return runContext ? traceResult(runContext, name, {}, result) : result;
}

/** Bounded read-only evidence tools owned by the PVCFC pack. */
export function createPvcfcOpenAiTools(
  provider: PvcfcPublicDataProvider,
): OpenAiFunctionTool[] {
  const listCollections = tool<
    typeof listCollectionsSchema,
    OpenAiAgentRunContext,
    unknown
  >({
    name: 'listPvcfcCollections',
    description:
      'List available official PVCFC public-data collections, access modes, and record counts.',
    parameters: listCollectionsSchema,
    strict: true,
    async execute(arguments_, runContext) {
      if (
        !runContext ||
        !isRecord(arguments_) ||
        !isNullableLimit(arguments_.limit) ||
        !isNullableString(arguments_.cursor)
      ) {
        return invalidInput(runContext, 'listPvcfcCollections');
      }
      const normalized = {
        limit: arguments_.limit,
        cursor: arguments_.cursor,
      };
      return traceResult(
        runContext,
        'listPvcfcCollections',
        normalized,
        await provider.listCollections({
          ...(arguments_.limit === null ? {} : { limit: arguments_.limit }),
          ...(arguments_.cursor === null ? {} : { cursor: arguments_.cursor }),
        }),
      );
    },
  });

  const listRecords = tool<
    typeof listRecordsSchema,
    OpenAiAgentRunContext,
    unknown
  >({
    name: 'listPvcfcRecords',
    description:
      'List compact record locators in one official PVCFC collection, including discovery-only collections.',
    parameters: listRecordsSchema,
    strict: true,
    async execute(arguments_, runContext) {
      if (
        !runContext ||
        !isRecord(arguments_) ||
        typeof arguments_.collection !== 'string' ||
        !isNullableLimit(arguments_.limit) ||
        !isNullableString(arguments_.cursor)
      ) {
        return invalidInput(runContext, 'listPvcfcRecords');
      }
      const normalized = {
        collection: arguments_.collection,
        limit: arguments_.limit,
        cursor: arguments_.cursor,
      };
      return traceResult(
        runContext,
        'listPvcfcRecords',
        normalized,
        await provider.listRecords({
          collection: arguments_.collection,
          ...(arguments_.limit === null ? {} : { limit: arguments_.limit }),
          ...(arguments_.cursor === null ? {} : { cursor: arguments_.cursor }),
        }),
      );
    },
  });

  const searchRecords = tool<
    typeof searchRecordsSchema,
    OpenAiAgentRunContext,
    unknown
  >({
    name: 'searchPvcfcRecords',
    description:
      'Search verified official PVCFC public records. Results are compact and include official source URLs.',
    parameters: searchRecordsSchema,
    strict: true,
    async execute(arguments_, runContext) {
      if (
        !runContext ||
        !isRecord(arguments_) ||
        typeof arguments_.query !== 'string' ||
        !isNullableStringArray(arguments_.collections) ||
        !isNullableLimit(arguments_.limit) ||
        !isNullableString(arguments_.cursor)
      ) {
        return invalidInput(runContext, 'searchPvcfcRecords');
      }
      const normalized = {
        query: arguments_.query,
        collections: arguments_.collections,
        limit: arguments_.limit,
        cursor: arguments_.cursor,
      };
      return traceResult(
        runContext,
        'searchPvcfcRecords',
        normalized,
        await provider.searchRecords({
          query: arguments_.query,
          ...(arguments_.collections === null
            ? {}
            : { collections: arguments_.collections }),
          ...(arguments_.limit === null ? {} : { limit: arguments_.limit }),
          ...(arguments_.cursor === null ? {} : { cursor: arguments_.cursor }),
        }),
      );
    },
  });

  const getRecord = tool<
    typeof getRecordSchema,
    OpenAiAgentRunContext,
    unknown
  >({
    name: 'getPvcfcRecord',
    description:
      'Get one complete verified PVCFC public record by exact collection and record id.',
    parameters: getRecordSchema,
    strict: true,
    async execute(arguments_, runContext) {
      if (
        !runContext ||
        !isRecord(arguments_) ||
        typeof arguments_.collection !== 'string' ||
        typeof arguments_.id !== 'string'
      ) {
        return invalidInput(runContext, 'getPvcfcRecord');
      }
      const normalized = {
        collection: arguments_.collection,
        id: arguments_.id,
      };
      return traceResult(
        runContext,
        'getPvcfcRecord',
        normalized,
        await provider.getRecord(normalized),
      );
    },
  });

  return [listCollections, listRecords, searchRecords, getRecord];
}

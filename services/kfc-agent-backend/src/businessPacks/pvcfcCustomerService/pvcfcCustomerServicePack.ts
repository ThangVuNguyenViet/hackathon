import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool } from 'langchain';
import { z } from 'zod';
import publicKnowledgeIndex from '../../../fixtures/business-packs/pvcfc-customer-service/pvcfc-public-web-2026-07-21/derived/public-knowledge-index.json' with { type: 'json' };
import type { AgentTurnInput, AgentTurnOutput } from '../../agent/agentTurn.js';
import type { AgentState } from '../../agent/agentState.js';
import {
  createPackStateEnvelope,
  type BusinessPack,
} from '../../runtime/businessPack.js';
import { textOnlyPresentation } from '../../presentation/channelPresentation.js';

export const PVCFC_CUSTOMER_SERVICE_PACK_REF = {
  packId: 'pvcfc-customer-service',
  version: '1.0.0',
} as const;

const CORPUS_ID = 'pvcfc-public-web-2026-07-21';
const CAPTURED_ON = '2026-07-21';

export const PVCFC_CUSTOMER_SERVICE_INSTRUCTIONS = [
  'Bạn là trợ lý thông tin công khai của PVCFC.',
  `Mọi tuyên bố thực tế phải dựa trên kết quả searchPublicKnowledge từ corpus ${CORPUS_ID}, captured on ${CAPTURED_ON}, và kèm URL nguồn cùng ngày chụp.`,
  'Vietnamese is the default response language. An English response is available only as a partial English fallback; say clearly when the English public corpus does not cover the question.',
  'Nguồn này chỉ là nội dung web công khai của PVCFC. It carries no private order authority, no private customer authority, no dealer authority, no complaint authority, and no visit-booking authority.',
  'Không khẳng định đã tra cứu hay thay đổi đơn hàng, hồ sơ khách hàng, đại lý, khiếu nại hoặc lịch tham quan. Có thể chỉ dẫn khách đến biểu mẫu hay kênh liên hệ công khai, nhưng không được nói rằng đã gửi biểu mẫu.',
  'Nếu kết quả không đủ, nói rõ giới hạn của corpus và không suy đoán.',
].join('\n');

interface PublicKnowledgeDocument {
  id: string;
  language: 'vi' | 'en';
  title: string;
  sourceUrl: string;
  capturedOn: string;
  text: string;
}

interface PvcfcPackState {
  corpusId: typeof CORPUS_ID;
  lastCitations: string[];
}

const index = publicKnowledgeIndex as {
  schemaVersion: 1;
  corpusId: string;
  capturedOn: string;
  englishCoverage: 'partial';
  documents: PublicKnowledgeDocument[];
};

const stateSchema = z
  .object({
    corpusId: z.literal(CORPUS_ID),
    lastCitations: z.array(z.string().url()).max(10),
  })
  .strict();

function parsePvcfcState(value: unknown): PvcfcPackState {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) throw new Error('pvcfc_pack_state_invalid');
  return parsed.data;
}

function createPublicKnowledgeTool(citations: Set<string>) {
  return tool(
    ({ query, language = 'vi' }) => {
      const queryTerms = normalizedTerms(query);
      const matches = index.documents
        .filter((document) => document.language === language)
        .map((document) => ({
          document,
          score: retrievalScore(queryTerms, document),
        }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.document.id.localeCompare(right.document.id),
        );
      const results = matches.slice(0, 5).map(({ document }) => {
        citations.add(document.sourceUrl);
        return {
          title: document.title,
          excerpt: relevantExcerpt(document.text, queryTerms),
          sourceUrl: document.sourceUrl,
          capturedOn: document.capturedOn,
        };
      });
      return JSON.stringify({
        corpusId: index.corpusId,
        capturedOn: index.capturedOn,
        language,
        englishCoverage: index.englishCoverage,
        total: matches.length,
        complete: matches.length <= results.length,
        results,
      });
    },
    {
      name: 'searchPublicKnowledge',
      description:
        'Search the dated PVCFC first-party public web corpus. Returns excerpts with public source URLs and capture dates; it never queries private business systems.',
      schema: z.object({
        query: z.string().trim().min(1).max(500),
        language: z.enum(['vi', 'en']).default('vi'),
      }),
    },
  );
}

function normalizedTerms(text: string): string[] {
  return [
    ...new Set(
      text
        .normalize('NFKC')
        .toLocaleLowerCase('vi-VN')
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ];
}

function retrievalScore(
  queryTerms: readonly string[],
  document: PublicKnowledgeDocument,
): number {
  const titleTerms = new Set(normalizedTerms(document.title));
  const documentTerms = new Set(
    normalizedTerms(`${document.title}\n${document.text}`),
  );
  return queryTerms.reduce(
    (score, term) =>
      score +
      (titleTerms.has(term) ? 3 : 0) +
      (documentTerms.has(term) ? 1 : 0),
    0,
  );
}

function relevantExcerpt(text: string, queryTerms: readonly string[]): string {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('vi-VN');
  const hit = queryTerms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const start = Math.max(0, (hit ?? 0) - 300);
  return text.slice(start, start + 1_200).trim();
}

function conversationMessages(
  turns: Awaited<ReturnType<AgentTurnInput['store']['listTurns']>>,
): BaseMessage[] {
  return turns
    .filter(
      (turn): turn is typeof turn & { role: 'user' | 'assistant' } =>
        turn.role === 'user' || turn.role === 'assistant',
    )
    .slice(-20)
    .map((turn) =>
      turn.role === 'user'
        ? new HumanMessage(turn.text)
        : new AIMessage(turn.text),
    );
}

function initialState(input: AgentTurnInput): AgentState {
  return {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: input.channel,
    latestUserMessage: input.text,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

export const pvcfcCustomerServicePack: BusinessPack<
  AgentTurnInput,
  AgentTurnOutput,
  PvcfcPackState
> = {
  ref: PVCFC_CUSTOMER_SERVICE_PACK_REF,
  stateSchemaVersion: '1',
  parseState: parsePvcfcState,
  async run(input, invokeModel) {
    const model = input.agentModel;
    if (!model) throw new Error('pvcfc_agent_not_configured');
    const turnInput = {
      ...input,
      agentModel: model,
      sessionId: pvcfcSessionId(input.sessionId),
    };
    await turnInput.store.appendTurn({
      sessionId: turnInput.sessionId,
      channel: turnInput.channel,
      role: 'user',
      text: turnInput.text,
      externalMessageId: turnInput.externalMessageId ?? null,
      externalUserId: turnInput.customerId,
      deliveryStatus: 'received',
      metadata: turnInput.metadata ?? null,
    });
    const citations = new Set<string>();
    const responseText = await invokeModel({
      model,
      systemPrompt: PVCFC_CUSTOMER_SERVICE_INSTRUCTIONS,
      messages: conversationMessages(
        await turnInput.store.listTurns(turnInput.sessionId),
      ),
      tools: [createPublicKnowledgeTool(citations)],
      responseErrors: {
        invalid: 'pvcfc_agent_model_response_invalid',
        empty: 'pvcfc_agent_model_response_empty',
      },
    });
    const envelope = await createPackStateEnvelope({
      packRef: PVCFC_CUSTOMER_SERVICE_PACK_REF,
      schemaVersion: '1',
      state: {
        corpusId: CORPUS_ID,
        lastCitations: [...citations].slice(0, 10),
      } satisfies PvcfcPackState,
    });
    const committed = await turnInput.store.commitAssistantTurn({
      assistantTurn: {
        sessionId: turnInput.sessionId,
        channel: turnInput.channel,
        role: 'assistant',
        text: responseText,
        externalMessageId: null,
        externalUserId: null,
        deliveryStatus: 'not_applicable',
        metadata: null,
      },
      packState: {
        sessionId: turnInput.sessionId,
        envelope,
      },
    });
    const state = initialState(turnInput);
    return {
      state,
      responseText,
      presentation: textOnlyPresentation(responseText, turnInput.channel),
      replyIntent: 'general_reply',
      assistantTurnId: committed.turn.id,
      status: 'completed',
    };
  },
};

export function pvcfcSessionId(externalSessionId: string): string {
  if (!externalSessionId.trim()) throw new Error('session_id_invalid');
  return `${PVCFC_CUSTOMER_SERVICE_PACK_REF.packId}@${PVCFC_CUSTOMER_SERVICE_PACK_REF.version}:${externalSessionId}`;
}

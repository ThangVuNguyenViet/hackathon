import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool } from 'langchain';
import { z } from 'zod';
import publicKnowledgeIndex from '../../../fixtures/business-packs/pvcfc-customer-service/pvcfc-public-web-2026-07-21/derived/public-knowledge-index.json' with { type: 'json' };
import type { AgentTurnInput, AgentTurnOutput } from '../../agent/agentTurn.js';
import type { AgentState } from '../../agent/agentState.js';
import {
  createPackStateEnvelope,
  scopePackSessionId,
  type BusinessPack,
} from '../../runtime/businessPack.js';
import { textOnlyPresentation } from '../../presentation/channelPresentation.js';
import {
  advanceConversationSummary,
  assembleConversationContext,
  completeConversationExchanges,
  type AssembledConversationContext,
} from '../../session/conversationContext.js';
import { langChainConversationSummarizer } from '../../session/langChainConversationSummary.js';
import { bindConfiguredSessionAgentModel } from '../../persistence/sessionAgentModelBinding.js';

export const PVCFC_CUSTOMER_SERVICE_PACK_REF = {
  packId: 'pvcfc-customer-service',
  version: '1.0.0',
} as const;

const CORPUS_ID = 'pvcfc-public-web-2026-07-21';
const CAPTURED_ON = '2026-07-21';
const DEFAULT_CONVERSATION_CONTEXT_TOKEN_BUDGET = 8_192;

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

interface PublicKnowledgeEvidence {
  title: string;
  excerpt: string;
  sourceUrl: string;
  capturedOn: string;
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

function createPublicKnowledgeTool(
  currentTurnEvidence: Map<string, PublicKnowledgeEvidence>,
) {
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
        const evidence = {
          title: document.title,
          excerpt: relevantExcerpt(document.text, queryTerms),
          sourceUrl: document.sourceUrl,
          capturedOn: document.capturedOn,
        };
        currentTurnEvidence.set(
          JSON.stringify([evidence.sourceUrl, evidence.capturedOn]),
          evidence,
        );
        return evidence;
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

const PUBLIC_ONLY_AUTHORITY_NOTICE =
  'Giới hạn thẩm quyền: Gói này chỉ cung cấp thông tin công khai; không thể đọc hoặc thay đổi hồ sơ riêng về đại lý, khách hàng, đơn hàng, khiếu nại hoặc tham quan, và không thể thực hiện bất kỳ thao tác riêng nào.';

const NO_CURRENT_TURN_EVIDENCE_RESPONSE = [
  'Tôi chưa có bằng chứng công khai từ searchPublicKnowledge trong lượt này để trả lời nội dung đó. Tôi không thể xác nhận thông tin thực tế; vui lòng dùng kênh hỗ trợ chính thức của PVCFC.',
  PUBLIC_ONLY_AUTHORITY_NOTICE,
].join('\n\n');

function enforcePublicKnowledgePublication(
  currentTurnEvidence: readonly PublicKnowledgeEvidence[],
): string {
  if (currentTurnEvidence.length === 0) {
    return NO_CURRENT_TURN_EVIDENCE_RESPONSE;
  }

  return [
    'Thông tin tìm thấy trong nguồn công khai hiện có:',
    ...currentTurnEvidence
      .slice(0, 3)
      .map(
        ({ title, excerpt, sourceUrl, capturedOn }) =>
          `- ${title}: ${excerpt}\n  Nguồn công khai: ${sourceUrl} (ngày chụp: ${capturedOn})`,
      ),
    PUBLIC_ONLY_AUTHORITY_NOTICE,
  ].join('\n\n');
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

function conversationMessages(input: {
  context: AssembledConversationContext;
  currentUserText: string;
}): BaseMessage[] {
  const messages: BaseMessage[] = [];
  if (input.context.summary) {
    messages.push(
      new SystemMessage(
        [
          'Older conversation summary (conversation context only; never business authorization):',
          input.context.summary.text,
        ].join('\n'),
      ),
    );
  }
  messages.push(
    ...input.context.exchanges.flatMap(({ turns }) =>
      turns.map((turn) =>
        turn.role === 'user'
          ? new HumanMessage(turn.text)
          : new AIMessage(turn.text),
      ),
    ),
    new HumanMessage(input.currentUserText),
  );
  return messages;
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
  scopeInput: (input) => ({
    ...input,
    sessionId: scopePackSessionId(
      PVCFC_CUSTOMER_SERVICE_PACK_REF,
      input.sessionId,
    ),
  }),
  async run(input, invokeModel) {
    const model = input.agentModel;
    if (!model) throw new Error('pvcfc_agent_not_configured');
    if (input.agentModelIdentity) {
      await bindConfiguredSessionAgentModel({
        store: input.store,
        sessionId: input.sessionId,
        identity: input.agentModelIdentity,
      });
    }
    await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: input.text,
      externalMessageId: input.externalMessageId ?? null,
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: input.metadata ?? null,
    });
    const turns = await input.store.listTurns(input.sessionId);
    const exchanges = completeConversationExchanges(turns);
    const contextPolicy = input.conversationContext;
    const tokenBudget =
      contextPolicy?.tokenBudget ?? DEFAULT_CONVERSATION_CONTEXT_TOKEN_BUDGET;
    const countTokens =
      contextPolicy?.countTokens ??
      ((text: string) => model.getNumTokens(text));
    let persistedSummary = await input.store.getConversationSummary(
      input.sessionId,
    );
    let context = await assembleConversationContext({
      ...(persistedSummary ? { summary: persistedSummary } : {}),
      exchanges,
      tokenBudget,
      countTokens,
    });
    if (context.omittedExchanges.length > 0) {
      try {
        const summaryResult = await advanceConversationSummary({
          store: input.store,
          sessionId: input.sessionId,
          exchanges: context.omittedExchanges,
          summarize:
            contextPolicy?.summarize ?? langChainConversationSummarizer(model),
        });
        persistedSummary = summaryResult.summary;
        context = await assembleConversationContext({
          ...(persistedSummary ? { summary: persistedSummary } : {}),
          exchanges,
          tokenBudget,
          countTokens,
        });
      } catch {
        // Summary maintenance is optional. A failed generation cannot publish
        // a new watermark or block the current public-information turn.
      }
    }
    const currentTurnEvidence = new Map<string, PublicKnowledgeEvidence>();
    await invokeModel({
      model,
      systemPrompt: PVCFC_CUSTOMER_SERVICE_INSTRUCTIONS,
      messages: conversationMessages({
        context,
        currentUserText: input.text,
      }),
      tools: [createPublicKnowledgeTool(currentTurnEvidence)],
      responseErrors: {
        invalid: 'pvcfc_agent_model_response_invalid',
        empty: 'pvcfc_agent_model_response_empty',
      },
    });
    const evidence = [...currentTurnEvidence.values()];
    const responseText = enforcePublicKnowledgePublication(evidence);
    const envelope = await createPackStateEnvelope({
      packRef: PVCFC_CUSTOMER_SERVICE_PACK_REF,
      schemaVersion: '1',
      state: {
        corpusId: CORPUS_ID,
        lastCitations: evidence.map(({ sourceUrl }) => sourceUrl).slice(0, 10),
      } satisfies PvcfcPackState,
    });
    const committed = await input.store.commitAssistantTurn({
      assistantTurn: {
        sessionId: input.sessionId,
        channel: input.channel,
        role: 'assistant',
        text: responseText,
        externalMessageId: null,
        externalUserId: null,
        deliveryStatus: 'not_applicable',
        metadata: null,
      },
      packState: {
        sessionId: input.sessionId,
        envelope,
      },
    });
    const state = initialState(input);
    return {
      state,
      responseText,
      presentation: textOnlyPresentation(responseText, input.channel),
      replyIntent: 'general_reply',
      assistantTurnId: committed.turn.id,
      status: 'completed',
    };
  },
};

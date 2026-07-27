import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool, type ToolRuntime } from 'langchain';
import { z } from 'zod';
import publicKnowledgeIndex from '../../../fixtures/business-packs/pvcfc-customer-service/pvcfc-public-web-2026-07-21/derived/public-knowledge-index.json' with { type: 'json' };
import type { AgentTurnInput, AgentTurnOutput } from '../../agent/agentTurn.js';
import type { AgentState } from '../../agent/agentState.js';
import {
  createPackStateEnvelope,
  scopePackSessionId,
  validatePackStateEnvelope,
  type BusinessPack,
} from '../../runtime/businessPack.js';
import { textOnlyPresentation } from '../../presentation/channelPresentation.js';
import {
  assembleConversationContext,
  completeConversationExchanges,
  conversationTokenCounter,
  type AssembledConversationContext,
} from '../../session/conversationContext.js';
import { scheduleConversationCompaction } from '../../session/conversationCompaction.js';
import { langChainConversationSummarizer } from '../../session/langChainConversationSummary.js';
import { bindConfiguredSessionAgentModel } from '../../persistence/sessionAgentModelBinding.js';
import { requireTrustedConfiguredAgentModelBinding } from '../../config/agentModelProfile.js';

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
  'Always answer in the language of the latest customer message. English is available only as a partial fallback; say clearly when the English public corpus does not cover the question.',
  'For every customer turn that asks for public facts, call searchPublicKnowledge in that same turn, even when earlier turns already searched. Set the tool language to the latest customer language. Prior citations are conversation context, not current-turn publication evidence.',
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
  language: 'vi' | 'en';
  title: string;
  excerpt: string;
  sourceUrl: string;
  capturedOn: string;
}

interface PvcfcPackState {
  corpusId: typeof CORPUS_ID;
  lastCitations: string[];
  lastResponseLanguage: 'vi' | 'en';
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
    lastResponseLanguage: z.enum(['vi', 'en']).default('vi'),
  })
  .strict();

function parsePvcfcState(value: unknown): PvcfcPackState {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) throw new Error('pvcfc_pack_state_invalid');
  return parsed.data;
}

function createPublicKnowledgeTool(
  currentTurnEvidence: Map<string, PublicKnowledgeEvidence>,
  recordLocalToolEvidence?: AgentTurnInput['recordLocalToolEvidence'],
) {
  return tool(
    async (
      { query, language = 'vi' },
      runtime: ToolRuntime,
    ): Promise<string> => {
      const callId =
        runtime.toolCallId ?? `pvcfc-public:${crypto.randomUUID()}`;
      const args = { query, language };
      const requestedAt = new Date();
      await recordLocalToolEvidence?.({
        phase: 'started',
        callId,
        toolName: 'searchPublicKnowledge',
        arguments: args,
        requestedAt: requestedAt.toISOString(),
      });
      const executionStartedAt = new Date();
      try {
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
            language: document.language,
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
        const result = {
          corpusId: index.corpusId,
          capturedOn: index.capturedOn,
          language,
          englishCoverage: index.englishCoverage,
          total: matches.length,
          complete: matches.length <= results.length,
          results,
        };
        const completedAt = new Date();
        await recordLocalToolEvidence?.({
          phase: 'completed',
          callId,
          toolName: 'searchPublicKnowledge',
          arguments: args,
          rawResult: result,
          modelFacingResult: result,
          executionStartedAt: executionStartedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          executionDurationMs:
            completedAt.getTime() - executionStartedAt.getTime(),
        });
        return JSON.stringify(result);
      } catch (error) {
        const completedAt = new Date();
        await recordLocalToolEvidence?.({
          phase: 'failed',
          callId,
          toolName: 'searchPublicKnowledge',
          arguments: args,
          error,
          requestedAt: requestedAt.toISOString(),
          executionStartedAt: executionStartedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          totalDurationMs: completedAt.getTime() - requestedAt.getTime(),
          executionDurationMs:
            completedAt.getTime() - executionStartedAt.getTime(),
        });
        throw error;
      }
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
const PUBLIC_ONLY_AUTHORITY_NOTICE_EN =
  'Authority boundary: This pack provides public information only. It cannot read or change private dealer, customer, order, complaint, or visit-booking records, and it cannot perform private actions.';

const NO_CURRENT_TURN_EVIDENCE_RESPONSE = [
  'Tôi chưa có bằng chứng công khai từ searchPublicKnowledge trong lượt này để trả lời nội dung đó. Tôi không thể xác nhận thông tin thực tế; vui lòng dùng kênh hỗ trợ chính thức của PVCFC.',
  PUBLIC_ONLY_AUTHORITY_NOTICE,
].join('\n\n');
const NO_CURRENT_TURN_EVIDENCE_RESPONSE_EN = [
  'I do not have current-turn public evidence from searchPublicKnowledge that could verify or perform that request. Please use an official PVCFC support channel.',
  PUBLIC_ONLY_AUTHORITY_NOTICE_EN,
].join('\n\n');

function enforcePublicKnowledgePublication(
  currentTurnEvidence: readonly PublicKnowledgeEvidence[],
  responseLanguage: 'vi' | 'en',
): string {
  if (currentTurnEvidence.length === 0) {
    return responseLanguage === 'en'
      ? NO_CURRENT_TURN_EVIDENCE_RESPONSE_EN
      : NO_CURRENT_TURN_EVIDENCE_RESPONSE;
  }

  const evidence = currentTurnEvidence.slice(0, 3);
  if (responseLanguage === 'en') {
    return [
      'Public information found in the available dated corpus (English coverage is partial):',
      ...evidence.map(
        ({ title, excerpt, sourceUrl, capturedOn }) =>
          `- ${title}: ${conciseExcerpt(excerpt)}\n  Public source: ${sourceUrl} (captured: ${capturedOn})`,
      ),
      PUBLIC_ONLY_AUTHORITY_NOTICE_EN,
    ].join('\n\n');
  }
  return [
    'Thông tin tìm thấy trong nguồn công khai hiện có:',
    ...evidence.map(
      ({ title, excerpt, sourceUrl, capturedOn }) =>
        `- ${title}: ${conciseExcerpt(excerpt)}\n  Nguồn công khai: ${sourceUrl} (ngày chụp: ${capturedOn})`,
    ),
    PUBLIC_ONLY_AUTHORITY_NOTICE,
  ].join('\n\n');
}

function conciseExcerpt(excerpt: string): string {
  const normalized = excerpt
    .replaceAll(/[#*_`]+/gu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim();
  const sentences = normalized.match(/.*?[.!?…](?:\s|$)/gu) ?? [];
  const complete = sentences.slice(0, 2).join(' ').trim();
  const candidate = complete || normalized;
  return candidate.length <= 360
    ? candidate
    : `${candidate.slice(0, 357).trimEnd()}…`;
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
    const agent = requireTrustedConfiguredAgentModelBinding(
      input.agentModelBinding,
      {
        model: input.agentModel,
        identity: input.agentModelIdentity,
      },
    );
    const model = agent.model;
    input = {
      ...input,
      agentModel: model,
      agentModelIdentity: agent.identity,
    };
    await bindConfiguredSessionAgentModel({
      store: input.store,
      sessionId: input.sessionId,
      identity: agent.identity,
    });
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
      contextPolicy?.countTokens ?? conversationTokenCounter(model);
    const persistedSummary = await input.store.getConversationSummary(
      input.sessionId,
    );
    const context = await assembleConversationContext({
      ...(persistedSummary ? { summary: persistedSummary } : {}),
      exchanges,
      tokenBudget,
      countTokens,
    });
    const currentTurnEvidence = new Map<string, PublicKnowledgeEvidence>();
    const priorEnvelope = await input.store.getPackState(
      input.sessionId,
      PVCFC_CUSTOMER_SERVICE_PACK_REF,
    );
    const priorState = priorEnvelope
      ? await validatePackStateEnvelope(priorEnvelope, {
          packRef: PVCFC_CUSTOMER_SERVICE_PACK_REF,
          schemaVersion: '1',
          parseState: parsePvcfcState,
        })
      : undefined;
    await invokeModel({
      model,
      modelTransport: agent.identity.transport,
      systemPrompt: PVCFC_CUSTOMER_SERVICE_INSTRUCTIONS,
      messages: conversationMessages({
        context,
        currentUserText: input.text,
      }),
      tools: [
        createPublicKnowledgeTool(
          currentTurnEvidence,
          input.recordLocalToolEvidence,
        ),
      ],
      responseErrors: {
        invalid: 'pvcfc_agent_model_response_invalid',
        empty: 'pvcfc_agent_model_response_empty',
      },
    });
    const evidence = [...currentTurnEvidence.values()];
    const responseLanguage =
      evidence[0]?.language ?? priorState?.lastResponseLanguage ?? 'vi';
    const responseText = enforcePublicKnowledgePublication(
      evidence,
      responseLanguage,
    );
    const envelope = await createPackStateEnvelope({
      packRef: PVCFC_CUSTOMER_SERVICE_PACK_REF,
      schemaVersion: '1',
      state: {
        corpusId: CORPUS_ID,
        lastCitations: evidence.map(({ sourceUrl }) => sourceUrl).slice(0, 10),
        lastResponseLanguage: responseLanguage,
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
    scheduleConversationCompaction({
      store: input.store,
      sessionId: input.sessionId,
      tokenBudget,
      countTokens,
      summarize:
        contextPolicy?.summarize ?? langChainConversationSummarizer(model),
      deferWork: input.deferWork,
      onError: (error) =>
        console.error('conversation_compaction_failed', {
          sessionId: input.sessionId,
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        }),
    });
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

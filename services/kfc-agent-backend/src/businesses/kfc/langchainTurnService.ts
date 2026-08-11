import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createKfcAgent } from '../../agent/kfcCreateAgent.js';
import type { SelectedActionResponseReference } from '../../agent/selectedActionResponseAuthority.js';
import { STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID } from '../../agent/structuredCustomerAction.js';
import type { Channel, ConversationTurn } from '../../domain/types.js';
import type { KfcGenUiAttachment } from '../../genui/kfcGenUi.js';
import { selectKfcGenUiAttachment } from '../../genui/kfcGenUiSelector.js';
import type { AgentGraphState } from '../../graph/state.js';
import { toolNames } from '../../ordering/toolCatalog.js';
import type { ToolName } from '../../ordering/types.js';
import type { ConversationStore } from '../../persistence/contracts.js';
import {
  createKfcLangChainTools,
  type KfcCoreToolReceipt,
  type KfcPendingConfirmation,
  type KfcTrustedToolExecutor,
} from './tools.js';
import {
  kfcGroundedPublicationSchema,
  type KfcGroundedPublication,
} from './publication.js';

const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_TEXT_LENGTH = 4_000;

export interface KfcAgentTurnInput {
  readonly sessionId: string;
  readonly customerId: string;
  readonly channel: Channel;
  readonly currentUserTurnId: string;
}

export interface KfcStateLoaderInput extends KfcAgentTurnInput {
  readonly currentUserTurn: ConversationTurn;
}

export type KfcStateLoader = (
  input: KfcStateLoaderInput,
) => Promise<AgentGraphState>;

export type KfcPublicationValidator = (input: {
  readonly publication: KfcGroundedPublication;
  readonly state: AgentGraphState;
  readonly toolCalls: readonly KfcCoreToolReceipt[];
}) => void | Promise<void>;

export interface KfcLangChainTurnOptions {
  readonly model: BaseChatModel;
  readonly store: ConversationStore;
  readonly loadState: KfcStateLoader;
  readonly executeTool: KfcTrustedToolExecutor;
  readonly resolveActiveToolNames: (input: {
    readonly state: AgentGraphState;
    readonly turn: KfcAgentTurnInput;
  }) => readonly ToolName[];
  readonly validatePublication?: KfcPublicationValidator;
  readonly selectedActionResponse?: SelectedActionResponseReference;
}

export interface KfcLangChainTurnResult {
  readonly status: 'completed' | 'confirmation_required';
  readonly responseText: string;
  readonly publication: KfcGroundedPublication;
  readonly state: AgentGraphState;
  readonly toolCalls: readonly KfcCoreToolReceipt[];
  readonly genUi?: KfcGenUiAttachment;
  readonly pendingConfirmation?: KfcPendingConfirmation;
}

function boundedText(text: string): string {
  return text.slice(0, MAX_HISTORY_TEXT_LENGTH);
}

function messageFor(turn: ConversationTurn): BaseMessage | null {
  if (turn.role === 'user') return new HumanMessage(boundedText(turn.text));
  if (turn.role === 'assistant') return new AIMessage(boundedText(turn.text));
  return null;
}

async function canonicalHistory(input: {
  readonly store: ConversationStore;
  readonly turn: KfcAgentTurnInput;
}): Promise<{
  readonly currentUserTurn: ConversationTurn;
  readonly messages: BaseMessage[];
}> {
  const turns = await input.store.listTurns(input.turn.sessionId);
  const currentIndex = turns.findIndex(
    ({ id }) => id === input.turn.currentUserTurnId,
  );
  const currentUserTurn = turns[currentIndex];
  if (
    currentIndex < 0 ||
    !currentUserTurn ||
    currentUserTurn.role !== 'user' ||
    currentUserTurn.sessionId !== input.turn.sessionId ||
    currentUserTurn.channel !== input.turn.channel ||
    currentUserTurn.externalUserId !== input.turn.customerId
  ) {
    throw new Error('kfc_current_user_turn_invalid');
  }
  const messages = turns
    .slice(0, currentIndex + 1)
    .flatMap((turn) => {
      const message = messageFor(turn);
      return message ? [message] : [];
    })
    .slice(-MAX_HISTORY_TURNS);
  if (messages.length === 0 || !HumanMessage.isInstance(messages.at(-1))) {
    throw new Error('kfc_current_user_turn_invalid');
  }
  return { currentUserTurn, messages };
}

function validateStateIdentity(
  state: AgentGraphState,
  turn: KfcAgentTurnInput,
): void {
  if (
    state.sessionId !== turn.sessionId ||
    state.customerId !== turn.customerId ||
    state.channel !== turn.channel
  ) {
    throw new Error('kfc_loaded_state_identity_mismatch');
  }
}

function validatePublicationByDefault(input: {
  publication: KfcGroundedPublication;
  toolCalls: readonly KfcCoreToolReceipt[];
  selectedActionResponse?: SelectedActionResponseReference;
}): void {
  const selectedActionMatches = input.selectedActionResponse
    ? JSON.stringify(input.publication.selectedActionResponse) ===
      JSON.stringify(input.selectedActionResponse)
    : input.publication.selectedActionResponse === null;
  if (
    input.publication.publicationDeclaration.semanticRelevance !== 'aligned' ||
    input.publication.publicationDeclaration.privateDataDisclosure ===
      'unauthorized' ||
    input.publication.publicationDeclaration.disclosesInternalMetadata ||
    input.publication.factualClaims.hasUnsupportedFactualClaim ||
    !selectedActionMatches
  ) {
    throw new Error('kfc_publication_rejected');
  }
  const issuedEvidence = new Set(
    input.toolCalls.flatMap(({ evidenceId, status }) =>
      status === 'success' && evidenceId ? [evidenceId] : [],
    ),
  );
  if (
    input.publication.factualClaims.evidenceReferences.some(
      ({ evidenceId }) => !issuedEvidence.has(evidenceId),
    )
  ) {
    throw new Error('kfc_publication_evidence_invalid');
  }
}

export async function runKfcLangChainTurn(
  options: KfcLangChainTurnOptions,
  turn: KfcAgentTurnInput,
): Promise<KfcLangChainTurnResult> {
  const { currentUserTurn, messages } = await canonicalHistory({
    store: options.store,
    turn,
  });
  const state = await options.loadState({ ...turn, currentUserTurn });
  validateStateIdentity(state, turn);
  const receipts: KfcCoreToolReceipt[] = [];
  let pendingConfirmation: KfcPendingConfirmation | undefined;
  const resolveCurrentToolNames = () => [
    ...new Set(options.resolveActiveToolNames({ state, turn })),
  ];
  const tools = createKfcLangChainTools({
    state,
    activeToolNames: toolNames,
    resolveActiveToolNames: resolveCurrentToolNames,
    executeTool: options.executeTool,
    receipts,
    setPendingConfirmation(pending) {
      if (pendingConfirmation) {
        throw new Error('kfc_multiple_pending_confirmations');
      }
      pendingConfirmation = pending;
    },
  });
  const selectedActionMessage = options.selectedActionResponse
    ? new SystemMessage({
        id: STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
        content: JSON.stringify({
          instruction: [
            'This is a presentation-only response for an already executed trusted typed action.',
            'Do not initiate another commerce action.',
            'Include selectedActionResponse exactly as supplied in the final structured response.',
          ].join(' '),
          selectedActionResponse: options.selectedActionResponse,
        }),
      })
    : undefined;
  const agent = createKfcAgent({
    model: options.model,
    tools,
    resolveActiveToolNames: resolveCurrentToolNames,
  });
  const execution = await agent.invoke(
    {
      messages: selectedActionMessage
        ? [...messages, selectedActionMessage]
        : messages,
    },
    {
      // LangChain middleware adds internal execution steps around every model
      // and tool call. The explicit model/tool call limits remain the public
      // safety authority; this budget only lets an allowed eight-tool turn
      // reach its structured response.
      recursionLimit: 64,
    },
  );
  const parsed = kfcGroundedPublicationSchema.safeParse(
    execution.structuredResponse,
  );
  if (!parsed.success) throw new Error('kfc_grounded_response_invalid');
  const publication = parsed.data;
  validatePublicationByDefault({
    publication,
    toolCalls: receipts,
    selectedActionResponse: options.selectedActionResponse,
  });
  await options.validatePublication?.({
    publication,
    state,
    toolCalls: receipts,
  });
  const successfulToolNames = receipts.flatMap(({ name, status }) =>
    status === 'success' ? [name] : [],
  );
  const genUi = selectKfcGenUiAttachment({
    state,
    turnToolNames: successfulToolNames,
  });
  return {
    status: pendingConfirmation ? 'confirmation_required' : 'completed',
    responseText: publication.customerText,
    publication,
    state,
    toolCalls: receipts,
    ...(genUi ? { genUi } : {}),
    ...(pendingConfirmation ? { pendingConfirmation } : {}),
  };
}

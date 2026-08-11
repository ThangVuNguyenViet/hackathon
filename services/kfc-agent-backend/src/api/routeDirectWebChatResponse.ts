import type { AgentTurnRunner } from '../agent/agentTurnRunner.js';
import type {
  DirectAgentTurnInput,
  DirectAgentTurnResult,
} from '../agent/directAgentTurn.js';
import type { ConversationTurnMetadata } from '../domain/types.js';
import type { ConversationStore } from '../persistence/contracts.js';
import type { HandlerResponse } from './routeHandlerContracts.js';

export interface DirectWebChatResponseInput {
  sessionId: string;
  customerId: string;
  clientMessageId: string;
  text: string;
  metadata: ConversationTurnMetadata;
}

export function createDirectWebChatResponse<
  TResult extends DirectAgentTurnResult,
>(input: {
  runner: AgentTurnRunner<DirectAgentTurnInput, TResult> | undefined;
  packId: string;
  unconfiguredErrorCode: string;
  store: ConversationStore;
}) {
  return async (turn: DirectWebChatResponseInput): Promise<HandlerResponse> => {
    if (!input.runner) {
      return {
        status: 503,
        body: { errorCode: input.unconfiguredErrorCode },
      };
    }
    const { result } = await input.runner.run({
      packId: input.packId,
      turn: {
        sessionId: turn.sessionId,
        customerId: turn.customerId,
        transport: 'web_chat',
        text: turn.text,
        externalMessageId: turn.clientMessageId,
        metadata: turn.metadata,
      },
    });
    await input.store.updateTurnDeliveryStatus(
      result.assistantTurnId,
      'sent',
      null,
    );
    return {
      status: 200,
      body: {
        agentRuntime: 'openai-responses',
        status: 'completed',
        sessionId: turn.sessionId,
        customerId: turn.customerId,
        userTurnId: result.userTurnId,
        assistantTurnId: result.assistantTurnId,
        responseText: result.responseText,
        presentation: {
          profile: 'text',
          text: result.responseText,
        },
        usage: result.usage,
        replayed: false,
      },
    };
  };
}

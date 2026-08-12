import type { ConversationTurnMetadata } from '../domain/types.js';
import type { HandlerResponse } from './routeHandlerContracts.js';
import { pvcfcChatPayloadSchema } from './pvcfcChatPayload.js';

type AgentResponse = (input: {
  sessionId: string;
  customerId: string;
  clientMessageId: string;
  text: string;
  metadata: ConversationTurnMetadata;
}) => Promise<HandlerResponse>;

export function createPvcfcChatHandler(
  agentResponse: AgentResponse,
): (body: unknown) => Promise<HandlerResponse> {
  return async (body: unknown) => {
    const parsed = pvcfcChatPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        body: {
          errorCode: 'invalid_pvcfc_chat_payload',
          issues: parsed.error.issues,
        },
      };
    }

    const auditMetadata = { ...(parsed.data.metadata ?? {}) } as Record<
      string,
      unknown
    >;
    const metadata: ConversationTurnMetadata = {
      rawEvent: { ...auditMetadata, source: 'pvcfc_chat' },
    };
    return agentResponse({
      sessionId: parsed.data.sessionId,
      customerId: parsed.data.customerId,
      clientMessageId: parsed.data.clientMessageId,
      text: parsed.data.text,
      metadata,
    });
  };
}

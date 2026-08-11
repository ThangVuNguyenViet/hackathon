import type { ConversationTurnMetadata } from '../domain/types.js';
import type { RouteAgentRuntime } from './routeAgentRuntime.js';
import {
  pvcfcChatPayloadSchema,
  type HandlerResponse,
} from './routeHandlerContracts.js';

type AgentResponse = RouteAgentRuntime['kfcAgentResponse'];

function responseProfile(metadata: Record<string, unknown> | undefined) {
  const rawProfile =
    metadata?.responseProfile ?? metadata?.showcaseResponseMode;
  return rawProfile === 'text' || rawProfile === 'social'
    ? ('social' as const)
    : rawProfile === 'genui'
      ? ('genui' as const)
      : undefined;
}

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
    const profile = responseProfile(auditMetadata);
    const metadata: ConversationTurnMetadata = {
      rawEvent: { ...auditMetadata, source: 'pvcfc_chat' },
      ...(profile ? { responseProfile: profile } : {}),
    };
    return agentResponse({
      businessId: 'pvcfc',
      sessionId: parsed.data.sessionId,
      customerId: parsed.data.customerId,
      clientMessageId: parsed.data.clientMessageId,
      text: parsed.data.text,
      metadata,
    });
  };
}

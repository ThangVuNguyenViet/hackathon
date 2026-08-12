import type { FastifyInstance } from 'fastify';
import { AgentTurnRunner } from '../agent/agentTurnRunner.js';
import { PvcfcAgentPack } from '../businesses/pvcfc/pack.js';
import type { ConversationTurnMetadata } from '../domain/types.js';
import { MemoryStore } from '../persistence/memoryStore.js';
import type { ConversationStore } from '../persistence/contracts.js';
import { createPvcfcChatHandler } from './pvcfcChatHandler.js';
import type { HandlerResponse, RouteOptions } from './routeHandlerContracts.js';

export function registerPvcfcRoutes(
  server: FastifyInstance,
  options: RouteOptions,
): void {
  const respond = createPvcfcRouteResponder(options);
  server.post('/chat/pvcfc/message', async (request, reply) => {
    const response = await respond(request.body);
    return reply.code(response.status).send(response.body);
  });
}

export function createPvcfcAgentTurnRunner(
  options: RouteOptions,
  store: ConversationStore,
) {
  if (options.pvcfcAgentModel && !options.pvcfcPublicDataProvider) {
    throw new Error('pvcfc_public_data_provider_not_configured');
  }
  return options.pvcfcAgentModel && options.pvcfcPublicDataProvider
    ? new AgentTurnRunner({
        packs: [
          new PvcfcAgentPack({
            store,
            model: options.pvcfcAgentModel,
            provider: options.pvcfcPublicDataProvider,
            ...(options.pvcfcWebEvidenceClient
              ? {
                  webEvidence: {
                    client: options.pvcfcWebEvidenceClient,
                  },
                }
              : {}),
          }),
        ],
        expectedPackIds: ['pvcfc'],
      })
    : undefined;
}

export function createPvcfcRouteResponder(options: RouteOptions) {
  const store = options.store ?? new MemoryStore();
  const runner = createPvcfcAgentTurnRunner(options, store);
  const inFlight = new Map<
    string,
    {
      customerId: string;
      text: string;
      operation: Promise<HandlerResponse<Record<string, unknown>>>;
    }
  >();
  return createPvcfcChatHandler(async (input) => {
    const requestKey = JSON.stringify([input.sessionId, input.clientMessageId]);
    const pending = inFlight.get(requestKey);
    if (pending) {
      if (
        pending.customerId !== input.customerId ||
        pending.text !== input.text
      ) {
        return { status: 409, body: { errorCode: 'idempotency_conflict' } };
      }
      const response = await pending.operation;
      return response.status === 200
        ? { ...response, body: { ...response.body, replayed: true } }
        : response;
    }
    const operation = (async (): Promise<
      HandlerResponse<Record<string, unknown>>
    > => {
      if (!runner) {
        return {
          status: 503,
          body: { errorCode: 'pvcfc_agent_not_configured' },
        };
      }
      const existingUserTurn = await store.findTurnByExternalMessage(
        input.sessionId,
        input.clientMessageId,
      );
      if (existingUserTurn) {
        if (
          existingUserTurn.role !== 'user' ||
          existingUserTurn.text !== input.text ||
          existingUserTurn.externalUserId !== input.customerId
        ) {
          return { status: 409, body: { errorCode: 'idempotency_conflict' } };
        }
        const assistantTurn = (await store.listTurns(input.sessionId)).find(
          ({ role, metadata }) =>
            role === 'assistant' &&
            metadata?.rawEvent?.pvcfcRequestUserTurnId === existingUserTurn.id,
        );
        if (assistantTurn) {
          return {
            status: 200,
            body: {
              agentRuntime: 'langchain-create-agent',
              status: 'completed',
              sessionId: input.sessionId,
              customerId: input.customerId,
              userTurnId: existingUserTurn.id,
              assistantTurnId: assistantTurn.id,
              responseText: assistantTurn.text,
              presentation: { profile: 'text', text: assistantTurn.text },
              replayed: true,
            },
          };
        }
        return {
          status: 409,
          body: { errorCode: 'pvcfc_request_in_progress' },
        };
      }
      try {
        const result = await runner.run({
          packId: 'pvcfc',
          turn: {
            sessionId: input.sessionId,
            customerId: input.customerId,
            transport: 'web_chat',
            text: input.text,
            externalMessageId: input.clientMessageId,
            metadata: input.metadata as ConversationTurnMetadata,
          },
        });
        await store.updateTurnDeliveryStatus(
          result.assistantTurnId,
          'sent',
          null,
        );
        return {
          status: 200,
          body: {
            agentRuntime: 'langchain-create-agent',
            status: 'completed',
            sessionId: input.sessionId,
            customerId: input.customerId,
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
      } catch {
        return { status: 503, body: { errorCode: 'pvcfc_agent_failed' } };
      }
    })();
    const active = {
      customerId: input.customerId,
      text: input.text,
      operation,
    };
    inFlight.set(requestKey, active);
    try {
      return await operation;
    } finally {
      if (inFlight.get(requestKey) === active) inFlight.delete(requestKey);
    }
  });
}

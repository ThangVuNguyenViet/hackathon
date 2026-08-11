import type { FastifyInstance } from 'fastify';
import { AgentTurnRunner } from '../agent/agentTurnRunner.js';
import { PvcfcAgentPack } from '../businesses/pvcfc/pack.js';
import type { ConversationTurnMetadata } from '../domain/types.js';
import { MemoryStore } from '../persistence/memoryStore.js';
import { createPvcfcChatHandler } from './pvcfcChatHandler.js';
import type { RouteOptions } from './routeHandlerContracts.js';

export function registerPvcfcRoutes(
  server: FastifyInstance,
  options: RouteOptions,
): void {
  const store = options.store ?? new MemoryStore();
  if (options.pvcfcAgentModel && !options.pvcfcPublicDataProvider) {
    throw new Error('pvcfc_public_data_provider_not_configured');
  }
  const runner =
    options.pvcfcAgentModel && options.pvcfcPublicDataProvider
      ? new AgentTurnRunner({
          packs: [
            new PvcfcAgentPack({
              store,
              model: options.pvcfcAgentModel,
              provider: options.pvcfcPublicDataProvider,
            }),
          ],
          expectedPackIds: ['pvcfc'],
        })
      : undefined;
  const respond = createPvcfcChatHandler(async (input) => {
    if (!runner) {
      return {
        status: 503,
        body: { errorCode: 'pvcfc_agent_not_configured' },
      };
    }
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
    await store.updateTurnDeliveryStatus(result.assistantTurnId, 'sent', null);
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
  });

  server.post('/chat/pvcfc/message', async (request, reply) => {
    const response = await respond(request.body);
    return reply.code(response.status).send(response.body);
  });
}

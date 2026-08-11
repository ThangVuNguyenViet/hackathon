import { AgentTurnRunner } from '../agent/agentTurnRunner.js';
import {
  KfcAgentPack,
  type KfcDirectAgentTurnInput,
  type KfcDirectAgentTurnResult,
} from '../agent/kfcAgentPack.js';
import type { DirectAgentTurnInput } from '../agent/directAgentTurn.js';
import type { ExternalClients } from '../clients/interfaces.js';
import type {
  ConversationTurnMetadata,
  CustomerAccessContext,
} from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import type { ConversationStore } from '../persistence/contracts.js';
import {
  PvcfcAgentPack,
  type PvcfcAgentTurnInput,
  type PvcfcAgentTurnResult,
} from '../businesses/pvcfc/pack.js';
import type { RouteOptions } from './routeHandlerContracts.js';

export interface RouteDirectAgentTurnRunners {
  kfc?: AgentTurnRunner<KfcDirectAgentTurnInput, KfcDirectAgentTurnResult>;
  pvcfc?: AgentTurnRunner<PvcfcAgentTurnInput, PvcfcAgentTurnResult>;
}

export function createRouteDirectAgentTurnRunners(input: {
  options: RouteOptions;
  store: ConversationStore;
  getFixtures(): Promise<GeneratedFixtures>;
  createKfcClients(
    sessionId: string,
    metadata: ConversationTurnMetadata | null,
  ): Promise<ExternalClients>;
  getKfcAccessContext(
    sessionId: string,
    customerId: string,
  ): Promise<CustomerAccessContext | undefined>;
}): RouteDirectAgentTurnRunners {
  if (input.options.pvcfcAgent && !input.options.pvcfcPublicDataProvider) {
    throw new Error('pvcfc_public_data_provider_not_configured');
  }
  const kfcPack = input.options.openAiAgent
    ? new KfcAgentPack({
        store: input.store,
        openAiAgent: input.options.openAiAgent,
        getFixtures: input.getFixtures,
        createClients: input.createKfcClients,
        getAccessContext: input.getKfcAccessContext,
      })
    : undefined;
  const pvcfcPack =
    input.options.pvcfcAgent && input.options.pvcfcPublicDataProvider
      ? new PvcfcAgentPack({
          store: input.store,
          openAiAgent: input.options.pvcfcAgent,
          provider: input.options.pvcfcPublicDataProvider,
        })
      : undefined;
  return {
    ...(kfcPack
      ? {
          kfc: new AgentTurnRunner({
            packs: [kfcPack],
            expectedPackIds: ['kfc'],
          }),
        }
      : {}),
    ...(pvcfcPack
      ? {
          pvcfc: new AgentTurnRunner({
            packs: [pvcfcPack],
            expectedPackIds: ['pvcfc'],
          }),
        }
      : {}),
  };
}

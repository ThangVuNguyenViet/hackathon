import { AgentTurnRunner } from '../agent/agentTurnRunner.js';
import {
  KfcAgentPack,
  type DirectAgentTurnInput,
  type DirectAgentTurnResult,
} from '../agent/kfcAgentPack.js';
import type { ExternalClients } from '../clients/interfaces.js';
import type {
  ConversationTurnMetadata,
  CustomerAccessContext,
} from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import type { ConversationStore } from '../persistence/contracts.js';
import { PvcfcAgentPack } from '../businesses/pvcfc/pack.js';
import { loadBundledPvcfcPublicDataProvider } from '../businesses/pvcfc/public-data/bundledPvcfcPublicDataProvider.js';
import type { RouteOptions } from './routeHandlerContracts.js';

export function createRouteDirectAgentTurnRunner(input: {
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
}): AgentTurnRunner<DirectAgentTurnInput, DirectAgentTurnResult> | undefined {
  const packs = [
    ...(input.options.openAiAgent
      ? [
          new KfcAgentPack({
            store: input.store,
            openAiAgent: input.options.openAiAgent,
            getFixtures: input.getFixtures,
            createClients: input.createKfcClients,
            getAccessContext: input.getKfcAccessContext,
          }),
        ]
      : []),
    ...(input.options.pvcfcAgent
      ? [
          new PvcfcAgentPack({
            store: input.store,
            openAiAgent: input.options.pvcfcAgent,
            provider: loadBundledPvcfcPublicDataProvider(),
          }),
        ]
      : []),
  ];
  return packs.length === 0
    ? undefined
    : new AgentTurnRunner({
        packs,
        expectedPackIds: packs.map(({ id }) => id),
      });
}

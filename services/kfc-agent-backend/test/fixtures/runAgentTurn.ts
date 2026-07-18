import {
  runAgentTurn as runProductionAgentTurn,
  type AgentTurnInput,
} from '../../src/graph/buildGraph.js';
import { createTestResponseComposer, testResponseComposer } from './testResponseComposer.js';

export type { AgentTurnInput } from '../../src/graph/buildGraph.js';

export function runAgentTurn(input: AgentTurnInput, modelCandidate?: string) {
  return runProductionAgentTurn({
    responseComposer: modelCandidate
      ? createTestResponseComposer(modelCandidate, true)
      : testResponseComposer,
    ...input,
  });
}

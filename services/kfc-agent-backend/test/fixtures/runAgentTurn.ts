import {
  runAgentTurn as runProductionAgentTurn,
  type AgentTurnInput,
} from '../../src/graph/buildGraph.js';
import { intentTestResponseComposer } from './testResponseComposer.js';

export type { AgentTurnInput } from '../../src/graph/buildGraph.js';

export function runAgentTurn(input: AgentTurnInput) {
  return runProductionAgentTurn({
    responseComposer: intentTestResponseComposer,
    ...input,
  });
}

import { enableInMemoryAgentTurnCheckpointsForTests } from '../src/graph/buildGraph.js';

// Unrelated deterministic integration tests use fixed response sequences. Keep the optional
// submitted-order classifier disabled unless a test or live command explicitly opts into it.
process.env.OPENAI_TOOL_PLANNER_FAST_MODEL ??= process.env.OPENAI_TOOL_PLANNER_MODEL?.trim() || 'gpt-4.1';

enableInMemoryAgentTurnCheckpointsForTests();

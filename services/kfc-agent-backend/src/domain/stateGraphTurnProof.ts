import { z } from 'zod';

export const STATEGRAPH_TURN_PROOF_BINDING_SCHEMA_VERSION =
  'kfc-stategraph-turn-proof-binding-v1' as const;
export const STATEGRAPH_TURN_PROOF_RUNTIME_ID =
  'langgraph-stategraph-v1' as const;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

/**
 * Digest-only link between one persisted assistant presentation and the exact
 * StateGraph run that authored it. It contains no customer or model prose.
 */
export const stateGraphTurnProofBindingSchema = z.object({
  schemaVersion: z.literal(
    STATEGRAPH_TURN_PROOF_BINDING_SCHEMA_VERSION,
  ),
  runtimeId: z.literal(STATEGRAPH_TURN_PROOF_RUNTIME_ID),
  currentTurnId: z.string().min(1).max(256),
  checkpointRunId: z.string().min(1).max(512),
  checkpointThreadId: z.string().min(1).max(512),
  checkpointNamespace: z.literal(''),
  modelResponseDigest: digestSchema,
  presentationDigest: digestSchema,
}).strict();

export type StateGraphTurnProofBinding = z.infer<
  typeof stateGraphTurnProofBindingSchema
>;

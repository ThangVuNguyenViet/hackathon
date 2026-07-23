import type { AgentTurnInput } from '../graph/agentTurnState.js';
import { stateRevision } from '../graph/turnSupport.js';
import {
  agentCheckpointRunId,
  agentCheckpointThreadId,
  langGraphConfigForRun,
} from '../session/sessionContext.js';
import {
  STATEGRAPH_TURN_PROOF_BINDING_SCHEMA_VERSION,
  STATEGRAPH_TURN_PROOF_RUNTIME_ID,
  type StateGraphTurnProofBinding,
} from '../domain/stateGraphTurnProof.js';

interface CheckpointCoordinates {
  checkpointRunId: string;
  checkpointThreadId: string;
}

function checkpointCoordinatesForTurn(
  input: AgentTurnInput,
): CheckpointCoordinates {
  const resumedCheckpoint = input.confirmationResume?.checkpoint;
  if (resumedCheckpoint) {
    const checkpointRunId = agentCheckpointRunId(
      resumedCheckpoint.threadId,
      input.sessionId,
    );
    if (
      resumedCheckpoint.namespace !== '' ||
      !checkpointRunId ||
      (
        input.checkpointRunId !== undefined &&
        input.checkpointRunId !== checkpointRunId
      )
    ) {
      throw new Error('stategraph_turn_proof_checkpoint_invalid');
    }
    return {
      checkpointRunId,
      checkpointThreadId: resumedCheckpoint.threadId,
    };
  }
  const checkpointRunId = input.checkpointRunId;
  if (!checkpointRunId?.trim()) {
    throw new Error('stategraph_turn_proof_checkpoint_missing');
  }
  const logical = langGraphConfigForRun(
    input.sessionId,
    checkpointRunId,
  ).configurable;
  return {
    checkpointRunId,
    checkpointThreadId: agentCheckpointThreadId({
      threadId: logical.thread_id,
      namespace: logical.checkpoint_ns,
    }),
  };
}

export async function createStateGraphTurnProofBinding(input: {
  turnInput: AgentTurnInput;
  currentTurnId: string;
  modelResponseText: string;
  presentationText: string;
}): Promise<StateGraphTurnProofBinding> {
  if (!input.currentTurnId.trim()) {
    throw new Error('stategraph_turn_proof_current_turn_missing');
  }
  const [modelResponseDigest, presentationDigest] = await Promise.all([
    stateRevision(input.modelResponseText),
    stateRevision(input.presentationText),
  ]);
  const checkpoint = checkpointCoordinatesForTurn(input.turnInput);
  return {
    schemaVersion: STATEGRAPH_TURN_PROOF_BINDING_SCHEMA_VERSION,
    runtimeId: STATEGRAPH_TURN_PROOF_RUNTIME_ID,
    currentTurnId: input.currentTurnId,
    checkpointRunId: checkpoint.checkpointRunId,
    checkpointThreadId: checkpoint.checkpointThreadId,
    checkpointNamespace: '',
    modelResponseDigest,
    presentationDigest,
  };
}

import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { ConversationTurn } from '../domain/types.js';
import { stateRevision } from '../graph/turnSupport.js';
import type {
  CheckpointIdentifier,
  ConversationStore,
  StoredEvent,
} from '../persistence/contracts.js';

export interface KfcStateGraphProofSourceSnapshot {
  turns: readonly ConversationTurn[];
  events: readonly StoredEvent[];
  checkpointIdentifiers: readonly CheckpointIdentifier[];
}

export interface ExactCheckpointProofRead {
  identity: CheckpointIdentifier;
  channelValues: unknown;
  sourceDigest: string;
}

export interface KfcStateGraphProofSource {
  readSessionEvidence(
    sessionId: string,
  ): Promise<KfcStateGraphProofSourceSnapshot>;
  readExactCheckpoint(
    identity: CheckpointIdentifier,
  ): Promise<ExactCheckpointProofRead | undefined>;
}

export interface CreateKfcStateGraphProofSourceInput {
  store: Pick<
    ConversationStore,
    'listCheckpointIdentifiers' | 'listEvents' | 'listTurns'
  >;
  checkpointer?: Pick<BaseCheckpointSaver, 'getTuple'>;
}

export function createKfcStateGraphProofSource(
  input: CreateKfcStateGraphProofSourceInput,
): KfcStateGraphProofSource {
  return {
    async readSessionEvidence(sessionId) {
      const [turns, events, checkpointIdentifiers] = await Promise.all([
        input.store.listTurns(sessionId),
        input.store.listEvents(sessionId),
        input.store.listCheckpointIdentifiers(sessionId),
      ]);
      return { turns, events, checkpointIdentifiers };
    },
    async readExactCheckpoint(identity) {
      if (!input.checkpointer) return undefined;
      const tuple = await input.checkpointer.getTuple({
        configurable: {
          thread_id: identity.checkpointThreadId,
          checkpoint_ns: identity.checkpointNamespace,
          checkpoint_id: identity.checkpointId,
        },
      });
      const config = tuple?.config.configurable;
      const parentConfig = tuple?.parentConfig?.configurable;
      const parentMatches = identity.parentCheckpointId === null
        ? tuple?.parentConfig === undefined
        : (
            parentConfig?.thread_id === identity.checkpointThreadId &&
            (parentConfig.checkpoint_ns ?? '') ===
              identity.checkpointNamespace &&
            parentConfig.checkpoint_id === identity.parentCheckpointId
          );
      if (
        tuple?.checkpoint.id !== identity.checkpointId ||
        config?.thread_id !== identity.checkpointThreadId ||
        (config.checkpoint_ns ?? '') !== identity.checkpointNamespace ||
        config.checkpoint_id !== identity.checkpointId ||
        !parentMatches
      ) {
        return undefined;
      }
      const exactIdentity = {
        checkpointThreadId: identity.checkpointThreadId,
        checkpointNamespace: identity.checkpointNamespace,
        checkpointId: identity.checkpointId,
        parentCheckpointId: identity.parentCheckpointId,
      };
      return {
        identity: exactIdentity,
        channelValues: tuple.checkpoint.channel_values,
        sourceDigest: await stateRevision({
          identity: exactIdentity,
          checkpoint: tuple.checkpoint,
        }),
      };
    },
  };
}

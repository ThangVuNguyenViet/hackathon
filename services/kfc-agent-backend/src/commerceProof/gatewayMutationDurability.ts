import {
  restoreCommerceProofGatewayMutationState,
  snapshotCommerceProofGatewayMutationState,
  type CommerceProofGatewayMutationSnapshot,
  type CommerceProofGatewayMutationState,
} from "./gatewayMutationContracts.js";

export type DurableCollection =
  | "ordersByIdempotencyKey"
  | "paymentLinksByIdempotencyKey"
  | "cancellationsByIdempotencyKey";

export interface GatewayMutationDurability {
  isDurable(
    collection: DurableCollection,
    key: string,
    value: unknown,
  ): boolean;
  commitCandidate(input: {
    collection: DurableCollection;
    key: string;
    candidate: unknown;
    publish(): void;
  }): Promise<void>;
  commitStateUpdate<Output>(
    prepare: (candidateState: CommerceProofGatewayMutationState) => {
      output: Output;
      publish(): void;
    },
  ): Promise<Output>;
  persist(): Promise<void>;
}

export function createGatewayMutationDurability(input: {
  state: CommerceProofGatewayMutationState;
  persistSnapshot(
    snapshot: CommerceProofGatewayMutationSnapshot,
  ): Promise<void>;
}): GatewayMutationDurability {
  let durable = signatures(
    snapshotCommerceProofGatewayMutationState(input.state),
  );
  let pendingWrite = Promise.resolve();

  return {
    isDurable(collection, key, value) {
      return durable[collection].get(key) === JSON.stringify(value);
    },
    persist() {
      const write = pendingWrite.then(async () => {
        const snapshot =
          snapshotCommerceProofGatewayMutationState(input.state);
        await input.persistSnapshot(snapshot);
        durable = signatures(snapshot);
      });
      pendingWrite = write.catch(() => {});
      return write;
    },
    commitCandidate(candidateInput) {
      const write = pendingWrite.then(async () => {
        const liveSnapshot =
          snapshotCommerceProofGatewayMutationState(input.state);
        const candidateState = restoreCommerceProofGatewayMutationState(
          replaceCandidate(liveSnapshot, candidateInput),
        );
        const candidateSnapshot =
          snapshotCommerceProofGatewayMutationState(candidateState);
        await input.persistSnapshot(candidateSnapshot);
        durable = signatures(candidateSnapshot);
        candidateInput.publish();
      });
      pendingWrite = write.catch(() => {});
      return write;
    },
    commitStateUpdate(prepare) {
      const write = pendingWrite.then(async () => {
        const candidateState = restoreCommerceProofGatewayMutationState(
          snapshotCommerceProofGatewayMutationState(input.state),
        );
        const candidate = prepare(candidateState);
        const candidateSnapshot =
          snapshotCommerceProofGatewayMutationState(candidateState);
        await input.persistSnapshot(candidateSnapshot);
        durable = signatures(candidateSnapshot);
        candidate.publish();
        return candidate.output;
      });
      pendingWrite = write.then(() => undefined, () => undefined);
      return write;
    },
  };
}

function replaceCandidate(
  snapshot: CommerceProofGatewayMutationSnapshot,
  input: {
    collection: DurableCollection;
    key: string;
    candidate: unknown;
  },
): unknown {
  return {
    ...snapshot,
    [input.collection]: replaceEntry(
      snapshot[input.collection],
      input.key,
      input.candidate,
    ),
  };
}

function replaceEntry(
  entries: ReadonlyArray<readonly [string, unknown]>,
  key: string,
  candidate: unknown,
): Array<readonly [string, unknown]> {
  let replaced = false;
  const next = entries.map(([entryKey, value]) => {
    if (entryKey !== key) return [entryKey, value] as const;
    replaced = true;
    return [entryKey, candidate] as const;
  });
  if (!replaced) throw new Error("gateway_candidate_entry_missing");
  return next;
}

function signatures(snapshot: CommerceProofGatewayMutationSnapshot) {
  return {
    ordersByIdempotencyKey: entrySignatures(
      snapshot.ordersByIdempotencyKey,
    ),
    paymentLinksByIdempotencyKey: entrySignatures(
      snapshot.paymentLinksByIdempotencyKey,
    ),
    cancellationsByIdempotencyKey: entrySignatures(
      snapshot.cancellationsByIdempotencyKey,
    ),
  };
}

function entrySignatures(
  entries: ReadonlyArray<readonly [string, unknown]>,
): Map<string, string | undefined> {
  return new Map(
    entries.map(([key, value]) => [key, JSON.stringify(value)]),
  );
}

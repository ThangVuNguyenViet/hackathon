import { describe, expect, it } from 'vitest';
import { D1Store } from '../../src/persistence/d1Store.js';
import {
  MemoryStore,
  type ConversationStore,
} from '../../src/persistence/memoryStore.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const stores: Array<{
  name: string;
  create: () => Promise<ConversationStore>;
}> = [
  {
    name: 'memory',
    create: async () => new MemoryStore(),
  },
  {
    name: 'D1',
    create: async () => {
      const store = new D1Store(new FakeD1Database());
      await store.initialize();
      return store;
    },
  },
];

for (const storeCase of stores) {
  describe(`${storeCase.name} pending customer turn ignored transition`, () => {
    it('only ignores a pending turn linked to the current failed run and replays idempotently', async () => {
      const store = await storeCase.create();
      const sessionId = `messenger:${storeCase.name}-ignored-cas`;
      const run = await store.createAgentRun({
        id: `run_${storeCase.name}_failed`,
        sessionId,
        generation: 1,
        channel: 'messenger',
        externalUserId: `${storeCase.name}-ignored-cas`,
        status: 'failed',
        coalescedInputText: 'retry-safe terminal failure',
        deliveryStatus: 'failed',
        scheduledAt: '2026-07-22T00:00:00.000Z',
        completedAt: '2026-07-22T00:00:01.000Z',
      });
      await store.setSessionAgentState({
        sessionId,
        currentRunId: run.id,
        generation: run.generation,
        debounceDeadlineAt: null,
      });
      const eligible = await pendingTurn(store, {
        turnId: `pending_${storeCase.name}_eligible`,
        sessionId,
      });
      await store.linkAgentRunTurn({
        runId: run.id,
        turnId: eligible.turnId,
        sequence: 0,
      });

      const ignored = await store.markPendingCustomerTurnIgnored(
        eligible.turnId,
        run.id,
      );
      const replay = await store.markPendingCustomerTurnIgnored(
        eligible.turnId,
        run.id,
      );

      expect(ignored).toMatchObject({
        status: 'ignored',
        claimedRunId: run.id,
      });
      expect(replay).toEqual(ignored);
    });

    it('does not overwrite terminal turns or ignore an ineligible pending turn', async () => {
      const store = await storeCase.create();
      const sessionId = `messenger:${storeCase.name}-ignored-guards`;
      const run = await store.createAgentRun({
        id: `run_${storeCase.name}_guarded`,
        sessionId,
        generation: 1,
        channel: 'messenger',
        externalUserId: `${storeCase.name}-ignored-guards`,
        status: 'failed',
        coalescedInputText: 'guard terminal states',
        deliveryStatus: 'failed',
        scheduledAt: '2026-07-22T00:00:00.000Z',
        completedAt: '2026-07-22T00:00:01.000Z',
      });
      await store.setSessionAgentState({
        sessionId,
        currentRunId: run.id,
        generation: run.generation,
        debounceDeadlineAt: null,
      });
      const claimed = await pendingTurn(store, {
        turnId: `pending_${storeCase.name}_claimed`,
        sessionId,
        status: 'claimed',
        claimedRunId: 'run_prior_claim',
      });
      const ignored = await pendingTurn(store, {
        turnId: `pending_${storeCase.name}_ignored`,
        sessionId,
        status: 'ignored',
        claimedRunId: 'run_prior_ignore',
      });
      const superseded = await pendingTurn(store, {
        turnId: `pending_${storeCase.name}_superseded`,
        sessionId,
        status: 'superseded',
      });
      const unlinked = await pendingTurn(store, {
        turnId: `pending_${storeCase.name}_unlinked`,
        sessionId,
      });
      for (const [sequence, turn] of [claimed, ignored, superseded].entries()) {
        await store.linkAgentRunTurn({
          runId: run.id,
          turnId: turn.turnId,
          sequence,
        });
      }

      await expect(
        store.markPendingCustomerTurnIgnored(claimed.turnId, run.id),
      ).resolves.toMatchObject({
        status: 'claimed',
        claimedRunId: 'run_prior_claim',
      });
      await expect(
        store.markPendingCustomerTurnIgnored(ignored.turnId, run.id),
      ).resolves.toMatchObject({
        status: 'ignored',
        claimedRunId: 'run_prior_ignore',
      });
      await expect(
        store.markPendingCustomerTurnIgnored(superseded.turnId, run.id),
      ).resolves.toMatchObject({
        status: 'superseded',
        claimedRunId: null,
      });
      await expect(
        store.markPendingCustomerTurnIgnored(unlinked.turnId, run.id),
      ).resolves.toMatchObject({
        status: 'pending',
        claimedRunId: null,
      });
    });

    it('requires the linked failed run to remain the session current run', async () => {
      const store = await storeCase.create();
      const sessionId = `messenger:${storeCase.name}-ignored-owner`;
      const failedRun = await store.createAgentRun({
        id: `run_${storeCase.name}_not_current`,
        sessionId,
        generation: 1,
        channel: 'messenger',
        externalUserId: `${storeCase.name}-ignored-owner`,
        status: 'failed',
        coalescedInputText: 'old failed owner',
        deliveryStatus: 'failed',
        scheduledAt: '2026-07-22T00:00:00.000Z',
        completedAt: '2026-07-22T00:00:01.000Z',
      });
      const turn = await pendingTurn(store, {
        turnId: `pending_${storeCase.name}_not_current`,
        sessionId,
      });
      await store.linkAgentRunTurn({
        runId: failedRun.id,
        turnId: turn.turnId,
        sequence: 0,
      });
      await store.setSessionAgentState({
        sessionId,
        currentRunId: null,
        generation: failedRun.generation + 1,
        debounceDeadlineAt: null,
      });

      await expect(
        store.markPendingCustomerTurnIgnored(turn.turnId, failedRun.id),
      ).resolves.toMatchObject({
        status: 'pending',
        claimedRunId: null,
      });
    });

    it('does not ignore a linked pending turn while the current run is nonterminal', async () => {
      const store = await storeCase.create();
      const sessionId = `messenger:${storeCase.name}-ignored-running`;
      const run = await store.createAgentRun({
        id: `run_${storeCase.name}_running`,
        sessionId,
        generation: 1,
        channel: 'messenger',
        externalUserId: `${storeCase.name}-ignored-running`,
        status: 'scheduled',
        coalescedInputText: 'still eligible for execution',
        deliveryStatus: 'pending',
        scheduledAt: '2026-07-22T00:00:00.000Z',
      });
      const turn = await pendingTurn(store, {
        turnId: `pending_${storeCase.name}_running`,
        sessionId,
      });
      await store.linkAgentRunTurn({
        runId: run.id,
        turnId: turn.turnId,
        sequence: 0,
      });
      await store.setSessionAgentState({
        sessionId,
        currentRunId: run.id,
        generation: run.generation,
        debounceDeadlineAt: null,
      });

      await expect(
        store.markPendingCustomerTurnIgnored(turn.turnId, run.id),
      ).resolves.toMatchObject({
        status: 'pending',
        claimedRunId: null,
      });
    });
  });
}

async function pendingTurn(
  store: ConversationStore,
  input: {
    turnId: string;
    sessionId: string;
    status?: 'pending' | 'claimed' | 'ignored' | 'superseded';
    claimedRunId?: string | null;
  },
) {
  const result = await store.upsertPendingCustomerTurn({
    turnId: input.turnId,
    sessionId: input.sessionId,
    channel: 'messenger',
    externalMessageId: `mid_${input.turnId}`,
    externalUserId: input.sessionId.slice('messenger:'.length),
    text: input.turnId,
    steerMode: 'steering',
    status: input.status ?? 'pending',
    claimedRunId: input.claimedRunId ?? null,
    receivedAt: '2026-07-22T00:00:00.000Z',
  });
  return result.turn;
}

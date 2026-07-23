import { describe, expect, it } from 'vitest';
import { defaultAgentTurnDeadlineMs } from '../../src/agent/agentExternalCallScope.js';
import {
  agentTurnDeadlineMs,
  agentTurnPersistenceMarginMs,
  irreversibleOperationLeaseTtlMs,
} from '../../src/agent/agentRuntimeTiming.js';

describe('agent runtime timing', () => {
  it('derives the irreversible-operation lease from the graph deadline and persistence margin', () => {
    expect(agentTurnDeadlineMs).toBe(30_000);
    expect(agentTurnPersistenceMarginMs).toBe(30_000);
    expect(irreversibleOperationLeaseTtlMs).toBe(60_000);
    expect(irreversibleOperationLeaseTtlMs).toBe(
      agentTurnDeadlineMs + agentTurnPersistenceMarginMs,
    );
  });

  it('keeps the external-call deadline compatibility export at the graph deadline', () => {
    expect(defaultAgentTurnDeadlineMs).toBe(agentTurnDeadlineMs);
    expect(defaultAgentTurnDeadlineMs).toBe(30_000);
  });
});

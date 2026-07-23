import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_SAFE_APPROVAL_SCHEMA_VERSION,
  checkpointSafeApprovalInterrupt,
  checkpointSafeApprovalMatchesCall,
  createCheckpointSafeApproval,
  parseCheckpointSafeApprovalInterrupt,
  rehydrateCheckpointSafeApprovalCall,
} from '../../src/agent/checkpointSafeApproval.js';

describe('checkpoint-safe approval', () => {
  const requestId = '00000000-0000-4000-8000-000000000901';
  const privateAction = {
    toolName: 'handoff' as const,
    arguments: {
      reasons: ['private customer escalation detail'],
    },
  };

  it('checkpoints only capability, request identity, and an exact digest', async () => {
    const approval = await createCheckpointSafeApproval({
      requestId,
      call: privateAction,
    });
    const interrupt = checkpointSafeApprovalInterrupt(approval);
    const serialized = JSON.stringify(interrupt);

    expect(interrupt).toEqual({
      actionRequests: [{
        name: 'handoff',
        args: {
          schemaVersion: CHECKPOINT_SAFE_APPROVAL_SCHEMA_VERSION,
          requestId,
          actionDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      }],
    });
    expect(serialized).not.toContain('private customer escalation detail');
    expect(parseCheckpointSafeApprovalInterrupt(interrupt)).toEqual(approval);
  });

  it('rehydrates only the exact canonical action bound by the digest', async () => {
    const approval = await createCheckpointSafeApproval({
      requestId,
      call: privateAction,
    });

    await expect(rehydrateCheckpointSafeApprovalCall({
      approval,
      action: privateAction,
    })).resolves.toEqual({
      id: `approval:${requestId}`,
      ...privateAction,
    });
    await expect(checkpointSafeApprovalMatchesCall({
      approval,
      call: {
        ...privateAction,
        arguments: { reasons: ['different private detail'] },
      },
    })).resolves.toBe(false);
    await expect(rehydrateCheckpointSafeApprovalCall({
      approval,
      action: {
        ...privateAction,
        arguments: { reasons: ['different private detail'] },
      },
    })).rejects.toThrow('agent_confirmation_action_mismatch');
  });

  it('rejects reads and reversible mutations at the approval boundary', async () => {
    await expect(createCheckpointSafeApproval({
      requestId,
      call: {
        toolName: 'searchMenu',
        arguments: { scope: 'all', query: null },
      },
    })).rejects.toThrow('agent_approval_interrupt_invalid');
    await expect(createCheckpointSafeApproval({
      requestId,
      call: {
        toolName: 'updateCart',
        arguments: {
          changes: [{
            itemCode: '20751',
            quantity: 1,
            modifiers: [],
          }],
        },
      },
    })).rejects.toThrow('agent_approval_interrupt_invalid');
  });

  it('rejects legacy interrupts containing raw provider arguments', () => {
    expect(() => parseCheckpointSafeApprovalInterrupt({
      actionRequests: [{
        name: 'handoff',
        args: privateAction.arguments,
      }],
    })).toThrow('agent_approval_interrupt_invalid');
  });
});

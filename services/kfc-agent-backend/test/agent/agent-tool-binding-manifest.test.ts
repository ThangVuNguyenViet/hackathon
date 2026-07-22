import { describe, expect, it } from 'vitest';
import {
  canonicalToolCallSignature,
  classifyToolCallSignature,
  recordSuccessfulToolCall,
} from '../../src/agent/agentToolBindingManifest.js';

describe('canonical tool-call ledger compatibility export', () => {
  it('classifies exact unchanged reads through the compatibility path', async () => {
    const signatureDigest = await canonicalToolCallSignature({
      sessionId: 'session-1',
      customerId: 'customer-1',
      channel: 'kfc',
      toolName: 'searchMenu',
      arguments: { scope: 'all', query: null },
      activeToolNames: ['searchMenu', 'findStores'],
      relevantState: null,
    });
    const entries = recordSuccessfulToolCall([], {
      signatureDigest,
      toolName: 'searchMenu',
      effect: 'provider_read',
      receipt: null,
    });

    expect(
      classifyToolCallSignature({
        entries,
        signatureDigest,
        toolName: 'searchMenu',
        effect: 'provider_read',
      }),
    ).toEqual({ kind: 'no_progress' });
  });
});

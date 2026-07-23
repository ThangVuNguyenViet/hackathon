import { describe, expect, it } from 'vitest';
import {
  buildCommerceApprovalBinding,
  createCommerceApprovalReceipt,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import {
  createCommerceApprovalExecutionFence,
  verifyCommerceApprovalExecutionFence,
  type CommerceApprovalExecutionFence,
  type CommerceApprovalExecutionFenceClaim,
} from '../../src/ordering/approvalExecutionFence.js';

const signingSecret =
  'execution-fence-test-signing-secret-at-least-thirty-two-bytes';
const otherSecret =
  'execution-fence-other-signing-secret-at-least-thirty-two-bytes';

async function fixture() {
  const binding = await buildCommerceApprovalBinding({
    capability: 'handoff',
    principal: {
      sessionId: 'session_1',
      customerId: 'customer_1',
      channel: 'kfc',
      authenticatedSubject: 'customer_1',
      authenticationEvidenceRef: 'verified:test',
    },
    revisions: {
      cartRevision: 'cart:1',
      fulfillmentRevision: 'fulfillment:1',
      paymentRevision: 'payment:1',
      collectionRevision: 'collection:1',
      providerRevision: 'provider:1',
    },
    action: {
      toolName: 'handoff',
      sessionId: 'session_1',
      reasons: ['customer_requested_support'],
    },
  });
  const receipt = await createCommerceApprovalReceipt({
    binding,
    secret: signingSecret,
  });
  const claim: CommerceApprovalExecutionFenceClaim = {
    schemaVersion: 'kfc-commerce-approval-execution-v1',
    operation: 'confirmation_resume',
    requestId: receipt.receiptId,
    expectedSessionGeneration: 4,
    sessionAuthorityGeneration: 9,
    checkpointThreadId: 'agent-thread-session-1',
    checkpointNamespace: '',
    checkpointId: 'checkpoint_1',
    bindingFingerprint: await digestCommerceAction({
      checkpointId: 'checkpoint_1',
      expectedSessionGeneration: 4,
      receipt,
    }),
    approvalBindingDigest: await digestCommerceAction(binding),
    providerIdempotencyKey: [
      'confirmation',
      receipt.receiptId,
      binding.capability,
      binding.actionDigest,
    ].join(':'),
    attempt: 3,
    leaseToken: '00000000-0000-4000-8000-000000000901',
  };
  const fence = await createCommerceApprovalExecutionFence({
    claim,
    secret: signingSecret,
  });
  return { binding, receipt, claim, fence };
}

describe('commerce approval execution fence', () => {
  it('accepts only the coordinator-attested exact durable claim', async () => {
    const { binding, receipt, fence } = await fixture();

    await expect(verifyCommerceApprovalExecutionFence({
      fence,
      receipt,
      binding,
      secret: signingSecret,
    })).resolves.toEqual(fence);
    await expect(verifyCommerceApprovalExecutionFence({
      fence,
      receipt,
      binding,
      secret: otherSecret,
    })).resolves.toBeUndefined();
  });

  it.each([
    [
      'requestId',
      { requestId: '00000000-0000-4000-8000-000000000902' },
    ],
    ['expectedSessionGeneration', { expectedSessionGeneration: 5 }],
    ['sessionAuthorityGeneration', { sessionAuthorityGeneration: 10 }],
    ['checkpointThreadId', { checkpointThreadId: 'agent-thread-session-2' }],
    ['checkpointNamespace', { checkpointNamespace: 'other' }],
    ['checkpointId', { checkpointId: 'checkpoint_2' }],
    ['bindingFingerprint', { bindingFingerprint: 'b'.repeat(64) }],
    ['approvalBindingDigest', { approvalBindingDigest: 'b'.repeat(64) }],
    [
      'providerIdempotencyKey',
      { providerIdempotencyKey: 'confirmation:rebound-provider-key' },
    ],
    ['attempt', { attempt: 4 }],
    [
      'leaseToken',
      { leaseToken: '00000000-0000-4000-8000-000000000903' },
    ],
  ] satisfies Array<
    [
      string,
      Partial<CommerceApprovalExecutionFence>,
    ]
  >)(
    'rejects a fence whose signed %s field was changed',
    async (_field, change) => {
      const { binding, receipt, fence } = await fixture();

      await expect(verifyCommerceApprovalExecutionFence({
        fence: { ...fence, ...change },
        receipt,
        binding,
        secret: signingSecret,
      })).resolves.toBeUndefined();
    },
  );

  it('rejects fabricated and unsigned fences', async () => {
    const { binding, receipt, claim, fence } = await fixture();

    await expect(verifyCommerceApprovalExecutionFence({
      fence: claim,
      receipt,
      binding,
      secret: signingSecret,
    })).resolves.toBeUndefined();
    await expect(verifyCommerceApprovalExecutionFence({
      fence: {
        ...fence,
        signature:
          `${fence.signature.slice(0, -1)}` +
          `${fence.signature.endsWith('0') ? '1' : '0'}`,
      },
      receipt,
      binding,
      secret: signingSecret,
    })).resolves.toBeUndefined();
  });
});

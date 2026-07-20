import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RunCommitFence } from '../../src/persistence/contracts.js';
import {
  authorizeGuestCheckout,
  issueControlledMessengerMockGuestCheckoutAuthority,
  issueVerifiedMessengerGuestCheckoutAuthority,
  verifyMessengerGuestCheckoutIngress,
} from '../../src/security/guestCheckoutAuthority.js';

const appSecret = 'controlled-meta-app-secret';
const pageId = 'controlled-page';

function agentRunFence(
  overrides: Partial<Extract<RunCommitFence, { kind: 'agent_run' }>> = {},
): Extract<RunCommitFence, { kind: 'agent_run' }> {
  return {
    kind: 'agent_run',
    runId: 'run-1',
    generation: 7,
    sessionAuthorityGeneration: 11,
    executionAttempt: 1,
    executionLeaseToken: '1fda8351-6253-4908-b53e-4b88b86dced4',
    ...overrides,
  };
}

function operationFence(
  overrides: Partial<
    Extract<RunCommitFence, { kind: 'operation_lease' }>
  > = {},
): Extract<RunCommitFence, { kind: 'operation_lease' }> {
  return {
    kind: 'operation_lease',
    requestId: 'a3950e30-2e47-465f-84dd-9b3059589236',
    operation: 'confirmation_resume',
    bindingFingerprint: 'a'.repeat(64),
    attempt: 1,
    leaseToken: 'a99a3bc2-f77c-4ee5-b73c-cc0d80021237',
    sessionAuthorityGeneration: 11,
    ...overrides,
  };
}

async function controlledAuthority(input?: {
  issuedAt?: Date;
  ttlMs?: number;
}) {
  return issueControlledMessengerMockGuestCheckoutAuthority({
    sessionId: 'replay_scenario-01',
    customerId: 'scenario_customer',
    externalMessageId: 'scenario-01:11',
    runFence: agentRunFence(),
    ...input,
  });
}

function requirement(input: {
  runFence?: RunCommitFence;
  confirmationResume?: boolean;
  now?: number;
  channel?: 'messenger_mock' | 'kfc';
  sessionId?: string;
  customerId?: string;
  externalMessageId?: string;
  surfaceSubjectRef?: string;
} = {}) {
  return {
    channel: input.channel ?? 'messenger_mock',
    sessionId: input.sessionId ?? 'replay_scenario-01',
    customerId: input.customerId ?? 'scenario_customer',
    externalMessageId:
      input.externalMessageId ?? 'scenario-01:11',
    surfaceSubjectRef:
      input.surfaceSubjectRef ?? 'scenario_customer',
    runFence: input.runFence ?? agentRunFence(),
    ...(input.confirmationResume === undefined
      ? {}
      : { confirmationResume: input.confirmationResume }),
    ...(input.now === undefined ? {} : { now: input.now }),
  } as const;
}

describe('guest checkout authority', () => {
  it('issues a controlled authority only for the exact messenger_mock turn and run', async () => {
    const authority = await controlledAuthority();

    expect(authorizeGuestCheckout(authority, requirement())).toEqual({
      allowed: true,
    });
    expect(authority).toMatchObject({
      authoritySource: 'controlled_messenger_mock',
      channel: 'messenger_mock',
      sessionId: 'replay_scenario-01',
      customerId: 'scenario_customer',
      surfaceSubjectRef: 'scenario_customer',
      externalMessageId: 'scenario-01:11',
      sessionAuthorityGeneration: 11,
    });
    expect(authority.authorityDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(authority.sourceRunFenceDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    ['channel', { channel: 'kfc' as const }],
    ['session', { sessionId: 'replay_other' }],
    ['customer', { customerId: 'other_customer' }],
    ['surface subject', { surfaceSubjectRef: 'other_customer' }],
    ['event', { externalMessageId: 'scenario-01:9' }],
    [
      'session authority generation',
      {
        runFence: agentRunFence({ sessionAuthorityGeneration: 12 }),
      },
    ],
    ['run id', { runFence: agentRunFence({ runId: 'run-2' }) }],
    ['run generation', { runFence: agentRunFence({ generation: 8 }) }],
  ])('rejects a cross-%s authority reuse', async (_label, overrides) => {
    const authority = await controlledAuthority();

    expect(authorizeGuestCheckout(authority, requirement(overrides))).toEqual({
      allowed: false,
      errorCode:
        'runFence' in overrides
          ? 'guest_checkout_run_authority_mismatch'
          : 'guest_checkout_authority_mismatch',
    });
  });

  it('rejects expiry and a structurally valid but unissued clone', async () => {
    const issuedAt = new Date('2026-07-20T00:00:00.000Z');
    const authority = await controlledAuthority({
      issuedAt,
      ttlMs: 60_000,
    });

    expect(authorizeGuestCheckout(
      authority,
      requirement({ now: issuedAt.getTime() + 60_000 }),
    )).toEqual({
      allowed: false,
      errorCode: 'guest_checkout_authority_expired',
    });
    expect(authorizeGuestCheckout(
      structuredClone(authority),
      requirement({ now: issuedAt.getTime() + 1 }),
    )).toEqual({
      allowed: false,
      errorCode: 'guest_checkout_authority_invalid',
    });
  });

  it('accepts only a same-generation durable confirmation resume lease', async () => {
    const authority = await controlledAuthority();

    expect(authorizeGuestCheckout(
      authority,
      requirement({
        runFence: operationFence(),
        confirmationResume: true,
      }),
    )).toEqual({ allowed: true });
    expect(authorizeGuestCheckout(
      authority,
      requirement({
        runFence: operationFence({ sessionAuthorityGeneration: 12 }),
        confirmationResume: true,
      }),
    )).toEqual({
      allowed: false,
      errorCode: 'guest_checkout_run_authority_mismatch',
    });
    expect(authorizeGuestCheckout(
      authority,
      requirement({
        runFence: agentRunFence(),
        confirmationResume: true,
      }),
    )).toEqual({
      allowed: false,
      errorCode: 'guest_checkout_run_authority_mismatch',
    });
  });

  it('issues production authority only from a verified Meta raw-body HMAC', async () => {
    const body = JSON.stringify({
      object: 'page',
      entry: [{
        id: pageId,
        time: Date.parse('2026-07-20T00:00:00.000Z'),
        messaging: [{
          sender: { id: 'psid-1' },
          recipient: { id: pageId },
          timestamp: Date.parse('2026-07-20T00:00:00.000Z'),
          message: { mid: 'mid-1', text: 'Xác nhận đơn' },
        }],
      }],
    });
    const rawBody = new TextEncoder().encode(body);
    const signature =
      `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
    const verified = await verifyMessengerGuestCheckoutIngress({
      rawBody,
      signatureHeader: signature,
      appSecret,
      pageId,
    });
    expect(verified).toHaveLength(1);
    const authority = await issueVerifiedMessengerGuestCheckoutAuthority({
      ingress: verified[0]!,
      runFence: agentRunFence(),
    });
    expect(authority).toMatchObject({
      authoritySource: 'verified_messenger_ingress',
      channel: 'messenger',
      sessionId: 'messenger:psid-1',
      customerId: 'psid-1',
      surfaceSubjectRef: 'psid-1',
      externalThreadRef: 'psid-1',
      externalMessageId: 'mid-1',
    });

    await expect(verifyMessengerGuestCheckoutIngress({
      rawBody,
      signatureHeader: `sha256=${'0'.repeat(64)}`,
      appSecret,
      pageId,
    })).resolves.toEqual([]);
    await expect(issueVerifiedMessengerGuestCheckoutAuthority({
      ingress: structuredClone(verified[0]!),
      runFence: agentRunFence(),
    })).rejects.toThrow('guest_checkout_verified_ingress_required');
  });
});

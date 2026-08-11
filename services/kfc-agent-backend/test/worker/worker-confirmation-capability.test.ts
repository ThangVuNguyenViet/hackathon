import { describe, expect, it } from 'vitest';
import worker, { type WorkerEnv } from '../../src/worker.js';
import {
  createConfirmationApprovalKeyRing,
  issueConfirmationApprovalCapability,
} from '../../src/api/confirmationApprovalCapability.js';
import type {
  CustomerAccessContext,
} from '../../src/domain/types.js';
import {
  buildCommerceApprovalBinding,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import type {
  CommerceApprovalPrincipal,
} from '../../src/ordering/types.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import type {
  CreateConfirmationPauseInput,
} from '../../src/persistence/contracts.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const signingSecret =
  'worker-confirmation-capability-secret-more-than-32-bytes';

function workerEnv(database: FakeD1Database): WorkerEnv {
  return {
    DB: database,
    MESSENGER_VERIFY_TOKEN: 'worker_verify',
    META_PAGE_ID: 'worker_page',
    META_APP_SECRET: 'worker_meta_secret',
    META_PAGE_ACCESS_TOKEN: 'worker_page_token',
    ZALO_OA_ID: 'worker_zalo',
    ZALO_ACCESS_TOKEN: 'worker_zalo_token',
    KFC_AGENT_PROVIDER: 'google',
    GOOGLE_API_KEY: 'worker_google_key',
    OPENAI_API_KEY: 'worker_openai_key',
    KFC_COMMERCE_MODE: 'fixture',
    KFC_CONFIRMATION_SIGNING_KEY_ID: 'worker-primary',
    KFC_CONFIRMATION_SIGNING_SECRET: signingSecret,
    RELEASE_GIT_SHA: 'worker-capability-sha',
    RELEASE_DEPLOYMENT_ID: 'worker-capability-deployment',
    RELEASE_BUILT_AT: '2026-07-20T00:00:00.000Z',
    RELEASE_DIRTY: 'false',
  };
}

function principal(input: {
  sessionId: string;
  customerId: string;
  evidenceRef: string;
}): CommerceApprovalPrincipal {
  return {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: 'kfc',
    authenticatedSubject: input.customerId,
    authenticationEvidenceRef: input.evidenceRef,
  };
}

async function createPause(input: {
  store: D1Store;
  requestId: string;
  sessionId: string;
  customerId: string;
  evidenceRef: string;
  actionId: string;
}): Promise<void> {
  const approvalPrincipal = principal(input);
  const action = { toolName: 'placeOrder' as const, arguments: {} };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: action.toolName,
    principal: approvalPrincipal,
    action,
    revisions: {
      cartRevision: `cart:${input.requestId}`,
      fulfillmentRevision: `fulfillment:${input.requestId}`,
      paymentRevision: `payment:${input.requestId}`,
      collectionRevision: `collection:${input.requestId}`,
      providerRevision: `provider:${input.requestId}`,
    },
  });
  const now = Date.now();
  const pause: CreateConfirmationPauseInput = {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: input.requestId,
    sourceTurnId:
      `agent:${JSON.stringify([
        input.sessionId,
        `run:worker:${input.requestId}`,
      ])}`,
    actionScope: '',
    actionId: input.actionId,
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: 'kfc',
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest:
      await digestCommerceAction(approvalBinding),
    principal: approvalPrincipal,
    createdAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 10 * 60_000).toISOString(),
  };
  expect(await input.store.createConfirmationPause(pause))
    .toMatchObject({ status: 'created' });
}

function accessContext(input: {
  sessionId: string;
  customerId: string;
  evidenceRef: string;
}): CustomerAccessContext {
  return {
    tenantScope: 'kfc-vietnam',
    customerSurface: 'kfc-app-chat',
    sessionRef: input.sessionId,
    surfaceSubjectRef: 'not-applicable',
    kfcSubjectRef: input.customerId,
    authenticationState: 'authenticated',
    membershipState: 'member',
    channelAccountLinkState: 'not-applicable',
    subjectBindingState: 'verified',
    authenticationEvidence: {
      state: 'verified',
      method: 'worker-test',
      issuer: 'kfc-agent-backend',
      audience: 'kfc-agent-backend',
      authenticatedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      evidenceRef: input.evidenceRef,
    },
    authorizedScopes: ['order:write'],
  };
}

function resumeRequest(payload: unknown): Request {
  return new Request(
    'https://worker.local/chat/kfc/confirmations/resume',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

describe('Worker confirmation approval capability boundary', () => {
  it('rejects a missing capability through the public Worker route', async () => {
    const response = await worker.fetch(
      resumeRequest({
        requestId: crypto.randomUUID(),
        decision: 'approve',
      }),
      workerEnv(new FakeD1Database()),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      errorCode: 'invalid_confirmation_resume',
    });
  });

  it('rejects tampered and cross-pause capabilities before execution', async () => {
    const database = new FakeD1Database();
    const store = new D1Store(database);
    await store.initialize();
    const first = {
      requestId: crypto.randomUUID(),
      sessionId: 'kfc:worker_capability_first',
      customerId: 'worker_capability_first',
      evidenceRef: 'worker-evidence-first',
      actionId: 'worker-checkpoint-first',
    };
    const second = {
      requestId: crypto.randomUUID(),
      sessionId: 'kfc:worker_capability_second',
      customerId: 'worker_capability_second',
      evidenceRef: 'worker-evidence-second',
      actionId: 'worker-checkpoint-second',
    };
    await createPause({ store, ...first });
    await createPause({ store, ...second });
    const snapshot =
      await store.getConfirmationPauseStorageSnapshot(first.requestId);
    if (!snapshot) throw new Error('worker pause snapshot missing');
    const keyRing = createConfirmationApprovalKeyRing({
      active: { keyId: 'worker-primary', secret: signingSecret },
    });
    const issued = await issueConfirmationApprovalCapability({
      snapshot,
      accessContext: accessContext(first),
      keyRing,
    });
    const replacement = issued.approvalCapability.endsWith('A')
      ? 'B'
      : 'A';
    const tamperedCapability =
      issued.approvalCapability.slice(0, -1) + replacement;

    const [tampered, crossed] = await Promise.all([
      worker.fetch(
        resumeRequest({
          requestId: first.requestId,
          decision: 'approve',
          approvalCapability: tamperedCapability,
        }),
        workerEnv(database),
      ),
      worker.fetch(
        resumeRequest({
          requestId: second.requestId,
          decision: 'approve',
          approvalCapability: issued.approvalCapability,
        }),
        workerEnv(database),
      ),
    ]);

    expect(tampered.status).toBe(403);
    expect(await tampered.json()).toEqual({
      errorCode: 'approval_capability_invalid',
    });
    expect(crossed.status).toBe(403);
    expect(await crossed.json()).toEqual({
      errorCode: 'approval_capability_invalid',
    });
    expect(
      await store.getConfirmationPauseStorageSnapshot(first.requestId),
    ).toMatchObject({ record: { status: 'pending' } });
    expect(
      await store.getConfirmationPauseStorageSnapshot(second.requestId),
    ).toMatchObject({ record: { status: 'pending' } });
  });
});

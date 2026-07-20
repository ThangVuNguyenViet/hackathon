import { describe, expect, it } from 'vitest';
import {
  projectKfcLifecycleProofEvidence,
} from '../../src/proof/kfcLifecycleProofEvidence.js';

function source() {
  return {
    instance: {
      instanceId: 'lifecycle-proof',
      environment: 'sandbox',
      scenarioDefinitionVersion: 'scenario-v1',
      releaseId: 'release-proof',
      catalogObservationId: 'catalog-proof',
      catalogHash: 'a'.repeat(64),
      customerBinding: 'PRIVATE_CUSTOMER_BINDING',
      sessionBinding: 'PRIVATE_SESSION_BINDING',
      paymentPolicy: 'prepaid',
      fulfillmentPolicy: 'delivery',
      logicalTime: 10,
      expiresAt: 20,
      revision: 2,
      state: {
        payment: {
          attemptId: 'PRIVATE_PAYMENT_ATTEMPT',
          status: 'paid',
          orderId: 'PRIVATE_ORDER_ID',
        },
        order: {
          status: 'accepted',
          orderId: 'PRIVATE_ORDER_ID',
        },
        delivery: null,
      },
      sealedAt: null,
      resetFrom: 'PRIVATE_RESET_INSTANCE',
    },
    audit: [{
      revision: 2,
      eventId: 'lifecycle-event-proof',
      eventType: 'payment_paid',
      outcome: 'committed',
      priorRevision: 1,
      createdAt: '2026-07-20T00:00:00.000Z',
    }],
  };
}

describe('KFC lifecycle proof evidence', () => {
  it('projects capped status evidence without private bindings or raw ids', () => {
    const projection = projectKfcLifecycleProofEvidence(source());

    expect(projection).toMatchObject({
      complete: true,
      missing: [],
      instance: {
        instanceId: 'lifecycle-proof',
        revision: 2,
        state: {
          paymentStatus: 'paid',
          orderStatus: 'accepted',
          deliveryStatus: null,
        },
      },
      audit: [{
        eventId: 'lifecycle-event-proof',
        eventType: 'payment_paid',
        outcome: 'committed',
      }],
    });
    const serialized = JSON.stringify(projection);
    for (const privateValue of [
      'PRIVATE_CUSTOMER_BINDING',
      'PRIVATE_SESSION_BINDING',
      'PRIVATE_PAYMENT_ATTEMPT',
      'PRIVATE_ORDER_ID',
      'PRIVATE_RESET_INSTANCE',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('fails closed without partial evidence for malformed or oversized input', () => {
    const malformed = source();
    malformed.audit[0]!.outcome = 'invented';
    const oversized = source();
    oversized.audit = Array.from(
      { length: 257 },
      () => oversized.audit[0]!,
    );

    for (const input of [malformed, oversized]) {
      expect(projectKfcLifecycleProofEvidence(input)).toEqual({
        complete: false,
        missing: ['lifecycle_evidence'],
        instance: null,
        audit: [],
      });
    }
  });

  it('distinguishes missing instance and audit evidence', () => {
    expect(projectKfcLifecycleProofEvidence({
      instance: null,
      audit: [],
    })).toEqual({
      complete: false,
      missing: ['lifecycle_instance', 'lifecycle_audit'],
      instance: null,
      audit: [],
    });
  });
});

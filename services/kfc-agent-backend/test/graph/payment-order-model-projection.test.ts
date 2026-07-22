import { describe, expect, it } from 'vitest';
import {
  agentToolResultForModel,
} from '../../src/graph/orderStatusEvidenceProjection.js';

describe('payment order model projection', () => {
  it('strips the server-only create-link order binding', () => {
    const projected = agentToolResultForModel({
      toolName: 'createPaymentLink',
      ok: true,
      value: {
        orderId: 'server-private-order-binding',
        url: 'https://pay.example/current',
        status: 'pending',
      },
      message: 'verified payment result',
      provenance: [],
    });

    expect(projected).toMatchObject({
      toolName: 'createPaymentLink',
      ok: true,
      value: {
        url: 'https://pay.example/current',
        status: 'pending',
      },
    });
    expect(JSON.stringify(projected)).not.toContain(
      'server-private-order-binding',
    );
  });

  it('strips the server-only status-check order binding', () => {
    const projected = agentToolResultForModel({
      toolName: 'checkPaymentStatus',
      ok: true,
      value: {
        orderId: 'server-private-order-binding',
        status: 'failed',
      },
      message: 'verified payment result',
      provenance: [],
    });

    expect(projected).toMatchObject({
      toolName: 'checkPaymentStatus',
      ok: true,
      value: {
        status: 'failed',
      },
    });
    expect(JSON.stringify(projected)).not.toContain(
      'server-private-order-binding',
    );
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workerSource = readFileSync(
  new URL('../../src/worker.ts', import.meta.url),
  'utf8',
);
const ingressSource = readFileSync(
  new URL('../../src/workerMessaging.ts', import.meta.url),
  'utf8',
);
const consumerSource = readFileSync(
  new URL('../../src/workerMessengerIngress.ts', import.meta.url),
  'utf8',
);

describe('Messenger Queue architecture boundary', () => {
  it('keeps raw provider authentication material out of queue job contracts', () => {
    const jobContracts = workerSource.slice(
      workerSource.indexOf('export interface MessengerWebhookJob'),
      workerSource.indexOf('export interface WorkerEnv'),
    );

    expect(jobContracts).not.toMatch(
      /rawBodyBytes|signatureHeader|messengerIngressProof/u,
    );
    expect(ingressSource).not.toMatch(
      /rawBodyBytes|Array\.from\(rawBody\)|messengerIngressProof/u,
    );
  });

  it('verifies Meta HMAC once before issuing compact event claims', () => {
    expect(
      ingressSource.match(/await verifyMetaWebhookSignature\(/gu),
    ).toHaveLength(1);
    expect(ingressSource).not.toContain('verifyMessengerGuestCheckoutIngress');
    expect(ingressSource).toContain('issueMessengerIngressClaim');
  });

  it('reloads reserved webhook records before queue claim verification', () => {
    expect(workerSource).toContain(
      "getWebhookDelivery(\n            'messenger'",
    );
    expect(workerSource).toContain('verifyQueuedMessengerIngress');
    expect(consumerSource).toContain(
      'eventFromReservedMessengerDelivery(input.delivery)',
    );
    expect(consumerSource).toContain('verifyMessengerIngressClaim({');
  });
});

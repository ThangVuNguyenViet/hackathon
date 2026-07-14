import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaWebhookSignature } from '../../src/security/webhookAuthenticity.js';

describe('webhook authenticity', () => {
  it('accepts the exact raw Meta body and rejects missing or modified signatures', async () => {
    const appSecret = 'meta_test_secret';
    const rawBody = new TextEncoder().encode('{"object":"page","entry":[]}');
    const signature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

    await expect(verifyMetaWebhookSignature({ rawBody, signatureHeader: signature, appSecret })).resolves.toBe(true);
    await expect(verifyMetaWebhookSignature({
      rawBody: new TextEncoder().encode('{"object":"page","entry":[{}]}'),
      signatureHeader: signature,
      appSecret,
    })).resolves.toBe(false);
    await expect(verifyMetaWebhookSignature({ rawBody, signatureHeader: null, appSecret })).resolves.toBe(false);
  });
});

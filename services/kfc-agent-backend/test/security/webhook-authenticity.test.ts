import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyMetaWebhookSignature,
  verifyZaloWebhookSignature,
} from '../../src/security/webhookAuthenticity.js';

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

  it('verifies the documented Zalo appId + raw data + timestamp + OA secret digest', async () => {
    const oaSecret = 'zalo_oa_test_secret';
    const rawText = '{"app_id":"app_1","timestamp":"1783323124608","event_name":"user_send_text"}';
    const rawBody = new TextEncoder().encode(rawText);
    const signature = createHash('sha256')
      .update(`app_1${rawText}1783323124608${oaSecret}`)
      .digest('hex');

    await expect(
      verifyZaloWebhookSignature({ rawBody, signatureHeader: signature, oaSecret }),
    ).resolves.toBe(true);
    await expect(
      verifyZaloWebhookSignature({
        rawBody: new TextEncoder().encode(rawText.replace('user_send_text', 'user_send_image')),
        signatureHeader: signature,
        oaSecret,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyZaloWebhookSignature({ rawBody, signatureHeader: null, oaSecret }),
    ).resolves.toBe(false);
  });
});

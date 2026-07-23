import { describe, expect, it, vi } from 'vitest';
import { createMessengerClient } from '../../src/channels/messenger.js';
import { createZaloClient } from '../../src/channels/zalo.js';

function responseFetch(
  body: unknown,
  status = 200,
): ReturnType<typeof vi.fn> {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }));
}

describe('Messenger text-send transport outcomes', () => {
  it('confirms sent only with the real provider message ID', async () => {
    const fetchImpl = responseFetch({ message_id: 'mid-provider-1' });
    const client = createMessengerClient({
      pageAccessToken: 'page-token',
      graphApiBaseUrl: 'https://messenger.local',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Hello'),
    ).resolves.toEqual({
      status: 'confirmed_sent',
      messageId: 'mid-provider-1',
    });
  });

  it('distinguishes a definitive provider rejection', async () => {
    const fetchImpl = responseFetch({
      error: {
        message: 'Recipient is unavailable',
        code: 10,
      },
    }, 400);
    const client = createMessengerClient({
      pageAccessToken: 'page-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Hello'),
    ).resolves.toEqual({
      status: 'confirmed_not_sent',
      errorCode: 'messenger_send_failed',
      message: 'Recipient is unavailable',
    });
  });

  it('reports missing configuration as not dispatched', async () => {
    const fetchImpl = responseFetch({ message_id: 'must-not-send' });
    const client = createMessengerClient({
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Hello'),
    ).resolves.toMatchObject({
      status: 'not_dispatched',
      errorCode: 'missing_page_access_token',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not dispatch with a whitespace-only credential', async () => {
    const fetchImpl = responseFetch({ message_id: 'must-not-send' });
    const client = createMessengerClient({
      pageAccessToken: '   ',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Hello'),
    ).resolves.toMatchObject({
      status: 'not_dispatched',
      errorCode: 'missing_page_access_token',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports local input validation as not dispatched', async () => {
    const fetchImpl = responseFetch({ message_id: 'must-not-send' });
    const client = createMessengerClient({
      pageAccessToken: 'page-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('', 'Hello'),
    ).resolves.toMatchObject({
      status: 'not_dispatched',
      errorCode: 'messenger_send_input_invalid',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps a timeout after dispatch outcome unknown', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('provider timed out', 'TimeoutError');
    });
    const client = createMessengerClient({
      pageAccessToken: 'page-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Hello'),
    ).resolves.toEqual({
      status: 'delivery_outcome_unknown',
      errorCode: 'messenger_delivery_outcome_unknown',
      message: 'provider timed out',
    });
  });

  it('keeps an accepted response without a message ID outcome unknown', async () => {
    const fetchImpl = responseFetch({ recipient_id: 'recipient-1' });
    const client = createMessengerClient({
      pageAccessToken: 'page-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Hello'),
    ).resolves.toMatchObject({
      status: 'delivery_outcome_unknown',
      errorCode: 'messenger_delivery_outcome_unknown',
    });
  });

  it('does not treat an ambiguous HTTP failure as confirmed rejection', async () => {
    const fetchImpl = responseFetch({ transient: true }, 503);
    const client = createMessengerClient({
      pageAccessToken: 'page-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Hello'),
    ).resolves.toMatchObject({
      status: 'delivery_outcome_unknown',
      errorCode: 'messenger_delivery_outcome_unknown',
    });
  });
});

describe('Zalo text-send transport outcomes', () => {
  it('confirms sent only with the real provider message ID', async () => {
    const fetchImpl = responseFetch({
      error: 0,
      message_id: 'zalo-provider-1',
    });
    const client = createZaloClient({
      accessToken: 'zalo-token',
      apiBaseUrl: 'https://zalo.local',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Xin chào'),
    ).resolves.toEqual({
      status: 'confirmed_sent',
      messageId: 'zalo-provider-1',
    });
  });

  it('distinguishes a definitive provider rejection', async () => {
    const fetchImpl = responseFetch({
      error: -201,
      message: 'Recipient rejected',
    });
    const client = createZaloClient({
      accessToken: 'zalo-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Xin chào'),
    ).resolves.toEqual({
      status: 'confirmed_not_sent',
      errorCode: 'zalo_send_failed',
      message: 'Recipient rejected',
    });
  });

  it('reports missing configuration as not dispatched', async () => {
    const fetchImpl = responseFetch({
      error: 0,
      message_id: 'must-not-send',
    });
    const client = createZaloClient({
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Xin chào'),
    ).resolves.toMatchObject({
      status: 'not_dispatched',
      errorCode: 'missing_zalo_access_token',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not dispatch with a whitespace-only credential', async () => {
    const fetchImpl = responseFetch({
      error: 0,
      message_id: 'must-not-send',
    });
    const client = createZaloClient({
      accessToken: '   ',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Xin chào'),
    ).resolves.toMatchObject({
      status: 'not_dispatched',
      errorCode: 'missing_zalo_access_token',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports local input validation as not dispatched', async () => {
    const fetchImpl = responseFetch({
      error: 0,
      message_id: 'must-not-send',
    });
    const client = createZaloClient({
      accessToken: 'zalo-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', '   '),
    ).resolves.toMatchObject({
      status: 'not_dispatched',
      errorCode: 'zalo_send_input_invalid',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps a network failure after dispatch outcome unknown', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('connection reset');
    });
    const client = createZaloClient({
      accessToken: 'zalo-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Xin chào'),
    ).resolves.toEqual({
      status: 'delivery_outcome_unknown',
      errorCode: 'zalo_delivery_outcome_unknown',
      message: 'connection reset',
    });
  });

  it('never fabricates a success ID when the provider omits it', async () => {
    const fetchImpl = responseFetch({ error: 0 });
    const client = createZaloClient({
      accessToken: 'zalo-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Xin chào'),
    ).resolves.toMatchObject({
      status: 'delivery_outcome_unknown',
      errorCode: 'zalo_delivery_outcome_unknown',
    });

    const legacyFetch = responseFetch({ error: 0 });
    const legacyClient = createZaloClient({
      accessToken: 'zalo-token',
      fetchImpl: legacyFetch as typeof fetch,
    });
    const legacy = await legacyClient.sendText('recipient-1', 'Xin chào');
    expect(legacy).toMatchObject({
      ok: false,
      errorCode: 'zalo_delivery_outcome_unknown',
    });
    expect(legacy.value).toBeUndefined();
    expect(JSON.stringify(legacy)).not.toContain('zalo_recipient-1');
  });

  it('does not treat an ambiguous HTTP failure as confirmed rejection', async () => {
    const fetchImpl = responseFetch({ transient: true }, 503);
    const client = createZaloClient({
      accessToken: 'zalo-token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      client.sendTextWithOutcome('recipient-1', 'Xin chào'),
    ).resolves.toMatchObject({
      status: 'delivery_outcome_unknown',
      errorCode: 'zalo_delivery_outcome_unknown',
    });
  });
});

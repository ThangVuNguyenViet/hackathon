import type {
  ChannelTextSendOutcome,
  MessengerClient,
  ZaloClient,
} from '../clients/interfaces.js';
import type { MockClientOptions } from './mockClientOptions.js';
import { mockFailure } from './mockToolResults.js';

type ConfiguredChannelClients = NonNullable<
  MockClientOptions['channelClients']
>;

function mockTextOutcome(
  result: Awaited<ReturnType<MessengerClient['sendText']>>,
): ChannelTextSendOutcome {
  if (result.ok) {
    const messageId = result.value?.messageId;
    if (
      typeof messageId === 'string' &&
      messageId.length > 0 &&
      messageId === messageId.trim()
    ) {
      return { status: 'confirmed_sent', messageId };
    }
    return {
      status: 'delivery_outcome_unknown',
      errorCode: 'mock_delivery_provider_message_id_invalid',
      message:
        'Mock delivery reported success without a valid provider ID',
    };
  }
  return {
    status: 'delivery_outcome_unknown',
    errorCode:
      result.errorCode ?? 'legacy_mock_delivery_outcome_unknown',
    message: result.message,
  };
}

function withMessengerTextOutcome(
  client: ConfiguredChannelClients['messenger'],
): MessengerClient {
  return {
    ...client,
    async sendTextWithOutcome(recipientId, text) {
      return client.sendTextWithOutcome?.(recipientId, text) ??
        mockTextOutcome(await client.sendText(recipientId, text));
    },
  };
}

function withZaloTextOutcome(
  client: ConfiguredChannelClients['zalo'],
): ZaloClient {
  return {
    ...client,
    async sendTextWithOutcome(recipientId, text) {
      return client.sendTextWithOutcome?.(recipientId, text) ??
        mockTextOutcome(await client.sendText(recipientId, text));
    },
  };
}

function defaultChannelClients(): ConfiguredChannelClients {
  return {
    messenger: {
      async sendText() {
        return mockFailure(
          'channel_client_not_configured',
          'Messenger delivery must be provided by a live channel client',
        );
      },
      async sendTextWithOutcome() {
        return {
          status: 'not_dispatched',
          errorCode: 'channel_client_not_configured',
          message:
            'Messenger delivery must be provided by a live channel client',
        };
      },
      async sendSenderAction() {
        return mockFailure(
          'channel_client_not_configured',
          'Messenger delivery must be provided by a live channel client',
        );
      },
      async getProfile() {
        return mockFailure(
          'channel_client_not_configured',
          'Messenger profile lookup must be provided by a live channel client',
        );
      },
    },
    zalo: {
      async sendText() {
        return mockFailure(
          'channel_client_not_configured',
          'Zalo delivery must be provided by a live channel client',
        );
      },
      async sendTextWithOutcome() {
        return {
          status: 'not_dispatched',
          errorCode: 'channel_client_not_configured',
          message:
            'Zalo delivery must be provided by a live channel client',
        };
      },
      async getProfile() {
        return mockFailure(
          'channel_client_not_configured',
          'Zalo profile lookup must be provided by a live channel client',
        );
      },
    },
  };
}

export function createMockChannelClients(
  configured = defaultChannelClients(),
): {
  messenger: MessengerClient;
  zalo: ZaloClient;
} {
  return {
    messenger: withMessengerTextOutcome(configured.messenger),
    zalo: withZaloTextOutcome(configured.zalo),
  };
}

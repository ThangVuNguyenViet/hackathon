import type { ConversationEvent } from '../channels/conversationEvent.js';
import type { ExternalClients } from '../clients/interfaces.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import { sessionIdForConversationEvent } from '../session/sessionContext.js';
import type { RouteAgentRuntime } from './routeAgentRuntime.js';
import type { RouteCommerceRuntime } from './routeCommerceRuntime.js';
import type { MessengerWebhookEventProcessingResult } from './routeHandlerContracts.js';
import { sendMessengerSenderAction } from './routeHandlerSupport.js';

interface MessengerEventProcessorInput {
  store: ConversationStore;
  createWebhookClients: RouteCommerceRuntime['createWebhookClients'];
  persistEventProfile: RouteAgentRuntime['persistEventProfile'];
  persistNonAgentInboundEvent: RouteAgentRuntime['persistNonAgentInboundEvent'];
  pauseIfHumanJoined: RouteAgentRuntime['pauseIfHumanJoined'];
}

export function createMessengerEventProcessor(
  input: MessengerEventProcessorInput,
) {
  const {
    store,
    createWebhookClients,
    persistEventProfile,
    persistNonAgentInboundEvent,
    pauseIfHumanJoined,
  } = input;

  return async function processMessengerEventInternal(
    event: ConversationEvent,
  ): Promise<MessengerWebhookEventProcessingResult> {
    const sessionId = sessionIdForConversationEvent(event);
    const delivery = await store.getWebhookDelivery(
      'messenger',
      event.rawEventId,
    );
    if (delivery?.status === 'processed') {
      return { status: 'skipped' };
    }

    let clients: ExternalClients | undefined;
    let typingStarted = false;
    try {
      await persistEventProfile(event);
      clients = await createWebhookClients(sessionId);
      await sendMessengerSenderAction(
        clients.messenger,
        event.externalUserId,
        'mark_seen',
        event.rawEventId,
      );
      typingStarted = await sendMessengerSenderAction(
        clients.messenger,
        event.externalUserId,
        'typing_on',
        event.rawEventId,
      );
      const profileResult = await clients.messenger.getProfile(
        event.externalUserId,
      );
      if (profileResult.ok) {
        const profile = profileResult.value;
        await store.upsertProfile({
          channel: 'messenger',
          externalUserId: event.externalUserId,
          displayName: profile?.displayName ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
          profileSource: profile?.profileSource ?? 'messenger_profile_api',
          profileUpdatedAt: new Date().toISOString(),
        });
      }

      if (!event.shouldRunAgent) {
        await persistNonAgentInboundEvent(sessionId, event);
        await store.markWebhookDeliveryProcessed('messenger', event.rawEventId);
        return { status: 'processed' };
      }

      if (await pauseIfHumanJoined(sessionId, event)) {
        await store.markWebhookDeliveryProcessed('messenger', event.rawEventId);
        return { status: 'processed' };
      }
      const errorCode = 'agent_run_execution_required';
      await store.markWebhookDeliveryFailed(
        'messenger',
        event.rawEventId,
        errorCode,
      );
      return {
        status: 'failed',
        errorCode,
        errorMessage: 'AI-bearing Messenger events require a claimed AgentRun',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown Messenger webhook failure';
      await store.markWebhookDeliveryFailed(
        'messenger',
        event.rawEventId,
        errorMessage,
      );
      return {
        status: 'failed',
        errorCode: 'messenger_webhook_processing_failed',
        errorMessage,
      };
    } finally {
      if (typingStarted && clients) {
        await sendMessengerSenderAction(
          clients.messenger,
          event.externalUserId,
          'typing_off',
          event.rawEventId,
        );
      }
    }
  };
}

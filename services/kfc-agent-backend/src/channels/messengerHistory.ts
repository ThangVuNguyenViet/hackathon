import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { ConversationTurn } from '../domain/types.js';
import type { ConversationStore } from '../persistence/memoryStore.js';

const unsupportedMessengerMessage = '[unsupported Messenger message]';
const conversationFields = 'id,participants,updated_time,messages.limit(100){id,message,from,to,created_time}';

export interface MessengerHistoryMessage {
  id: string;
  text: string;
  fromId: string | null;
  toIds: string[];
  createdTime: string;
  raw: Record<string, unknown>;
}

export interface MessengerHistoryConversation {
  id: string;
  participantIds: string[];
  updatedTime: string | null;
  messages: MessengerHistoryMessage[];
}

export interface MessengerHistoryClient {
  fetchConversations(input?: MessengerHistoryFetchOptions): Promise<MessengerHistoryConversation[]>;
}

export interface MessengerHistoryFetchOptions {
  limitConversations?: number;
  since?: string;
}

export interface MessengerHistorySyncResult {
  ok: true;
  conversationsScanned: number;
  messagesImported: number;
  messagesSkipped: number;
}

export interface MessengerHistorySyncStatus {
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastResult: MessengerHistorySyncResult | null;
}

interface MetaPaging {
  next?: string;
}

interface MetaCollection<T> {
  data?: T[];
  paging?: MetaPaging;
}

interface MetaConversation {
  id?: string;
  participants?: MetaCollection<{ id?: string }>;
  updated_time?: string;
  messages?: MetaCollection<MetaMessage>;
}

interface MetaMessage {
  id?: string;
  message?: string;
  from?: { id?: string };
  to?: MetaCollection<{ id?: string }>;
  created_time?: string;
}

export function createMessengerHistoryClient(input: {
  pageId: string;
  pageAccessToken: string;
  graphApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): MessengerHistoryClient {
  const graphApiBaseUrl = input.graphApiBaseUrl ?? 'https://graph.facebook.com';
  const fetchImpl = input.fetchImpl ?? fetch;

  async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetchImpl(url);
    const body = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(body.error?.message ?? `Meta Graph request failed: ${response.status}`);
    }
    return body;
  }

  async function fetchMessagePages(messages: MetaCollection<MetaMessage> | undefined): Promise<MessengerHistoryMessage[]> {
    const allMessages: MessengerHistoryMessage[] = [];
    let current: MetaCollection<MetaMessage> | undefined = messages;
    while (current) {
      allMessages.push(...(current.data ?? []).flatMap(normalizeMessage));
      current = current.paging?.next ? await fetchJson<MetaCollection<MetaMessage>>(current.paging.next) : undefined;
    }
    return allMessages;
  }

  return {
    async fetchConversations(options: MessengerHistoryFetchOptions = {}) {
      const conversations: MessengerHistoryConversation[] = [];
      const params = new URLSearchParams({
        platform: 'messenger',
        fields: conversationFields,
        access_token: input.pageAccessToken,
      });
      if (options.since) params.set('since', options.since);

      let nextUrl: string | undefined = `${graphApiBaseUrl}/${input.pageId}/conversations?${params.toString()}`;
      while (nextUrl && (options.limitConversations === undefined || conversations.length < options.limitConversations)) {
        const page: MetaCollection<MetaConversation> = await fetchJson<MetaCollection<MetaConversation>>(nextUrl);
        for (const conversation of page.data ?? []) {
          if (!conversation.id) continue;
          conversations.push({
            id: conversation.id,
            participantIds: (conversation.participants?.data ?? []).flatMap((participant: { id?: string }) =>
              participant.id ? [participant.id] : [],
            ),
            updatedTime: conversation.updated_time ?? null,
            messages: await fetchMessagePages(conversation.messages),
          });
          if (options.limitConversations !== undefined && conversations.length >= options.limitConversations) break;
        }
        nextUrl =
          options.limitConversations !== undefined && conversations.length >= options.limitConversations
            ? undefined
            : page.paging?.next;
      }
      return conversations;
    },
  };
}

export class MessengerHistorySyncService {
  constructor(
    private readonly input: {
      pageId: string;
      store: ConversationStore;
      dashboard: DashboardEventBus;
      client: MessengerHistoryClient;
    },
  ) {}

  async sync(options: MessengerHistoryFetchOptions = {}): Promise<MessengerHistorySyncResult> {
    const conversations = await this.input.client.fetchConversations(options);
    let messagesImported = 0;
    let messagesSkipped = 0;

    for (const conversation of conversations) {
      const customerId = customerIdForConversation(this.input.pageId, conversation);
      const sessionId = `messenger:${customerId ?? conversation.id}`;
      const sortedMessages = [...conversation.messages].sort((a, b) => a.createdTime.localeCompare(b.createdTime));

      for (const message of sortedMessages) {
        const role: ConversationTurn['role'] = message.fromId === this.input.pageId ? 'assistant' : 'user';
        const externalUserId = role === 'assistant' ? customerId ?? conversation.id : message.fromId ?? customerId ?? conversation.id;
        const result = await this.input.store.upsertImportedTurn({
          sessionId,
          channel: 'messenger',
          role,
          text: message.text,
          externalMessageId: message.id,
          externalUserId,
          deliveryStatus: role === 'assistant' ? 'sent' : 'received',
          createdAt: message.createdTime,
        });

        if (result.inserted) {
          messagesImported += 1;
          await this.input.store.appendEvent(sessionId, 'messenger:history_imported_message', {
            conversationId: conversation.id,
            message: message.raw,
          });
          emitImportedDashboardEvents(this.input.dashboard, result.turn);
        } else {
          messagesSkipped += 1;
        }
      }
    }

    return {
      ok: true,
      conversationsScanned: conversations.length,
      messagesImported,
      messagesSkipped,
    };
  }
}

export class MessengerHistorySyncCoordinator {
  private running = false;
  private lastStartedAt: string | null = null;
  private lastFinishedAt: string | null = null;
  private lastError: string | null = null;
  private lastResult: MessengerHistorySyncResult | null = null;

  constructor(private readonly service: MessengerHistorySyncService) {}

  getStatus(): MessengerHistorySyncStatus {
    return {
      running: this.running,
      lastStartedAt: this.lastStartedAt,
      lastFinishedAt: this.lastFinishedAt,
      lastError: this.lastError,
      lastResult: this.lastResult,
    };
  }

  async sync(options: MessengerHistoryFetchOptions = {}): Promise<MessengerHistorySyncResult> {
    if (this.running) throw new Error('Messenger history sync is already running');

    this.running = true;
    this.lastStartedAt = new Date().toISOString();
    this.lastFinishedAt = null;
    this.lastError = null;
    try {
      const result = await this.service.sync(options);
      this.lastResult = result;
      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown Messenger history sync failure';
      throw error;
    } finally {
      this.running = false;
      this.lastFinishedAt = new Date().toISOString();
    }
  }

  syncInBackground(options: MessengerHistoryFetchOptions = {}): void {
    void this.sync(options).catch(() => undefined);
  }
}

function normalizeMessage(message: MetaMessage): MessengerHistoryMessage[] {
  if (!message.id) return [];
  return [
    {
      id: message.id,
      text: typeof message.message === 'string' && message.message.length > 0 ? message.message : unsupportedMessengerMessage,
      fromId: message.from?.id ?? null,
      toIds: (message.to?.data ?? []).flatMap((recipient) => (recipient.id ? [recipient.id] : [])),
      createdTime: normalizeMetaDate(message.created_time),
      raw: message as Record<string, unknown>,
    },
  ];
}

function normalizeMetaDate(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  return new Date(value).toISOString();
}

function customerIdForConversation(pageId: string, conversation: MessengerHistoryConversation): string | undefined {
  const participant = conversation.participantIds.find((id) => id !== pageId);
  if (participant) return participant;

  for (const message of conversation.messages) {
    if (message.fromId && message.fromId !== pageId) return message.fromId;
    const recipient = message.toIds.find((id) => id !== pageId);
    if (recipient) return recipient;
  }
  return undefined;
}

function emitImportedDashboardEvents(dashboard: DashboardEventBus, turn: ConversationTurn): void {
  if (turn.role === 'user') {
    dashboard.emitEvent({
      id: `dash_import_${turn.externalMessageId}_customer_message_received`,
      sessionId: turn.sessionId,
      type: 'customer_message_received',
      payload: {
        turnId: turn.id,
        channel: turn.channel,
        externalMessageId: turn.externalMessageId,
        externalUserId: turn.externalUserId,
        text: turn.text,
      },
      createdAt: turn.createdAt,
    });
  }

  dashboard.emitEvent({
    id: `dash_import_${turn.externalMessageId}_conversation_turn_created`,
    sessionId: turn.sessionId,
    type: 'conversation_turn_created',
    payload: {
      turnId: turn.id,
      role: turn.role,
      channel: turn.channel,
      deliveryStatus: turn.deliveryStatus,
      externalMessageId: turn.externalMessageId,
      externalUserId: turn.externalUserId,
      text: turn.text,
    },
    createdAt: turn.createdAt,
  });
}

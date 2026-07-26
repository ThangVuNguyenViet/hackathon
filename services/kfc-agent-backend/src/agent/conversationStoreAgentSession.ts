import type { AgentInputItem, Session } from '@kfc/openai-agents-runtime';
import type { ConversationStore } from '../persistence/contracts.js';

export class ConversationStoreAgentSession implements Session {
  constructor(
    private readonly store: ConversationStore,
    private readonly sessionId: string,
  ) {}

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    return this.store.listAgentSessionItems(this.sessionId, limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    await this.store.addAgentSessionItems(this.sessionId, items);
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.store.popAgentSessionItem(this.sessionId);
  }

  async clearSession(): Promise<void> {
    await this.store.clearAgentSessionItems(this.sessionId);
  }
}

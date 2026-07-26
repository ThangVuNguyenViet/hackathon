import type { AgentInputItem, Session } from '@kfc/openai-agents-runtime';
import type { ConversationStore } from '../persistence/contracts.js';

export class BufferedConversationStoreAgentSession implements Session {
  private readonly pending: AgentInputItem[] = [];

  constructor(
    private readonly store: ConversationStore,
    private readonly sessionId: string,
  ) {}

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const durable = await this.store.listAgentSessionItems(this.sessionId);
    const items = [...durable, ...structuredClone(this.pending)];
    return limit === undefined ? items : items.slice(-limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    this.pending.push(...structuredClone(items));
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const item = this.pending.pop();
    return item === undefined ? undefined : structuredClone(item);
  }

  async clearSession(): Promise<void> {
    this.pending.splice(0);
  }

  pendingItems(): AgentInputItem[] {
    return structuredClone(this.pending);
  }
}

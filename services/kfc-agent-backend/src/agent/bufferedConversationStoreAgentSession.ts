import type { AgentInputItem, Session } from '@kfc/openai-agents-runtime';
import type {
  AgentSessionItemsMutation,
  ConversationStore,
} from '../persistence/contracts.js';

export class BufferedConversationStoreAgentSession implements Session {
  private readonly pending: AgentInputItem[] = [];
  private replacesDurableHistory = false;

  constructor(
    private readonly store: ConversationStore,
    private readonly sessionId: string,
  ) {}

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const durable = this.replacesDurableHistory
      ? []
      : await this.store.listAgentSessionItems(this.sessionId);
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
    this.replacesDurableHistory = true;
  }

  pendingMutation(): AgentSessionItemsMutation {
    return {
      mode: this.replacesDurableHistory ? 'replace' : 'append',
      items: structuredClone(this.pending),
    };
  }
}

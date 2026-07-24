import { afterEach, describe, expect, it } from 'vitest';
import type { AgentModelIdentity } from '../../src/config/agentModelProfile.js';
import { bindConfiguredSessionAgentModel } from '../../src/persistence/sessionAgentModelBinding.js';
import type { ConversationStore } from '../../src/persistence/contracts.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { scopePackSessionId } from '../../src/runtime/businessPack.js';
import { SqliteD1Database } from '../support/sqlite-d1.js';

const openAiIdentity: AgentModelIdentity = {
  candidateId: 'openai-gpt-4.1-mini',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  profile: 'openai:gpt-4.1-mini:responses',
  transport: 'openai_responses',
};

const qwenIdentity: AgentModelIdentity = {
  candidateId: 'qwen3.7-max',
  provider: 'opencode',
  model: 'qwen3.7-max',
  profile: 'opencode:qwen3.7-max:anthropic-messages:thinking-disabled',
  transport: 'anthropic_messages',
};

const closeDatabase: Array<() => void> = [];

afterEach(() => {
  closeDatabase.splice(0).forEach((close) => close());
});

async function stores(): Promise<
  Array<{ name: string; store: ConversationStore }>
> {
  const database = new SqliteD1Database();
  closeDatabase.push(() => database.close());
  const d1 = new D1Store(database);
  await d1.initialize();
  return [
    { name: 'memory', store: new MemoryStore() },
    { name: 'd1', store: d1 },
  ];
}

describe('trusted session agent model binding', () => {
  it('pins the configured candidate profile on the first turn and resumes it unchanged', async () => {
    for (const fixture of await stores()) {
      const first = await bindConfiguredSessionAgentModel({
        store: fixture.store,
        sessionId: `${fixture.name}-session`,
        identity: openAiIdentity,
      });
      const resumed = await bindConfiguredSessionAgentModel({
        store: fixture.store,
        sessionId: `${fixture.name}-session`,
        identity: openAiIdentity,
      });

      expect(first).toEqual(openAiIdentity);
      expect(resumed).toEqual(openAiIdentity);
      await expect(
        fixture.store.getSessionAgentState(`${fixture.name}-session`),
      ).resolves.toMatchObject({ agentModelBinding: openAiIdentity });
    }
  });

  it('rejects a deployment candidate change for an existing session', async () => {
    for (const fixture of await stores()) {
      const sessionId = `${fixture.name}-drift`;
      await bindConfiguredSessionAgentModel({
        store: fixture.store,
        sessionId,
        identity: openAiIdentity,
      });

      await expect(
        bindConfiguredSessionAgentModel({
          store: fixture.store,
          sessionId,
          identity: qwenIdentity,
        }),
      ).rejects.toThrow('session_agent_model_binding_mismatch');
      await expect(
        fixture.store.getSessionAgentState(sessionId),
      ).resolves.toMatchObject({ agentModelBinding: openAiIdentity });
    }
  });

  it('allows only one trusted binding to win concurrent first turns', async () => {
    for (const fixture of await stores()) {
      const sessionId = `${fixture.name}-concurrent`;
      const results = await Promise.allSettled([
        bindConfiguredSessionAgentModel({
          store: fixture.store,
          sessionId,
          identity: openAiIdentity,
        }),
        bindConfiguredSessionAgentModel({
          store: fixture.store,
          sessionId,
          identity: qwenIdentity,
        }),
      ]);

      expect(results.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const stored = (await fixture.store.getSessionAgentState(sessionId))
        .agentModelBinding;
      expect([openAiIdentity, qwenIdentity]).toContainEqual(stored);
    }
  });

  it('isolates bindings by durable pack session key', async () => {
    for (const fixture of await stores()) {
      const externalSessionId = `${fixture.name}-shared`;
      const kfcSessionId = externalSessionId;
      const pvcfcSessionId = scopePackSessionId(
        { packId: 'pvcfc-customer-service', version: '1.0.0' },
        externalSessionId,
      );

      await bindConfiguredSessionAgentModel({
        store: fixture.store,
        sessionId: kfcSessionId,
        identity: openAiIdentity,
      });
      await bindConfiguredSessionAgentModel({
        store: fixture.store,
        sessionId: pvcfcSessionId,
        identity: qwenIdentity,
      });

      await expect(
        fixture.store.getSessionAgentState(kfcSessionId),
      ).resolves.toMatchObject({ agentModelBinding: openAiIdentity });
      await expect(
        fixture.store.getSessionAgentState(pvcfcSessionId),
      ).resolves.toMatchObject({ agentModelBinding: qwenIdentity });
    }
  });

  it('pins a legacy state row whose model binding is null', async () => {
    for (const fixture of await stores()) {
      const sessionId = `${fixture.name}-legacy`;
      await fixture.store.setSessionAgentState({
        sessionId,
        currentRunId: null,
        generation: 7,
        debounceDeadlineAt: null,
        agentModelBinding: null,
      });

      await expect(
        bindConfiguredSessionAgentModel({
          store: fixture.store,
          sessionId,
          identity: openAiIdentity,
        }),
      ).resolves.toEqual(openAiIdentity);
      await expect(
        fixture.store.getSessionAgentState(sessionId),
      ).resolves.toMatchObject({
        generation: 7,
        agentModelBinding: openAiIdentity,
      });
    }
  });

  it('allows a new configured profile only after an explicit session reset', async () => {
    for (const fixture of await stores()) {
      const sessionId = `${fixture.name}-reset`;
      await bindConfiguredSessionAgentModel({
        store: fixture.store,
        sessionId,
        identity: openAiIdentity,
      });

      await fixture.store.resetSession(sessionId);

      await expect(
        bindConfiguredSessionAgentModel({
          store: fixture.store,
          sessionId,
          identity: qwenIdentity,
        }),
      ).resolves.toEqual(qwenIdentity);
    }
  });
});

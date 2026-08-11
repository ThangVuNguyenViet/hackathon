import { describe, expectTypeOf, it } from 'vitest';
import type {
  DirectAgentTurnInput,
  DirectAgentTurnResult,
} from '../../src/agent/directAgentTurn.js';
import type { KfcDirectAgentTurnInput } from '../../src/agent/kfcAgentPack.js';

type ForbiddenSharedKfcFields = Extract<
  keyof DirectAgentTurnInput,
  'channel' | 'clients' | 'prepareSession' | 'selectGenUi'
>;

type ForbiddenKfcPackSelector = Extract<
  keyof KfcDirectAgentTurnInput,
  'businessId'
>;

describe('neutral direct-agent turn contract', () => {
  it('keeps business transport and execution results free of KFC extensions', () => {
    expectTypeOf<ForbiddenSharedKfcFields>().toEqualTypeOf<never>();
    expectTypeOf<DirectAgentTurnInput>().toMatchTypeOf<{
      transport: 'web_chat';
      sessionId: string;
      customerId: string;
      text: string;
    }>();
    expectTypeOf<DirectAgentTurnResult>().toMatchTypeOf<{
      responseText: string;
      stateCommit?: 'committed' | 'stale';
    }>();
  });

  it('keeps KFC clients, channel, session preparation, and GenUI on the KFC extension', () => {
    expectTypeOf<ForbiddenKfcPackSelector>().toEqualTypeOf<never>();
    expectTypeOf<KfcDirectAgentTurnInput>().toMatchTypeOf<
      DirectAgentTurnInput<string>
    >();
    expectTypeOf<KfcDirectAgentTurnInput>().toHaveProperty('channel');
    expectTypeOf<KfcDirectAgentTurnInput>().toHaveProperty('clients');
    expectTypeOf<KfcDirectAgentTurnInput>().toHaveProperty('prepareSession');
    expectTypeOf<KfcDirectAgentTurnInput>().toHaveProperty('selectGenUi');
  });
});

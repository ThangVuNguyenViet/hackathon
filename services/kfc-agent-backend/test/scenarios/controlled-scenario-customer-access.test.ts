import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it } from 'vitest';
import { runScenario } from '../../src/scenarios/runner.js';
import type {
  ScenarioScript,
} from '../../src/scenarios/scenarioScript.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import {
  controlledScenarioCustomerAccess,
} from './controlledScenarioCustomerAccess.js';

const scenarioId = '07-ca-nhan-hoa-va-loyalty';
const sessionId = `replay_${scenarioId}`;
const customerId = 'scenario_customer';
const script: ScenarioScript = {
  id: scenarioId,
  title: 'Scenario 07 authenticated text binding',
  channel: 'messenger_mock',
  goal: 'Verify authenticated scenario subject binding',
  useCases: ['UC-22'],
  finalState: 'access_binding_verified',
  turns: [{
    index: 1,
    speaker: 'User',
    text: 'Please help with my account.',
    useCases: ['UC-22'],
  }],
  userTurns: [{
    index: 1,
    speaker: 'User',
    text: 'Please help with my account.',
    useCases: ['UC-22'],
  }],
  expectations: [],
};

describe('controlled scenario customer access', () => {
  it('binds Scenario 07 text access to the persisted current-turn subject', async () => {
    const model = fakeModel().respond(groundedResponseModelReply({
      customerText: 'I can help with your account.',
    }));
    const accessContext = controlledScenarioCustomerAccess({
      sessionId,
      customerId,
      channel: 'messenger_mock',
    });

    await expect(runScenario(script, {
      agentModel: model,
      accessContext,
      channelOverride: 'messenger_mock',
    })).resolves.toMatchObject({
      transcript: [
        {
          role: 'user',
          externalUserId: customerId,
        },
        {
          role: 'assistant',
          externalUserId: customerId,
        },
      ],
    });

    expect(accessContext).toMatchObject({
      sessionRef: sessionId,
      kfcSubjectRef: customerId,
      customerSurface: 'messenger',
      surfaceSubjectRef: customerId,
      channelAccountLinkState: 'linked',
    });
    expect(model.callCount).toBe(1);
  });

  it('fails closed before inference for a different external subject', async () => {
    const model = fakeModel().respond(groundedResponseModelReply({
      customerText: 'This response must not be published.',
    }));
    const accessContext = {
      ...controlledScenarioCustomerAccess({
        sessionId,
        customerId,
        channel: 'messenger_mock',
      }),
      surfaceSubjectRef: 'different-scenario-customer',
    };

    await expect(runScenario(script, {
      agentModel: model,
      accessContext,
      channelOverride: 'messenger_mock',
    })).rejects.toThrow('model_publication_authority_invalid');

    expect(model.callCount).toBe(0);
  });
});

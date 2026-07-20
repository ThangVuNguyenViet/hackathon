import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it } from 'vitest';
import type { AgentGraphState } from '../../src/graph/state.js';
import type {
  ResponseClaimKind,
} from '../../src/agent/responseGrounding.js';
import {
  mockConfirmationProviderRevision,
} from '../../src/mock/mockConfirmationAuthority.js';
import {
  runScenario,
} from '../../src/scenarios/runner.js';
import {
  agentCheckpointRunId,
  agentCheckpointThreadBelongsToSession,
} from '../../src/session/sessionContext.js';
import type {
  ScenarioScript,
} from '../../src/scenarios/scenarioScript.js';
import {
  buildVerifiedCollectionSnapshot,
} from '../../src/ordering/verifiedCollections.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import {
  groundedResponseClaims,
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';

const sessionId = 'replay_scenario-confirmation-resume';
const customerId = 'scenario_customer';
const signingSecret =
  'scenario-confirmation-resume-test-secret-v1';

function script(): ScenarioScript {
  const userTurn = {
    index: 1,
    speaker: 'User' as const,
    text: 'Approve the verified order and its selected payment method.',
    useCases: ['approval-resume'],
  };
  return {
    id: 'scenario-confirmation-resume',
    title: 'Authenticated sequential confirmation resume',
    channel: 'kfc',
    goal: 'Prove separate order and payment approval operations',
    useCases: ['approval-resume'],
    finalState: 'order_created',
    turns: [userTurn],
    userTurns: [userTurn],
    expectations: [],
  };
}

function initialVerifiedState(): Partial<AgentGraphState> {
  return {
    cart: {
      id: 'scenario-confirmation-cart',
      items: [{
        itemCode: '20751',
        name: 'Combo Hợp Gu 99K',
        quantity: 1,
        unitPriceVnd: 99_000,
      }],
      subtotalVnd: 99_000,
      discountVnd: 0,
      deliveryFeeVnd: 18_000,
      totalVnd: 117_000,
      voucherCode: null,
    },
    address: {
      label: 'Home',
      line1: '60 Đ. Phạm Văn Nghị',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    },
    fulfillment: {
      method: 'delivery',
      disposition: 'delivery',
      storeId: 'KFCVN0318',
      storeName: 'KFC PHẠM VĂN NGHỊ',
      feeVnd: 18_000,
      etaMinutes: 35,
      availability: {
        ok: true,
        checkedItemIds: ['20751'],
        unavailableItemIds: [],
        blockedTimeslotItemIds: [],
        source: {
          fixtureMode: 'test_only',
          sourceFile: 'scenario-confirmation-resume.test.ts',
        },
      },
    },
  };
}

async function membershipApprovalState(): Promise<Partial<AgentGraphState>> {
  const fixtures = createTestFixtures();
  const providerRevision = mockConfirmationProviderRevision(undefined);
  const [rewards, wallet, tools] = await Promise.all([
    buildVerifiedCollectionSnapshot({
      items: fixtures.membershipRewardOffers,
      scope: { scope: 'all' },
      providerRevision,
    }),
    buildVerifiedCollectionSnapshot({
      items: fixtures.membershipWalletVouchers,
      scope: { scope: 'all' },
      providerRevision,
    }),
    buildVerifiedCollectionSnapshot({
      items: fixtures.membershipToolDefinitions,
      scope: { scope: 'all' },
      providerRevision,
    }),
  ]);
  return {
    ...initialVerifiedState(),
    verifiedCollections: {
      listMembershipRewards: { [rewards.key]: rewards },
      listMembershipWallet: { [wallet.key]: wallet },
      listMembershipTools: { [tools.key]: tools },
    },
    activeCollectionKeys: {
      listMembershipRewards: rewards.key,
      listMembershipWallet: wallet.key,
      listMembershipTools: tools.key,
    },
  };
}

function membershipScript(): ScenarioScript {
  const userTurns = [
    {
      index: 1,
      speaker: 'User' as const,
      text: 'Update my cart and show that this reward still needs confirmation.',
      useCases: ['membership-controlled-refusal'],
    },
    {
      index: 3,
      speaker: 'User' as const,
      text: 'Now acquire the reward and redeem my wallet voucher.',
      useCases: ['membership-sequential-approval'],
    },
  ];
  return {
    id: 'scenario-membership-confirmation-resume',
    title: 'Membership call-level confirmation',
    channel: 'kfc',
    goal: 'Prove false refusal and exact true approval sequence',
    useCases: userTurns.flatMap(({ useCases }) => useCases),
    finalState: 'membership_actions_completed',
    turns: userTurns,
    userTurns,
    expectations: [],
  };
}

describe('scenario confirmation resume harness', () => {
  it('uses separate durable coordinator operations for order and payment', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [
        {
          evidenceId: 'order',
          claimKinds: ['order_id', 'status'],
        },
        {
          evidenceId: 'payment_attempt',
          claimKinds: ['payment', 'status'],
        },
      ],
    });
    const model = fakeModel()
      .respondWithTools([{
        name: 'listPaymentMethods',
        args: { query: null, paymentSurface: null },
      }, {
        name: 'checkStoreAvailability',
        args: {
          storeId: 'KFCVN0318',
          disposition: 'delivery',
        },
      }])
      .respondWithTools([{ name: 'previewOrder', args: {} }])
      .respondWithTools([{ name: 'placeOrder', args: {} }])
      .respondWithTools([{
        name: 'createPaymentLink',
        args: { methodId: 'zalopay_wallet' },
      }])
      .respond(groundedResponseModelReply({
        customerText:
          'The verified order and payment link are ready.',
        ...claims,
      }));

    const result = await runScenario(script(), {
      agentModel: model,
      responseVerifierModel: groundedResponseVerifierModel(claims),
      accessContext: controlledCustomerAccess({
        sessionId,
        customerId,
        channel: 'kfc',
      }),
      initialVerifiedState: initialVerifiedState(),
      autoApproveConfirmations: () => true,
      confirmationSigningSecret: signingSecret,
    });

    expect(model.callCount).toBe(5);
    expect(result.transcript.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(result.toolTrace.filter(
      ({ toolName }) => toolName === 'placeOrder',
    )).toEqual([
      expect.objectContaining({ ok: true }),
    ]);
    expect(result.toolTrace.filter(
      ({ toolName }) => toolName === 'createPaymentLink',
    )).toEqual([
      expect.objectContaining({ ok: true }),
    ]);

    const evidence = result.turnEvidence[0]!;
    expect(evidence).toMatchObject({
      approvalRequested: true,
      checkpointNamespace: '',
      checkpointThreadId: expect.any(String),
      checkpointVerified: true,
      assistantText:
        'The verified order and payment link are ready.',
    });
    const checkpointThreadId = evidence.checkpointThreadId;
    if (!checkpointThreadId) {
      throw new Error('scenario_checkpoint_thread_id_missing');
    }
    expect(agentCheckpointThreadBelongsToSession(
      checkpointThreadId,
      sessionId,
    )).toBe(true);
    expect(agentCheckpointRunId(
      checkpointThreadId,
      sessionId,
    )).toMatch(/^scenario:[0-9a-f-]{36}$/u);
    expect(evidence.approvalResumes).toMatchObject([
      {
        capability: 'placeOrder',
        actionOutcome: 'succeeded',
        continuation: 'approval_required',
        replayVerified: true,
      },
      {
        capability: 'createPaymentLink',
        actionOutcome: 'succeeded',
        continuation: 'turn_completed',
        replayVerified: true,
      },
    ]);
    expect(new Set(
      evidence.approvalResumes.map(({ requestId }) => requestId),
    ).size).toBe(2);

    const pauseEvents = result.persistedEvents.filter(
      ({ sourceType }) =>
        sourceType === 'confirmation_pause_created',
    );
    expect(pauseEvents).toHaveLength(2);
    expect(new Set(pauseEvents.map(
      ({ payload }) => payload.requestId,
    )).size).toBe(2);
    expect(new Set(pauseEvents.map(
      ({ payload }) => payload.checkpointThreadId,
    ))).toEqual(new Set([checkpointThreadId]));
    expect(result.finalAgentState).toMatchObject({
      order: { status: 'created' },
      paymentAttempt: { status: 'pending' },
    });
  });

  it('keeps false local and resumes two true membership calls separately', async () => {
    const exactCurrentToolEvidence = (
      publication: {
        evidence: Array<{
          evidenceId: string;
          claimKinds: ResponseClaimKind[];
        }>;
      },
      toolNames: string[],
    ) => toolNames.map((toolName) => {
      const match = publication.evidence.find(
        ({ evidenceId }) =>
          evidenceId.startsWith(`current:${toolName}:`),
      );
      if (!match) {
        throw new Error(`test_current_tool_evidence_missing:${toolName}`);
      }
      return {
        evidenceId: match.evidenceId,
        claimKinds: [...match.claimKinds],
      };
    });
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'updateCart',
          args: {
            changes: [{
              itemCode: '20751',
              quantity: 2,
              modifiers: [],
            }],
          },
        },
      ])
      .respond(groundedResponseModelReply({
        customerText:
          'The cart is updated. Please confirm before I request voucher acquisition.',
        evidenceReferences: (publication) =>
          exactCurrentToolEvidence(
            publication,
            ['updateCart'],
          ),
      }))
      .respondWithTools([{
        name: 'acquireVoucher',
        args: {
          rewardId: 'reward-discount-10k',
        },
      }])
      .respondWithTools([{
        name: 'redeemReward',
        args: {
          voucherId: 'wallet-new-member-25k',
          channel: 'zalo_miniapp',
        },
      }])
      .respond(groundedResponseModelReply({
        customerText:
          'The verified membership actions completed.',
        evidenceReferences: (publication) =>
          exactCurrentToolEvidence(
            publication,
            ['acquireVoucher', 'redeemReward'],
          ),
      }));
    let verificationCall = 0;
    const verifier = groundedResponseVerifierModel({
      evidenceReferences: (publication) =>
        exactCurrentToolEvidence(
          publication,
          verificationCall++ === 0
            ? ['updateCart']
            : ['acquireVoucher', 'redeemReward'],
        ),
      authorizeReferencedPrivateEvidence: true,
    });

    const result = await runScenario(membershipScript(), {
      agentModel: model,
      responseVerifierModel: verifier,
      accessContext: controlledCustomerAccess({
        sessionId:
          'replay_scenario-membership-confirmation-resume',
        customerId,
        channel: 'kfc',
      }),
      initialVerifiedState: await membershipApprovalState(),
      autoApproveConfirmations: () => true,
      confirmationSigningSecret: signingSecret,
    });

    expect(model.callCount).toBe(5);
    expect(result.turnEvidence[0]?.approvalRequested).toBe(false);
    expect(result.turnEvidence[1]?.approvalResumes).toMatchObject([
      {
        capability: 'acquireVoucher',
        actionOutcome: 'succeeded',
        continuation: 'approval_required',
        replayVerified: true,
      },
      {
        capability: 'redeemReward',
        actionOutcome: 'succeeded',
        continuation: 'turn_completed',
        replayVerified: true,
      },
    ]);
    expect(new Set(
      result.turnEvidence[1]?.approvalResumes.map(
        ({ requestId }) => requestId,
      ),
    ).size).toBe(2);
    expect(result.toolTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolName: 'updateCart',
        arguments: expect.objectContaining({
          changes: [expect.objectContaining({
            itemCode: '20751',
            quantity: 2,
          })],
        }),
        ok: true,
      }),
      expect.objectContaining({
        toolName: 'acquireVoucher',
        arguments: {
          rewardId: 'reward-discount-10k',
        },
        ok: true,
      }),
      expect.objectContaining({
        toolName: 'redeemReward',
        arguments: {
          voucherId: 'wallet-new-member-25k',
          channel: 'zalo_miniapp',
        },
        ok: true,
      }),
    ]));
    expect(result.toolTrace.some(
      ({ toolName }) => toolName === 'placeOrder',
    )).toBe(false);
    const membershipAudits = result.toolTrace
      .filter(({ toolName }) =>
        toolName === 'acquireVoucher' ||
        toolName === 'redeemReward')
      .map(({ publicationEvidenceAudit }) =>
        publicationEvidenceAudit?.membershipActionOutcome);
    expect(membershipAudits).toEqual([
      {
        actionId: expect.any(String),
        status: 'completed',
        requiresUserConfirmation: false,
        targetId: 'reward-discount-10k',
      },
      {
        actionId: expect.any(String),
        status: 'completed',
        requiresUserConfirmation: false,
        targetId: 'wallet-new-member-25k',
      },
    ]);
    expect(JSON.stringify(membershipAudits)).not.toMatch(
      /signingSecret|receipt|authenticationEvidence|providerIdempotencyKey/u,
    );
  });
});

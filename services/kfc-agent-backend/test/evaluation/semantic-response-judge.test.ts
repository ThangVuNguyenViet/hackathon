import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it } from 'vitest';
import {
  createSemanticResponseJudge,
  parseSemanticResponseJudgment,
  semanticResponseJudgeEvidence,
  semanticResponseIssues,
} from '../../src/evaluation/semanticResponseJudge.js';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectation(fileName: string, turnIndex: number) {
  const row = liveScenarioCases
    .find((scenario) => scenario.fileName === fileName)
    ?.turnExpectations.find((candidate) => candidate.turnIndex === turnIndex);
  if (!row) throw new Error(`missing expectation ${fileName}#${turnIndex}`);
  return row;
}

function contradictionModel(
  inspectEvidence: (evidence: Record<string, unknown>) => void,
): BaseChatModel {
  return {
    withStructuredOutput() {
      return {
        async invoke(messages: BaseMessage[]) {
          const prompt = messages[1]?.content;
          if (typeof prompt !== 'string') {
            throw new Error('semantic judge prompt must be a JSON string');
          }
          const evidence = JSON.parse(prompt) as Record<string, unknown>;
          inspectEvidence(evidence);
          const requirements = evidence.requirements;
          if (!Array.isArray(requirements) || requirements.length === 0) {
            throw new Error('semantic judge requirements are missing');
          }
          return {
            passed: false,
            requirements: requirements.map((requirement, index) => {
              if (
                !requirement ||
                typeof requirement !== 'object' ||
                typeof (requirement as Record<string, unknown>)
                  .requirementId !== 'string'
              ) {
                throw new Error('semantic judge requirement is invalid');
              }
              return {
                requirementId: (requirement as Record<string, string>)
                  .requirementId,
                passed: index !== 0,
                reason:
                  index === 0
                    ? ('contradicted' as const)
                    : ('satisfied' as const),
              };
            }),
          };
        },
      };
    },
  } as unknown as BaseChatModel;
}

describe('provider-neutral semantic response judge', () => {
  it('judges semantic meaning through typed output without fixed response phrases', async () => {
    const row = expectation('05-khieu-nai-va-human-handoff.json', 1);
    const requirementId = row.claims.required[0]?.requirementId;
    if (!requirementId) throw new Error('semantic requirement is missing');
    const model = fakeModel().structuredResponse({
      passed: true,
      requirements: [
        {
          requirementId,
          passed: true,
          reason: 'satisfied',
        },
      ],
    });
    const judge = createSemanticResponseJudge(model);

    const judgment = await judge.judge({
      expectation: row,
      responseText:
        'Mình rất tiếc vì phần khoai bị thiếu. Bạn cho mình xin mã đơn nhé.',
      entries: [],
      stateBefore: {
        customerContext: { privatePhone: '0900-PRIVATE-BEFORE' },
      },
      stateAfter: {
        customerContext: { privatePhone: '0900-PRIVATE-AFTER' },
      },
    });

    expect(judgment).toEqual({
      passed: true,
      requirements: [
        {
          requirementId,
          passed: true,
          reason: 'satisfied',
        },
      ],
    });
    const serializedPrompt = JSON.stringify(
      semanticResponseJudgeEvidence({
        expectation: row,
        responseText:
          'Mình rất tiếc vì phần khoai bị thiếu. Bạn cho mình xin mã đơn nhé.',
        entries: [],
        stateBefore: {
          customerContext: { privatePhone: '0900-PRIVATE-BEFORE' },
        },
        stateAfter: {
          customerContext: { privatePhone: '0900-PRIVATE-AFTER' },
        },
      }),
    );
    expect(serializedPrompt).not.toContain('0900-PRIVATE-BEFORE');
    expect(serializedPrompt).not.toContain('0900-PRIVATE-AFTER');
    // Private state outside the governed expectation is omitted entirely; the
    // judge receives only structural evidence for the declared state paths.
    expect(serializedPrompt).toContain('"beforePresent":false');
    expect(serializedPrompt).toContain('"afterPresent":false');
  });

  it.each([
    {
      claim: 'invented amount',
      responseText: 'The verified total is 999000 VND.',
      inventedValue: '999000',
      factPath: 'cart',
      verifiedValues: ['286000'],
    },
    {
      claim: 'invented product',
      responseText: 'Your order contains a Double Beef Burger.',
      inventedValue: 'Double Beef Burger',
      factPath: 'cart',
      verifiedValues: ['Burger Gà Zinger'],
    },
    {
      claim: 'invented order',
      responseText: 'Order KFC-9999 is confirmed.',
      inventedValue: 'KFC-9999',
      factPath: 'order',
      verifiedValues: ['KFC-1024', 'confirmed'],
    },
    {
      claim: 'invented payment',
      responseText: 'Payment is already paid.',
      inventedValue: 'already paid',
      factPath: 'paymentAttempt',
      verifiedValues: ['pending'],
    },
  ])(
    'fails an $claim against claim-scoped verified facts',
    async ({ responseText, inventedValue, factPath, verifiedValues }) => {
      const row = expectation('01-dat-mon-ro-rang-giao-hang.json', 11);
      const judge = createSemanticResponseJudge(
        contradictionModel((evidence) => {
          expect(evidence.responseText).toBe(responseText);
          const stateEvidence = evidence.stateEvidence;
          expect(Array.isArray(stateEvidence)).toBe(true);
          if (!Array.isArray(stateEvidence)) {
            throw new Error('semantic judge state evidence is missing');
          }
          const fact = stateEvidence.find(
            (candidate) => isRecord(candidate) && candidate.path === factPath,
          );
          expect(fact).toBeDefined();
          const serializedFact = JSON.stringify(fact);
          for (const verifiedValue of verifiedValues) {
            expect(serializedFact).toContain(verifiedValue);
          }
          expect(serializedFact).not.toContain(inventedValue);
        }),
      );

      const judgment = await judge.judge({
        expectation: row,
        responseText,
        entries: [],
        stateBefore: {},
        stateAfter: {
          cart: {
            id: 'cart-verified',
            items: [
              {
                itemCode: '41141',
                name: 'Burger Gà Zinger',
                quantity: 2,
                unitPriceVnd: 143_000,
              },
            ],
            subtotalVnd: 286_000,
            discountVnd: 0,
            deliveryFeeVnd: 0,
            totalVnd: 286_000,
          },
          order: {
            id: 'KFC-1024',
            status: 'confirmed',
            customerPhone: '0900-PRIVATE-ORDER',
            deliveryAddress: {
              line1: 'PRIVATE-ORDER-ADDRESS',
            },
          },
          paymentAttempt: {
            orderId: 'KFC-1024',
            status: 'pending',
            paymentUrl: 'https://private.example/payment',
          },
          invoiceRequest: {
            companyName: 'PRIVATE-COMPANY',
            taxCode: 'PRIVATE-TAX',
            email: 'private@example.test',
          },
          customerContext: {
            phone: '0900-PRIVATE-CUSTOMER',
          },
        },
      });

      expect(judgment.passed).toBe(false);
      expect(judgment.requirements).toContainEqual(
        expect.objectContaining({
          passed: false,
          reason: 'contradicted',
        }),
      );
    },
  );

  it('redacts private/contact state while retaining safe typed facts', () => {
    const row = expectation('01-dat-mon-ro-rang-giao-hang.json', 11);
    const serializedPrompt = JSON.stringify(
      semanticResponseJudgeEvidence({
        expectation: row,
        responseText: 'The order total is 286000 VND and payment is pending.',
        entries: [],
        stateBefore: {},
        stateAfter: {
          cart: {
            items: [
              {
                itemCode: '41141',
                name: 'Burger Gà Zinger',
              },
            ],
            totalVnd: 286_000,
          },
          order: {
            id: 'KFC-1024',
            status: 'confirmed',
            customerPhone: '0900-PRIVATE-ORDER',
            deliveryAddress: {
              line1: 'PRIVATE-ORDER-ADDRESS',
            },
          },
          paymentAttempt: {
            orderId: 'KFC-1024',
            status: 'pending',
            paymentUrl: 'https://private.example/payment',
          },
          invoiceRequest: {
            companyName: 'PRIVATE-COMPANY',
            taxCode: 'PRIVATE-TAX',
            email: 'private@example.test',
          },
          customerContext: {
            phone: '0900-PRIVATE-CUSTOMER',
          },
        },
      }),
    );

    expect(serializedPrompt).toContain('Burger Gà Zinger');
    expect(serializedPrompt).toContain('286000');
    expect(serializedPrompt).toContain('KFC-1024');
    expect(serializedPrompt).toContain('"status":"pending"');
    expect(serializedPrompt).toContain('"redacted":true');
    for (const privateValue of [
      '0900-PRIVATE-ORDER',
      'PRIVATE-ORDER-ADDRESS',
      'https://private.example/payment',
      'PRIVATE-COMPANY',
      'PRIVATE-TAX',
      'private@example.test',
      '0900-PRIVATE-CUSTOMER',
    ]) {
      expect(serializedPrompt).not.toContain(privateValue);
    }
  });

  it('never forwards free-form V2 handoff reasons to the judge', () => {
    const row = expectation('08-thanh-toan-loi-va-don-bat-thuong.json', 5);
    const serializedPrompt = JSON.stringify(
      semanticResponseJudgeEvidence({
        expectation: row,
        responseText: 'Support has received the handoff.',
        entries: [],
        stateBefore: {},
        stateAfter: {
          handoff: {
            escalationId: [
              'handoff',
              'PRIVATE-SESSION',
              '0900-PRIVATE-HANDOFF',
              'private-handoff@example.test',
              'PRIVATE-HANDOFF-ADDRESS',
            ].join('_'),
            reasons: [
              'Call me at 0900-PRIVATE-HANDOFF',
              'Email private-handoff@example.test',
              'Come to PRIVATE-HANDOFF-ADDRESS',
            ],
          },
        },
      }),
    );

    expect(serializedPrompt).toContain('"escalationPresent":true');
    expect(serializedPrompt).toContain('"reasonCount":3');
    for (const privateValue of [
      'PRIVATE-SESSION',
      '0900-PRIVATE-HANDOFF',
      'private-handoff@example.test',
      'PRIVATE-HANDOFF-ADDRESS',
    ]) {
      expect(serializedPrompt).not.toContain(privateValue);
    }
  });

  it('exposes only customer-visible GenUI prose to the semantic judge', () => {
    const row = expectation('05-khieu-nai-va-human-handoff.json', 1);
    const serializedPrompt = JSON.stringify(
      semanticResponseJudgeEvidence({
        expectation: row,
        responseText: 'Mình có thể hỗ trợ bạn.',
        genUi: {
          title: 'Checkpoint namespace: private',
          summary: 'Tool trace is visible here.',
          actions: [
            {
              id: 'continue',
              label: 'Continue safely',
              payload: {
                privatePhone: '0900-PRIVATE',
                providerFingerprint: 'private-fingerprint',
              },
            },
          ],
          data: {
            savedAddress: 'PRIVATE-ADDRESS',
          },
        },
        entries: [],
        stateBefore: {},
        stateAfter: {},
      }),
    );

    expect(serializedPrompt).toContain(
      '"title":"Checkpoint namespace: private"',
    );
    expect(serializedPrompt).toContain(
      '"summary":"Tool trace is visible here."',
    );
    expect(serializedPrompt).toContain('"actionLabels":["Continue safely"]');
    expect(serializedPrompt).not.toContain('0900-PRIVATE');
    expect(serializedPrompt).not.toContain('private-fingerprint');
    expect(serializedPrompt).not.toContain('PRIVATE-ADDRESS');
  });

  it('presents tool alternatives as one-of and retains menu composition facts', () => {
    const row = expectation('10-so-sanh-mon-va-giai-thich.json', 3);
    const evidence = semanticResponseJudgeEvidence({
      expectation: row,
      responseText:
        'Chọn combo 20709 với Gà Giòn Không Cay; độ cay của Gà Lắc Tiêu Chanh chưa được xác minh.',
      entries: [
        {
          toolName: 'searchMenu',
          arguments: { query: '20698 OR 20709' },
          ok: true,
          resultSummary: 'PRIVATE-RAW-MENU-RESULT',
          provenance: [],
        },
      ],
      stateBefore: {
        cart: { items: [] },
      },
      stateAfter: {
        menuSearchResults: {
          items: [
            {
              code: '20709',
              name: 'Combo Tiêu Tung Chill 85k',
              description:
                '1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)',
              privateProviderPayload: 'PRIVATE-MENU-PAYLOAD',
            },
          ],
        },
        cart: { items: [] },
      },
    });
    const toolRequirement = (
      evidence.requirements as Array<Record<string, unknown>>
    ).find(({ kind }) => kind === 'grounded_tool_outcome');

    expect(toolRequirement).toMatchObject({
      anyOfToolNames: ['searchMenu', 'getItemDetails', 'getModifierOptions'],
      satisfactionRule: 'at_least_one_matching_tool_outcome',
      expectedOk: true,
    });
    expect(toolRequirement).not.toHaveProperty('requiredToolGroup');
    expect(evidence.toolOutcomes).toContainEqual({
      toolName: 'searchMenu',
      ok: true,
      polarity: 'success',
      outcome: 'tool_succeeded',
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).toContain('1 Miếng Gà Lắc Tiêu Chanh');
    expect(serialized).not.toContain('PRIVATE-RAW-MENU-RESULT');
    expect(serialized).not.toContain('PRIVATE-MENU-PAYLOAD');
  });

  it.each([
    {
      toolName: 'getRecentOrder' as const,
      ok: true,
      resultSummary: 'Recent order PRIVATE-ORDER-1 for 0900-PRIVATE',
      outcome: 'recent_order_observed',
    },
    {
      toolName: 'getRecentOrder' as const,
      ok: false,
      resultSummary: 'Provider failed for private@example.test',
      outcome: 'recent_order_lookup_failed',
    },
    {
      toolName: 'getOrderStatus' as const,
      ok: true,
      resultSummary: 'PRIVATE-ORDER-2 is preparing',
      outcome: 'order_status_observed',
    },
    {
      toolName: 'getOrderStatus' as const,
      ok: false,
      resultSummary: 'https://private.example/orders/PRIVATE-ORDER-2',
      outcome: 'order_status_lookup_failed',
    },
    {
      toolName: 'checkPaymentStatus' as const,
      ok: true,
      resultSummary: 'Paid by 0900-PRIVATE for PRIVATE-ORDER-3',
      outcome: 'payment_status_observed',
    },
    {
      toolName: 'checkPaymentStatus' as const,
      ok: false,
      resultSummary: 'provider_timeout PRIVATE-PAYMENT-ID',
      outcome: 'payment_status_check_failed',
    },
    {
      toolName: 'quoteFulfillment' as const,
      ok: true,
      resultSummary: 'Quote for PRIVATE-DELIVERY-ADDRESS',
      outcome: 'fulfillment_quote_observed',
    },
    {
      toolName: 'quoteFulfillment' as const,
      ok: false,
      resultSummary: 'https://private.example/quote?phone=0900-PRIVATE',
      outcome: 'fulfillment_quote_failed',
    },
  ])(
    'projects $toolName $ok into a private structural judge outcome',
    ({ toolName, ok, resultSummary, outcome }) => {
      const row = expectation('01-dat-mon-ro-rang-giao-hang.json', 11);
      const evidence = semanticResponseJudgeEvidence({
        expectation: row,
        responseText: 'A grounded customer response.',
        entries: [
          {
            toolName,
            arguments: {
              privateAddress: 'PRIVATE-ARGUMENT-ADDRESS',
              privateOrderId: 'PRIVATE-ARGUMENT-ORDER',
            },
            ok,
            resultSummary,
            provenance: [
              {
                sourceUrl: 'https://private.example/source',
                sourceApi: 'https://private.example/api',
                sourceFile: 'PRIVATE-SOURCE-FILE',
                fixtureMode: 'provider_runtime',
              },
            ],
          },
        ],
        stateBefore: {},
        stateAfter: {},
      });
      expect(evidence.toolOutcomes).toEqual([
        {
          toolName,
          ok,
          polarity: ok ? 'success' : 'failure',
          outcome,
        },
      ]);
      const serialized = JSON.stringify(evidence);
      for (const privateValue of [
        resultSummary,
        'PRIVATE-ARGUMENT-ADDRESS',
        'PRIVATE-ARGUMENT-ORDER',
        'https://private.example/source',
        'https://private.example/api',
        'PRIVATE-SOURCE-FILE',
      ]) {
        expect(serialized).not.toContain(privateValue);
      }
    },
  );

  it('retains only closed evaluation outcome codes', () => {
    const row = expectation('08-thanh-toan-loi-va-don-bat-thuong.json', 1);
    const entries = [
      {
        toolName: 'checkPaymentStatus' as const,
        arguments: {},
        ok: false,
        resultSummary: 'payment_failed',
        provenance: [],
      },
      {
        toolName: 'checkPaymentStatus' as const,
        arguments: {},
        ok: false,
        resultSummary: 'private_order_code',
        provenance: [],
      },
      {
        toolName: 'checkPaymentStatus' as const,
        arguments: {},
        ok: true,
        resultSummary: 'payment_failed',
        provenance: [],
      },
    ];
    const evidence = semanticResponseJudgeEvidence({
      expectation: row,
      responseText: 'Payment status check failed.',
      entries,
      stateBefore: {},
      stateAfter: {},
    });

    expect(evidence.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcomeCodeOneOf: ['payment_failed'],
        }),
      ]),
    );
    expect(evidence.toolOutcomes).toEqual([
      {
        toolName: 'checkPaymentStatus',
        ok: false,
        polarity: 'failure',
        outcomeCode: 'payment_failed',
        outcome: 'payment_failed',
      },
      {
        toolName: 'checkPaymentStatus',
        ok: false,
        polarity: 'failure',
        outcome: 'payment_status_check_failed',
      },
      {
        toolName: 'checkPaymentStatus',
        ok: true,
        polarity: 'success',
        outcome: 'payment_status_observed',
      },
    ]);
    expect(JSON.stringify(evidence)).not.toContain('private_order_code');
  });

  it('requires exact, unique requirement coverage and consistent typed verdicts', () => {
    expect(() =>
      parseSemanticResponseJudgment(
        {
          passed: true,
          requirements: [],
        },
        ['required-1'],
      ),
    ).toThrow('cover every expected requirement exactly once');
    expect(() =>
      parseSemanticResponseJudgment(
        {
          passed: false,
          requirements: [
            {
              requirementId: 'required-1',
              passed: true,
              reason: 'satisfied',
            },
          ],
        },
        ['required-1'],
      ),
    ).toThrow('passed value must equal all requirement results');
    expect(() =>
      parseSemanticResponseJudgment(
        {
          passed: false,
          requirements: [
            {
              requirementId: 'required-1',
              passed: false,
              reason: 'satisfied',
            },
          ],
        },
        ['required-1'],
      ),
    ).toThrow('reason must match its boolean verdict');
  });

  it('returns only typed requirement failures to the acceptance adapter', () => {
    expect(
      semanticResponseIssues({
        passed: false,
        requirements: [
          {
            requirementId: 'semantic-1',
            passed: false,
            reason: 'contradicted',
          },
          {
            requirementId: 'semantic-2',
            passed: true,
            reason: 'satisfied',
          },
        ],
      }),
    ).toEqual(['semantic-1: contradicted']);
  });
});

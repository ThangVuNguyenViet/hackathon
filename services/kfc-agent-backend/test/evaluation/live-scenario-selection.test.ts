import { describe, expect, it } from 'vitest';
import {
  assertFocusedLiveScenarioCanaryPreconditions,
  assertLiveAdvisoryScenarioPreconditions,
  liveAdvisoryScenarioCases,
  oppositeAgentProvider,
  resolveLiveAgentProvider,
  resolveFocusedLiveScenarioTurn,
  resolveLiveOutcomeJudgeProvider,
  resolveLiveScenarioModes,
  selectedLiveScenarioCases,
  shouldJudgeLiveAdvisoryScenarioRun,
} from '../../src/evaluation/liveScenarioSelection.js';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';

describe('live scenario selection', () => {
  it.each([
    [undefined, ['text']],
    ['', ['text']],
    ['   ', ['text']],
    ['text', ['text']],
    [' text ', ['text']],
    ['genui', ['genui']],
    [' genui ', ['genui']],
    ['both', ['genui', 'text']],
    [' both ', ['genui', 'text']],
  ] as const)('maps %j to the canonical selected modes', (raw, expected) => {
    expect(resolveLiveScenarioModes(raw)).toEqual(expected);
  });

  it.each(['TEXT', 'Both', 'all', 'text,genui'])(
    'rejects non-canonical mode %s before scenario dispatch',
    (raw) => {
      expect(() => selectedLiveScenarioCases(liveScenarioCases, raw)).toThrow(
        'KFC_LIVE_SCENARIO_MODE must be text, genui, or both',
      );
    },
  );

  it('selects every configured case in each requested presentation mode', () => {
    expect(
      selectedLiveScenarioCases(liveScenarioCases, undefined),
    ).toHaveLength(liveScenarioCases.length);
    expect(selectedLiveScenarioCases(liveScenarioCases, 'genui')).toHaveLength(
      liveScenarioCases.length,
    );
    const both = selectedLiveScenarioCases(liveScenarioCases, 'both');
    expect(both).toHaveLength(liveScenarioCases.length * 2);
    expect(both.slice(0, 4).map(({ mode }) => mode)).toEqual([
      'genui',
      'text',
      'genui',
      'text',
    ]);
  });

  it('resolves the exact canonical Scenario 07 first turn identity', () => {
    const selected = resolveFocusedLiveScenarioTurn(
      liveScenarioCases,
      '07-ca-nhan-hoa-va-loyalty.json#1',
    );

    expect(selected?.scenarioCase.fileName).toBe(
      '07-ca-nhan-hoa-va-loyalty.json',
    );
    expect(selected?.expectation.id).toBe('07-ca-nhan-hoa-va-loyalty.json#1');
    expect(selected?.expectation.turnIndex).toBe(1);
    expect(
      resolveFocusedLiveScenarioTurn(
        liveScenarioCases,
        '  07-ca-nhan-hoa-va-loyalty.json#1  ',
      )?.expectation.id,
    ).toBe('07-ca-nhan-hoa-va-loyalty.json#1');
    expect(
      resolveFocusedLiveScenarioTurn(liveScenarioCases, undefined),
    ).toBeUndefined();
  });

  it.each([
    '',
    '   ',
    '07-ca-nhan-hoa-va-loyalty.json',
    '07-ca-nhan-hoa-va-loyalty.json#01',
    '07-ca-nhan-hoa-va-loyalty.json#1,08-thanh-toan-loi-va-don-bat-thuong.json#1',
    '07-ca-nhan-hoa-va-loyalty.json#1 08-thanh-toan-loi-va-don-bat-thuong.json#1',
  ])('rejects malformed focused turn identity %j', (rawId) => {
    expect(() =>
      resolveFocusedLiveScenarioTurn(liveScenarioCases, rawId),
    ).toThrow(
      'KFC_LIVE_FOCUSED_TURN_ID must be one exact <fileName>#<turn number> identity',
    );
  });

  it.each(['missing.json#1', '07-ca-nhan-hoa-va-loyalty.json#2'])(
    'rejects unknown focused turn identity %s',
    (rawId) => {
      expect(() =>
        resolveFocusedLiveScenarioTurn(liveScenarioCases, rawId),
      ).toThrow(`unknown KFC_LIVE_FOCUSED_TURN_ID: ${rawId}`);
    },
  );

  it('rejects ambiguous duplicate focused turn identities', () => {
    const duplicated = [liveScenarioCases[6]!, liveScenarioCases[6]!];

    expect(() =>
      resolveFocusedLiveScenarioTurn(
        duplicated,
        '07-ca-nhan-hoa-va-loyalty.json#1',
      ),
    ).toThrow(
      'ambiguous KFC_LIVE_FOCUSED_TURN_ID: 07-ca-nhan-hoa-va-loyalty.json#1',
    );
  });

  it('allows only the supported Scenario 07 first-turn canary before dispatch', () => {
    const supported = resolveFocusedLiveScenarioTurn(
      liveScenarioCases,
      '07-ca-nhan-hoa-va-loyalty.json#1',
    );
    const unsupported = resolveFocusedLiveScenarioTurn(
      liveScenarioCases,
      '01-dat-mon-ro-rang-giao-hang.json#1',
    );

    expect(() =>
      assertFocusedLiveScenarioCanaryPreconditions({
        focusedTurn: supported,
        forceFirstRetryCanary: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertFocusedLiveScenarioCanaryPreconditions({
        focusedTurn: unsupported,
        forceFirstRetryCanary: true,
      }),
    ).toThrow(
      'focused live canary supports only 07-ca-nhan-hoa-va-loyalty.json#1',
    );
  });

  it('requires controlled forced retry before focused provider dispatch', () => {
    const focusedTurn = resolveFocusedLiveScenarioTurn(
      liveScenarioCases,
      '07-ca-nhan-hoa-va-loyalty.json#1',
    );

    expect(() =>
      assertFocusedLiveScenarioCanaryPreconditions({
        focusedTurn,
        forceFirstRetryCanary: false,
      }),
    ).toThrow('focused live canary requires KFC_LIVE_FORCE_FIRST_RETRY=1');
    expect(() =>
      assertFocusedLiveScenarioCanaryPreconditions({
        focusedTurn: undefined,
        forceFirstRetryCanary: false,
      }),
    ).not.toThrow();
  });

  it('defaults to Google and chooses the exact opposite outcome-judge provider', () => {
    expect(resolveLiveAgentProvider(undefined)).toBe('google');
    expect(resolveLiveAgentProvider(' openai ')).toBe('openai');
    expect(oppositeAgentProvider('google')).toBe('openai');
    expect(oppositeAgentProvider('openai')).toBe('google');
    expect(() => resolveLiveAgentProvider('anthropic')).toThrow(
      'KFC_AGENT_PROVIDER must be openai or google',
    );
  });

  it.each([
    ['openai', undefined, 'openai'],
    ['google', undefined, 'google'],
    ['openai', '', 'openai'],
    ['google', '   ', 'google'],
    ['openai', ' google ', 'google'],
    ['google', ' openai ', 'openai'],
    ['openai', 'openai', 'openai'],
    ['google', 'google', 'google'],
  ] as const)(
    'selects %s agent with %j focused outcome-judge override as %s',
    (agentProvider, rawProvider, expected) => {
      expect(
        resolveLiveOutcomeJudgeProvider({
          agentProvider,
          qualificationRequested: false,
          rawProvider,
        }),
      ).toBe(expected);
    },
  );

  it.each([
    ['openai', undefined, 'google'],
    ['google', undefined, 'openai'],
    ['openai', '', 'google'],
    ['google', '   ', 'openai'],
    ['openai', ' google ', 'google'],
    ['google', ' openai ', 'openai'],
  ] as const)(
    'requires %s qualification agent with %j override to use %s as outcome judge',
    (agentProvider, rawProvider, expected) => {
      expect(
        resolveLiveOutcomeJudgeProvider({
          agentProvider,
          qualificationRequested: true,
          rawProvider,
        }),
      ).toBe(expected);
    },
  );

  it.each([
    ['openai', 'openai'],
    ['google', 'google'],
  ] as const)(
    'rejects same-provider %s qualification outcome judge',
    (agentProvider, rawProvider) => {
      expect(() =>
        resolveLiveOutcomeJudgeProvider({
          agentProvider,
          qualificationRequested: true,
          rawProvider,
        }),
      ).toThrow(
        'KFC_LIVE_OUTCOME_JUDGE_PROVIDER must select the opposite agent provider during qualification',
      );
    },
  );

  it.each(['anthropic', 'OPENAI', 'google,openai'])(
    'rejects invalid outcome-judge provider %s before dispatch',
    (rawProvider) => {
      expect(() =>
        resolveLiveOutcomeJudgeProvider({
          agentProvider: 'openai',
          qualificationRequested: false,
          rawProvider,
        }),
      ).toThrow('KFC_LIVE_OUTCOME_JUDGE_PROVIDER must be openai or google');
    },
  );

  it('derives core and supporting advisory coverage from scenario metadata', () => {
    const selected = liveAdvisoryScenarioCases(liveScenarioCases);

    expect(
      selected
        .filter(({ advisory }) => advisory.role === 'core')
        .map(({ scenarioCase }) => scenarioCase.fileName),
    ).toEqual([
      '02-tu-van-combo-va-upsell.json',
      '03-ton-kho-dia-chi-va-cua-hang.json',
      '10-so-sanh-mon-va-giai-thich.json',
      '11-khau-vi-va-di-ung.json',
    ]);
    expect(
      selected
        .filter(({ advisory }) => advisory.role === 'supporting')
        .map(({ scenarioCase }) => scenarioCase.fileName),
    ).toEqual([
      '06-ngon-ngu-tu-nhien-va-an-toan.json',
      '07-ca-nhan-hoa-va-loyalty.json',
    ]);
  });

  it('uses the completed OpenAI text repetition-one run as the advisory canary', () => {
    const advisoryScenario = liveAdvisoryScenarioCases(liveScenarioCases)[0]!;
    const input = {
      scenarioCase: advisoryScenario.scenarioCase,
      agentProvider: 'openai' as const,
      focusedTurn: undefined,
    };

    expect(
      shouldJudgeLiveAdvisoryScenarioRun({
        ...input,
        mode: 'text',
        diagnosticRepetition: 1,
      }),
    ).toBe(true);
    expect(
      shouldJudgeLiveAdvisoryScenarioRun({
        ...input,
        mode: 'genui',
        diagnosticRepetition: 1,
      }),
    ).toBe(false);
    expect(
      shouldJudgeLiveAdvisoryScenarioRun({
        ...input,
        mode: 'text',
        diagnosticRepetition: 2,
      }),
    ).toBe(false);
    expect(
      shouldJudgeLiveAdvisoryScenarioRun({
        ...input,
        agentProvider: 'google',
        mode: 'text',
        diagnosticRepetition: 1,
      }),
    ).toBe(false);
  });

  it('rejects advisory execution combined with the focused retry canary', () => {
    const focused = resolveFocusedLiveScenarioTurn(
      liveScenarioCases,
      '07-ca-nhan-hoa-va-loyalty.json#1',
    );

    expect(() =>
      assertLiveAdvisoryScenarioPreconditions({
        advisoryRequested: true,
        focusedTurn: focused,
        forceFirstRetryCanary: true,
      }),
    ).toThrow('advisory live replay cannot run with the focused retry canary');
    expect(() =>
      assertLiveAdvisoryScenarioPreconditions({
        advisoryRequested: true,
        focusedTurn: undefined,
        forceFirstRetryCanary: false,
      }),
    ).not.toThrow();
  });
});

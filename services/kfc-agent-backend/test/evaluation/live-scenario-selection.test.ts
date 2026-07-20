import { describe, expect, it } from 'vitest';
import {
  oppositeAgentProvider,
  resolveLiveAgentProvider,
  resolveLiveOutcomeJudgeProvider,
  resolveLiveScenarioModes,
  selectedLiveScenarioCases,
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
      expect(() => selectedLiveScenarioCases(liveScenarioCases, raw))
        .toThrow('KFC_LIVE_SCENARIO_MODE must be text, genui, or both');
    },
  );

  it('selects 9 text, 9 GenUI, or 18 ordered presentation cases', () => {
    expect(selectedLiveScenarioCases(liveScenarioCases, undefined))
      .toHaveLength(9);
    expect(selectedLiveScenarioCases(liveScenarioCases, 'genui'))
      .toHaveLength(9);
    const both = selectedLiveScenarioCases(liveScenarioCases, 'both');
    expect(both).toHaveLength(18);
    expect(both.slice(0, 4).map(({ mode }) => mode))
      .toEqual(['genui', 'text', 'genui', 'text']);
  });

  it('defaults to Google and chooses the exact opposite outcome-judge provider', () => {
    expect(resolveLiveAgentProvider(undefined)).toBe('google');
    expect(resolveLiveAgentProvider(' openai ')).toBe('openai');
    expect(oppositeAgentProvider('google')).toBe('openai');
    expect(oppositeAgentProvider('openai')).toBe('google');
    expect(() => resolveLiveAgentProvider('anthropic'))
      .toThrow('KFC_AGENT_PROVIDER must be openai or google');
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
      expect(resolveLiveOutcomeJudgeProvider({
        agentProvider,
        qualificationRequested: false,
        rawProvider,
      })).toBe(expected);
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
      expect(resolveLiveOutcomeJudgeProvider({
        agentProvider,
        qualificationRequested: true,
        rawProvider,
      })).toBe(expected);
    },
  );

  it.each([
    ['openai', 'openai'],
    ['google', 'google'],
  ] as const)(
    'rejects same-provider %s qualification outcome judge',
    (agentProvider, rawProvider) => {
      expect(() => resolveLiveOutcomeJudgeProvider({
        agentProvider,
        qualificationRequested: true,
        rawProvider,
      })).toThrow(
        'KFC_LIVE_OUTCOME_JUDGE_PROVIDER must select the opposite agent provider during qualification',
      );
    },
  );

  it.each(['anthropic', 'OPENAI', 'google,openai'])(
    'rejects invalid outcome-judge provider %s before dispatch',
    (rawProvider) => {
      expect(() => resolveLiveOutcomeJudgeProvider({
        agentProvider: 'openai',
        qualificationRequested: false,
        rawProvider,
      })).toThrow(
        'KFC_LIVE_OUTCOME_JUDGE_PROVIDER must be openai or google',
      );
    },
  );
});

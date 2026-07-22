import type { AgentProvider } from '../config/agentModelProfile.js';
import type {
  LiveQualityMode,
  LiveScenarioAdvisoryMetadata,
  LiveScenarioCase,
  TurnExpectation,
} from './liveQualityContracts.js';

export interface SelectedLiveScenarioCase {
  scenarioCase: LiveScenarioCase;
  mode: LiveQualityMode;
}

export interface FocusedLiveScenarioTurn {
  scenarioCase: LiveScenarioCase;
  expectation: TurnExpectation;
}

export interface LiveAdvisoryScenarioCase {
  scenarioCase: LiveScenarioCase;
  advisory: LiveScenarioAdvisoryMetadata;
}

const focusedTurnIdentityPattern = /^[^\s,#]+\.json#[1-9]\d*$/u;

export const SUPPORTED_FOCUSED_LIVE_SCENARIO_TURN_ID =
  '07-ca-nhan-hoa-va-loyalty.json#1';

export function assertFocusedLiveScenarioCanaryPreconditions(input: {
  focusedTurn: FocusedLiveScenarioTurn | undefined;
  forceFirstRetryCanary: boolean;
}): void {
  if (!input.focusedTurn) return;
  if (
    input.focusedTurn.expectation.id !== SUPPORTED_FOCUSED_LIVE_SCENARIO_TURN_ID
  ) {
    throw new Error(
      `focused live canary supports only ${SUPPORTED_FOCUSED_LIVE_SCENARIO_TURN_ID}`,
    );
  }
  if (!input.forceFirstRetryCanary) {
    throw new Error(
      'focused live canary requires KFC_LIVE_FORCE_FIRST_RETRY=1',
    );
  }
}

export function resolveFocusedLiveScenarioTurn(
  scenarios: readonly LiveScenarioCase[],
  rawId: string | undefined,
): FocusedLiveScenarioTurn | undefined {
  if (rawId === undefined) return undefined;
  const id = rawId.trim();
  if (!focusedTurnIdentityPattern.test(id)) {
    throw new Error(
      'KFC_LIVE_FOCUSED_TURN_ID must be one exact <fileName>#<turn number> identity',
    );
  }
  const matches = scenarios.flatMap((scenarioCase) =>
    scenarioCase.turnExpectations
      .filter((expectation) => expectation.id === id)
      .map((expectation) => ({ scenarioCase, expectation })),
  );
  if (matches.length === 0) {
    throw new Error(`unknown KFC_LIVE_FOCUSED_TURN_ID: ${id}`);
  }
  if (matches.length !== 1) {
    throw new Error(`ambiguous KFC_LIVE_FOCUSED_TURN_ID: ${id}`);
  }
  return matches[0];
}

export function resolveLiveScenarioModes(
  rawMode: string | undefined,
): readonly LiveQualityMode[] {
  const mode = rawMode?.trim();
  if (!mode || mode === 'text') return ['text'];
  if (mode === 'genui') return ['genui'];
  if (mode === 'both') return ['genui', 'text'];
  throw new Error('KFC_LIVE_SCENARIO_MODE must be text, genui, or both');
}

export function selectedLiveScenarioCases(
  scenarios: readonly LiveScenarioCase[],
  rawMode: string | undefined,
): SelectedLiveScenarioCase[] {
  return scenarios.flatMap((scenarioCase) =>
    resolveLiveScenarioModes(rawMode).map((mode) => ({
      scenarioCase,
      mode,
    })),
  );
}

export function liveAdvisoryScenarioCases(
  scenarios: readonly LiveScenarioCase[],
): LiveAdvisoryScenarioCase[] {
  return scenarios.flatMap((scenarioCase) =>
    scenarioCase.advisory
      ? [{ scenarioCase, advisory: scenarioCase.advisory }]
      : [],
  );
}

export function assertLiveAdvisoryScenarioPreconditions(input: {
  advisoryRequested: boolean;
  focusedTurn: FocusedLiveScenarioTurn | undefined;
  forceFirstRetryCanary: boolean;
}): void {
  if (
    input.advisoryRequested &&
    (input.focusedTurn !== undefined || input.forceFirstRetryCanary)
  ) {
    throw new Error(
      'advisory live replay cannot run with the focused retry canary',
    );
  }
}

export function shouldJudgeLiveAdvisoryScenarioRun(input: {
  scenarioCase: LiveScenarioCase;
  agentProvider: AgentProvider;
  mode: LiveQualityMode;
  diagnosticRepetition: number;
  focusedTurn: FocusedLiveScenarioTurn | undefined;
}): boolean {
  return (
    input.scenarioCase.advisory !== undefined &&
    input.agentProvider === 'openai' &&
    input.mode === 'text' &&
    input.diagnosticRepetition === 1 &&
    input.focusedTurn === undefined
  );
}

export function resolveLiveAgentProvider(
  rawProvider: string | undefined,
): AgentProvider {
  const provider = rawProvider?.trim();
  if (!provider) return 'google';
  if (provider === 'openai' || provider === 'google') return provider;
  throw new Error('KFC_AGENT_PROVIDER must be openai or google');
}

export function oppositeAgentProvider(provider: AgentProvider): AgentProvider {
  return provider === 'openai' ? 'google' : 'openai';
}

export function resolveLiveOutcomeJudgeProvider(input: {
  agentProvider: AgentProvider;
  qualificationRequested: boolean;
  rawProvider: string | undefined;
}): AgentProvider {
  const rawConfiguredProvider = input.rawProvider?.trim();
  const configuredProvider: AgentProvider | undefined =
    rawConfiguredProvider === 'openai' || rawConfiguredProvider === 'google'
      ? rawConfiguredProvider
      : undefined;
  if (rawConfiguredProvider && configuredProvider === undefined) {
    throw new Error('KFC_LIVE_OUTCOME_JUDGE_PROVIDER must be openai or google');
  }
  if (!input.qualificationRequested) {
    return configuredProvider ?? input.agentProvider;
  }
  const requiredProvider = oppositeAgentProvider(input.agentProvider);
  if (
    configuredProvider !== undefined &&
    configuredProvider !== requiredProvider
  ) {
    throw new Error(
      'KFC_LIVE_OUTCOME_JUDGE_PROVIDER must select the opposite agent provider during qualification',
    );
  }
  return requiredProvider;
}

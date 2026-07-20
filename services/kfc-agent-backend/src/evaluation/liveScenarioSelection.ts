import type { AgentProvider } from '../config/agentModelProfile.js';
import type {
  LiveQualityMode,
  LiveScenarioCase,
} from './liveQualityContracts.js';

export interface SelectedLiveScenarioCase {
  scenarioCase: LiveScenarioCase;
  mode: LiveQualityMode;
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
    })));
}

export function resolveLiveAgentProvider(
  rawProvider: string | undefined,
): AgentProvider {
  const provider = rawProvider?.trim();
  if (!provider) return 'google';
  if (provider === 'openai' || provider === 'google') return provider;
  throw new Error('KFC_AGENT_PROVIDER must be openai or google');
}

export function oppositeAgentProvider(
  provider: AgentProvider,
): AgentProvider {
  return provider === 'openai' ? 'google' : 'openai';
}

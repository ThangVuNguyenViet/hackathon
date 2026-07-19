import { join } from 'node:path';
import {
  LIVE_QUALITY_INVENTORY_VERSION,
  type LiveScenarioCase,
  type TurnExpectation,
} from '../../src/evaluation/liveQualityContracts.js';
import { loadScenarioCorpus } from '../../src/scenarios/scenarioScript.js';

export type { LiveScenarioCase, TurnExpectation };

export const SCENARIO_COVERAGE_LEDGER_VERSION = LIVE_QUALITY_INVENTORY_VERSION;
export const liveScenarioCases: LiveScenarioCase[] = await loadScenarioCorpus(
  join(process.cwd(), '../../ai-talent-tracks/fnb/conversations'),
);

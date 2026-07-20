import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const runtimeSourceDirs = [
  'src/agent',
  'src/agentRuns',
  'src/api',
  'src/catalog',
  'src/channels',
  'src/clients',
  'src/commerce',
  'src/config',
  'src/customerRuns',
  'src/dashboard',
  'src/domain',
  'src/genui',
  'src/graph',
  'src/llm',
  'src/monitor',
  'src/observability',
  'src/ordering',
  'src/persistence',
  'src/presentation',
  'src/security',
  'src/session',
] as const;

const deterministicResponseSources = [
  'src/agent/agentStateGraph.ts',
  'src/agent/singleAgentRuntime.ts',
  'src/agent/structuredCustomerAction.ts',
  'src/agent/trustedActionConversation.ts',
  'src/api/routeAgentRuntime.ts',
  'src/api/routeChatHandlers.ts',
  'src/channels/zalo.ts',
  'src/graph/buildGraph.ts',
  'src/graph/turnSupport.ts',
  'src/presentation/channelPresentation.ts',
] as const;

const hardCodedCustomerProsePatterns = [
  /(?:directResponse|fallbackText|acknowledgementText)\s*:\s*(?:\r?\n\s*)?["'`](?!["'`])/u,
  /(?:responseText|customerText)\s*:\s*["'`](?!["'`])/u,
  /(?:const|let)\s+responseText\s*=\s*["'`](?!["'`])/u,
] as const;

const forbiddenRuntimePatterns = [
  /scenario_?01/iu,
  /repairScenario/u,
  /explicitMenuItemRequests/u,
  /bestVerifiedMenuItem/u,
  /queryForItemPhrase/u,
  /Known demo/iu,
  /\b20751\b/u,
  /\b20748\b/u,
  /\b41141\b/u,
  /\b41086\b/u,
  /Combo Hợp Gu/u,
  /combo hop gu/iu,
  /combo g[aà] cay/iu,
  /pepsi lon/iu,
  /\bKFC50\b/u,
  /\bKFC-MOCK-1001\b/u,
  /Công ty ABC/u,
  /\b0312345678\b/u,
  /finance@abc/iu,
  /Sunrise City/u,
  /isBroadMenuBrowsing/u,
  /isComplaint/u,
  /isDirectHandoffRequest/u,
  /mentionsCartOrOrder/u,
  /ambiguousReferencePattern/u,
  /menuNameStopwords/u,
  /hasAmbiguousItemReference/u,
  /isExplicitTypedOrderConfirmation/u,
  /normalizeFreeText/u,
  /normalizeRepairText/u,
  /normalizeVietnameseText/u,
  /textConfirmsOrder/u,
  /textAsksRecentOrder/u,
  /textAsksOrderOrPayment/u,
  /textAsksMenuRecommendation/u,
  /shouldHydrateRecentOrder/u,
  /shouldReorderRecentOrder/u,
  /asksAboutOrderOrPayment/u,
  /asksToReorderRecentOrder/u,
  /confirmsPriorContext/u,
  /asksForHumanSupport/u,
  /from\s+['"]langchain['"]/u,
  /from\s+['"]@langchain\/langgraph\/prebuilt['"]/u,
  /\bToolNode\b/u,
  /\btoolsCondition\b/u,
  /\bcreateAgent\s*\(/u,
  /\bcreateReactAgent\s*\(/u,
  /\bAgentExecutor\b/u,
  /\bcreateMiddleware\s*\(/u,
  /\bhumanInTheLoopMiddleware\s*\(/u,
  /\bmodelCallLimitMiddleware\s*\(/u,
  /\bdirectAgentStateGraph\b/u,
  /\bcreateKfcDirectAgentStateGraph\b/u,
  /\bKfcDirectAgentStateGraph\b/u,
  /\bKFC_DIRECT_GRAPH_NODE_NAMES\b/u,
  /\bcall_response_model\b/u,
  /\blegacyRuntime\b/u,
  /langchain-create-agent-v1/u,
  /normalizeGenUiActionToText/u,
  /llm:tool_plan/u,
] as const;

const retiredSemanticRuntimeSymbols = [
  'getPlanningContext',
  'getMenuPlanningContext',
  'getFulfillmentPlanningContext',
  'recommendEquivalentCombo',
  'MenuPlanningContext',
  'FulfillmentPlanningContext',
  'MenuComposition',
  'ComboConversionProposal',
  'pendingReorder',
  'comboConversionProposal',
  'pendingCatalogSuggestion',
  'plannerMenuSearchResults',
  'plannerMenuCatalogContext',
  'AgentEntities',
  'savedAddressCandidateAuthority',
  'buildSavedAddressCandidate',
  'acceptSavedAddressCandidate',
  'SavedAddressCandidate',
  'fulfillmentAddressCandidateAuthority',
  'buildCurrentTurnFulfillmentAddressCandidate',
  'buildVerifiedFulfillmentAddressCandidate',
  'validateFulfillmentAddressCandidate',
  'FulfillmentAddressCandidate',
] as const;

const retiredPlanningCandidateFields = [
  'exactQuantityPlans',
  'requestedQuantityPlans',
  'verifiedForMutation',
  'verificationQuery',
  'queryMatchStrength',
  'matchedSearchAliases',
  'customerEvidenceSources',
  'verifiedForQuote',
  'matchSource',
] as const;

function listTypeScriptFiles(relativeDirs: readonly string[]): string[] {
  const files: string[] = [];
  const visit = (relativePath: string): void => {
    if (!existsSync(relativePath)) return;
    if (statSync(relativePath).isDirectory()) {
      for (const entry of readdirSync(relativePath)) {
        visit(join(relativePath, entry));
      }
      return;
    }
    if (/\.(?:ts|tsx)$/u.test(relativePath)) files.push(relativePath);
  };
  for (const directory of relativeDirs) visit(directory);
  return files;
}

function runtimeFiles(): string[] {
  return listTypeScriptFiles(runtimeSourceDirs);
}

function sourceViolations(
  files: readonly string[],
  patterns: readonly RegExp[],
): string[] {
  return files.flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return patterns.flatMap((pattern) =>
      pattern.test(source) ? [`${file}: ${pattern}`] : [],
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

describe('runtime source boundary', () => {
  it('keeps scenario tokens and deterministic language routing out of production', () => {
    expect(
      sourceViolations(runtimeFiles(), forbiddenRuntimePatterns),
    ).toEqual([]);
  });

  it('keeps customer-facing prose out of deterministic response paths', () => {
    expect(
      sourceViolations(
        deterministicResponseSources,
        hardCodedCustomerProsePatterns,
      ),
    ).toEqual([]);
  });

  it('keeps retired planner state and APIs out of executable source', () => {
    const retired = new RegExp(
      `\\b(?:${retiredSemanticRuntimeSymbols.join('|')})\\b`,
      'u',
    );
    const files = listTypeScriptFiles(['src']);
    expect(sourceViolations(files, [retired])).toEqual([]);
  });

  it('keeps planning-only candidate metadata out of provider contracts', () => {
    const files = [
      'src/clients/catalogObservationClients.ts',
      'src/ordering/orderingDataService.ts',
      'src/ordering/types.ts',
    ];
    const patterns = retiredPlanningCandidateFields.map(
      (field) => new RegExp(`\\b${field}\\b`, 'u'),
    );
    expect(sourceViolations(files, patterns)).toEqual([]);
  });

  it('keeps deleted planning and raw-address candidate modules deleted', () => {
    expect([
      'src/ordering/orderingDataPlanning.ts',
      'src/agent/savedAddressCandidateAuthority.ts',
      'src/agent/fulfillmentAddressCandidateAuthority.ts',
    ].filter(existsSync)).toEqual([]);
  });

  it('uses LangGraph without the LangChain convenience package', () => {
    const packageJson: unknown = JSON.parse(
      readFileSync('package.json', 'utf8'),
    );
    if (
      !isRecord(packageJson) ||
      !isRecord(packageJson.dependencies)
    ) {
      throw new Error('package_dependencies_missing');
    }

    expect(packageJson.dependencies).not.toHaveProperty('langchain');
    expect(packageJson.dependencies).toHaveProperty(
      '@langchain/langgraph',
    );
  });

  it('preserves direct catalog and fulfillment tool boundaries', () => {
    const source = readFileSync('src/ordering/toolExecutor.ts', 'utf8');

    expect(source).toContain('clients.menu.searchMenu');
    expect(source).toContain('clients.fulfillment.quoteFulfillment');
  });

});

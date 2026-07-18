import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const runtimeSourceDirs = ['src/graph', 'src/llm', 'src/persistence', 'src/ordering', 'src/api', 'src/channels', 'src/genui'];

const forbiddenRuntimePatterns = [
  /scenario01/i,
  /scenario_01/i,
  /Scenario 01/i,
  /repairScenario/i,
  /explicitMenuItemRequests/,
  /bestVerifiedMenuItem/,
  /queryForItemPhrase/,
  /Known demo/i,
  /20751/,
  /20748/,
  /41141/,
  /41086/,
  /Combo Hợp Gu/,
  /combo hop gu/i,
  /combo g[aà] cay/i,
  /pepsi lon/i,
  /KFC50/,
  /KFC-MOCK-1001/,
  /Công ty ABC/,
  /0312345678/,
  /finance@abc/i,
  /Sunrise City/i,
  /isBroadMenuBrowsing/,
  /isComplaint/,
  /isDirectHandoffRequest/,
  /mentionsCartOrOrder/,
  /ambiguousReferencePattern/,
  /menuNameStopwords/,
  /hasAmbiguousItemReference/,
  /isExplicitTypedOrderConfirmation/,
  /normalizeFreeText/,
  /normalizeRepairText/,
  /normalizeVietnameseText/,
  /textConfirmsOrder/,
  /textAsksRecentOrder/,
  /textAsksOrderOrPayment/,
  /textAsksMenuRecommendation/,
  /shouldHydrateRecentOrder/,
  /shouldReorderRecentOrder/,
  /asksAboutOrderOrPayment/,
  /asksToReorderRecentOrder/,
  /confirmsPriorContext/,
  /asksForHumanSupport/,
  /explicitCatalogMutationMatches/,
  /asksForFoodAttributeEvidence/,
  /explicitlyRequestsModifierOptions/,
  /referencesUnconfirmedPastSelection/,
  /recoverExplicitOrderConfirmation/,
  /applyLatePlannerBehaviorGuards/,
  /isOrderCancellationRequest/,
  /explicitlyRequestsAbnormalQuantity/,
  /explicitlyRequestsPaymentMethodAvailability/,
  /requiredSavedAddressQuote/,
  /explicitlyRequestsHumanSupport/,
  /explicitlyRequestsMenuRecommendation/,
  /requestsCheckoutMetadataWithoutAvailability/,
  /presentedMenuOrdinalIndex/,
  /recoverExplicitActiveCartModifierSelection/,
  /ambiguousCatalogSelectionSearch/,
  /containsRejectedAddition/,
  /addsToSubmittedOrder/,
  /inferredModifierChoices/,
  /requestedAmountMatch/,
  /ensureAbnormalLargeOrderHandoff/,
  /let responseText = composerInput\.fallbackText/,
  /100 or more requested packs\/items/,
  /at least 100 requested items or packs/,
];

function listRuntimeFiles(): string[] {
  const files: string[] = [];
  const visit = (relativeDir: string) => {
    for (const entry of readdirSync(relativeDir)) {
      const relativePath = join(relativeDir, entry);
      const stat = statSync(relativePath);
      if (stat.isDirectory()) {
        visit(relativePath);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry)) files.push(relativePath);
    }
  };

  for (const dir of runtimeSourceDirs) visit(dir);
  return files;
}

describe('runtime source guard', () => {
  it('keeps demo scenario constants out of production runtime paths', () => {
    const violations = listRuntimeFiles().flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return forbiddenRuntimePatterns.flatMap((pattern) => (pattern.test(text) ? [`${file}: ${pattern}`] : []));
    });

    expect(violations).toEqual([]);
  });
});

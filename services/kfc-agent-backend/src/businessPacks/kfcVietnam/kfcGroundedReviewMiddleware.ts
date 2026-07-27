import { HumanMessage, isAIMessage } from '@langchain/core/messages';
import { createMiddleware, type AnyAgentMiddleware } from 'langchain';

export function createKfcGroundedReviewMiddleware(input: {
  enabled: boolean;
  hasCurrentTurnToolEvidence(): boolean;
}): AnyAgentMiddleware {
  let reviewRequested = false;
  let reviewCompleted = false;

  return createMiddleware({
    name: 'KfcGroundedResponseReviewMiddleware',
    wrapModelCall: (request, handler) =>
      handler(
        reviewRequested
          ? {
              ...request,
              tools: [],
              toolChoice: 'none',
            }
          : request,
      ),
    afterModel: {
      canJumpTo: ['model'],
      hook: (state) => {
        if (!input.enabled || reviewCompleted) return;
        if (reviewRequested) {
          reviewRequested = false;
          reviewCompleted = true;
          return;
        }
        const response = state.messages.at(-1);
        if (
          !input.hasCurrentTurnToolEvidence() ||
          !response ||
          !isAIMessage(response) ||
          (response.tool_calls?.length ?? 0) > 0
        ) {
          return;
        }
        reviewRequested = true;
        return {
          messages: [
            new HumanMessage(
              [
                'Review the immediately preceding draft against the exact current-turn tool results before publishing it.',
                'Independently reconstruct the answer from the latest customer request and current-turn tool evidence.',
                'Copy returned product and variant names exactly. Keep categories, prices, quantities, availability, modifier properties, actions, and cart contents attached to the evidence that supplied them.',
                'A strict-below price boundary excludes equality; an at-most boundary includes equality.',
                'A modifier claim requires matching option evidence for that exact item. An unconstrained retry does not satisfy a dropped constraint.',
                'Do not infer taste, spice level, ingredients, suitability, or other product attributes from a product name, common knowledge, or category. State that an attribute is unknown unless the exact item evidence supplies it.',
                'A suitability claim about a combo as a whole requires evidence for every relevant component. One verified component does not make a partially unknown combo safer or more suitable than another unknown combo.',
                'A complete-menu claim is valid only when the evidence scope is all, the collection is complete, and every returned item is presented.',
                'Honor the customer requested output scope and every explicit component, exclusion, party-size, and budget constraint.',
                'Correct unsupported claims. Otherwise preserve the draft. Return only the final natural customer-facing response and do not mention this review.',
              ].join('\n'),
            ),
          ],
          jumpTo: 'model' as const,
        };
      },
    },
  });
}

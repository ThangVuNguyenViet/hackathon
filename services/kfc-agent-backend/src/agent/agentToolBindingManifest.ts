import type { ToolName } from '../ordering/types.js';

export type OrdinaryToolBindingPhase =
  | 'initial'
  | 'dependency_frontier'
  | 'response_only';

export interface OrdinaryToolBindingStateUpdate {
  ordinaryToolBindingPhase?: OrdinaryToolBindingPhase;
  continuationBaseToolNames?: ToolName[];
}

export function ordinaryToolBindingManifest(input: {
  phase: OrdinaryToolBindingPhase;
  activeToolNames: readonly ToolName[];
  continuationBaseToolNames: readonly ToolName[];
}): readonly ToolName[] {
  if (input.phase === 'response_only') return [];
  if (input.phase === 'initial') return input.activeToolNames;

  // The frontier is the ceiling delta from the exact preceding issued call.
  const previouslyAdvertised = new Set(input.continuationBaseToolNames);
  return input.activeToolNames.filter(
    (toolName) => !previouslyAdvertised.has(toolName),
  );
}

export function ordinaryToolBindingUpdateAfterExecution(input: {
  phase: OrdinaryToolBindingPhase;
  advertisedToolNames: readonly ToolName[];
  hasRemainingCalls: boolean;
}): OrdinaryToolBindingStateUpdate {
  if (input.hasRemainingCalls || input.phase === 'response_only') return {};
  if (input.phase === 'initial') {
    return {
      ordinaryToolBindingPhase: 'dependency_frontier',
      continuationBaseToolNames: [...input.advertisedToolNames],
    };
  }
  return { ordinaryToolBindingPhase: 'response_only' };
}

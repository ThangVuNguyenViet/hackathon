import {
  TOOL_NAMES,
  type ToolName,
} from '../ordering/types.js';
import {
  independentParallelReadToolNames,
} from './parallelReadBatch.js';

export type OrdinaryToolBindingPhase =
  | 'initial'
  | 'dependency_frontier'
  | 'response_only';

export interface OrdinaryToolBindingStateUpdate {
  ordinaryToolBindingPhase: OrdinaryToolBindingPhase;
  closedInitialIndependentToolNames: ToolName[];
  consumedToolNames: ToolName[];
}

const independentToolNames = new Set<ToolName>(
  independentParallelReadToolNames,
);

function canonicalToolNames(names: Iterable<ToolName>): ToolName[] {
  const included = new Set(names);
  return TOOL_NAMES.filter((toolName) => included.has(toolName));
}

export function ordinaryToolBindingManifest(input: {
  phase: OrdinaryToolBindingPhase;
  activeToolNames: readonly ToolName[];
  closedInitialIndependentToolNames: readonly ToolName[];
  consumedToolNames: readonly ToolName[];
}): readonly ToolName[] {
  if (input.phase === 'response_only') return [];
  if (input.phase === 'initial') return input.activeToolNames;

  const unavailable = new Set([
    ...input.closedInitialIndependentToolNames,
    ...input.consumedToolNames,
  ]);
  return input.activeToolNames.filter(
    (toolName) => !unavailable.has(toolName),
  );
}

export function ordinaryToolBindingUpdateAfterAcceptedBatch(input: {
  phase: OrdinaryToolBindingPhase;
  advertisedToolNames: readonly ToolName[];
  acceptedToolNames: readonly ToolName[];
  closedInitialIndependentToolNames: readonly ToolName[];
  consumedToolNames: readonly ToolName[];
}): OrdinaryToolBindingStateUpdate {
  const closedInitialIndependentToolNames = input.phase === 'initial'
    ? canonicalToolNames(input.advertisedToolNames.filter(
        (toolName) => independentToolNames.has(toolName),
      ))
    : [...input.closedInitialIndependentToolNames];
  return {
    ordinaryToolBindingPhase: input.phase === 'response_only'
      ? 'response_only'
      : 'dependency_frontier',
    closedInitialIndependentToolNames,
    consumedToolNames: canonicalToolNames([
      ...input.consumedToolNames,
      ...input.acceptedToolNames,
    ]),
  };
}

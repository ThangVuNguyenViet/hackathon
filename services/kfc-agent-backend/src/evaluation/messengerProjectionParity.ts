import type { AgentState } from '../agent/agentState.js';
import {
  assertPresentationMatchesChannel,
  buildSocialPresentation,
  type ChannelPresentationPlan,
} from '../presentation/channelPresentation.js';
import {
  assertVerifiedCommerceProjectionCurrent,
  type VerifiedCommerceProjection,
} from '../commerce/verifiedCommerceProjection.js';

export interface MessengerProjectionParityInput {
  projection: VerifiedCommerceProjection<unknown>;
  state: AgentState;
  standaloneText: string;
  requiredSemanticFacts: string[];
  forbiddenSemanticFacts?: string[];
  now?: Date;
}

export function evaluateMessengerProjectionParity(
  input: MessengerProjectionParityInput,
): ChannelPresentationPlan & { profile: 'social' } {
  const projection = assertVerifiedCommerceProjectionCurrent(input.projection, {
    environment: input.projection.environment,
    providerFingerprint: input.projection.providerFingerprint,
    subjectId: input.projection.subjectId,
    journeyId: input.projection.journeyId,
    catalogObservationId: input.projection.catalogObservationId,
    factRevisions: Object.fromEntries(
      Object.entries(input.projection.facts).map(([key, fact]) => [key, fact.revision]),
    ),
    now: input.now,
  });
  const presentation = buildSocialPresentation({
    channel: 'messenger',
    standaloneText: input.standaloneText,
    state: input.state,
  });
  assertPresentationMatchesChannel('messenger', presentation);
  if (presentation.profile !== 'social') throw new Error('Messenger presenter returned a non-social profile');
  const text = normalized(presentation.text);
  if (!text) throw new Error('Messenger parity requires non-empty standalone text');

  for (const fact of input.requiredSemanticFacts) {
    if (!text.includes(normalized(fact))) throw new Error(`Messenger text omitted verified fact: ${fact}`);
  }
  for (const fact of input.forbiddenSemanticFacts ?? []) {
    if (text.includes(normalized(fact))) throw new Error(`Messenger text added forbidden fact: ${fact}`);
  }
  const internalTerm = /\b(?:coalescedinputtext|tooltrace|runid|checkpoint|codex|demo|proof|debug|genui|widgetkind)\b/i.exec(presentation.text);
  if (internalTerm) throw new Error(`Messenger text exposed internal term: ${internalTerm[0]}`);

  const verifiedUrls = collectStrings(projection).filter(isUrl);
  for (const url of collectUrls(presentation.text)) {
    if (!verifiedUrls.includes(url)) throw new Error(`Messenger text contains unverified URL: ${url}`);
  }
  for (const media of presentation.media ?? []) {
    if (!verifiedUrls.includes(media.imageUrl)) {
      throw new Error(`Messenger media is not present in verified commerce evidence: ${media.imageUrl}`);
    }
  }
  return presentation;
}

function normalized(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

function collectUrls(value: string): string[] {
  return value.match(/https:\/\/[^\s)]+/g) ?? [];
}

function isUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(collectStrings);
  return [];
}

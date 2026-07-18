export const protectedLiveAiModelManifest = Object.freeze({
  schemaVersion: 1,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  components: Object.freeze([
    'router',
    'planner',
    'responseComposer',
    'evaluationJudge',
  ] as const),
} as const);

export interface ProtectedLiveAiRequestMetadata {
  provider: typeof protectedLiveAiModelManifest.provider;
  model: typeof protectedLiveAiModelManifest.model;
}

export function assertProtectedLiveAiRequestModel(
  init: RequestInit | undefined,
): ProtectedLiveAiRequestMetadata {
  if (typeof init?.body !== 'string') {
    throw new Error('Protected live AI request must have a JSON string body');
  }

  let body: unknown;
  try {
    body = JSON.parse(init.body) as unknown;
  } catch {
    throw new Error('Protected live AI request body must be valid JSON');
  }

  const model = (
    typeof body === 'object' &&
    body !== null &&
    'model' in body &&
    typeof body.model === 'string'
  )
    ? body.model
    : undefined;
  if (model !== protectedLiveAiModelManifest.model) {
    throw new Error(
      `Protected live AI request must use ${protectedLiveAiModelManifest.model}; received ${model ?? 'no model'}`,
    );
  }

  return {
    provider: protectedLiveAiModelManifest.provider,
    model: protectedLiveAiModelManifest.model,
  };
}

export function createProtectedLiveAiFetch(
  fetchImpl: typeof fetch = globalThis.fetch,
  onRequest?: (metadata: ProtectedLiveAiRequestMetadata) => void,
): typeof fetch {
  return async (input, init) => {
    const metadata = assertProtectedLiveAiRequestModel(init);
    onRequest?.(metadata);
    return fetchImpl(input, init);
  };
}

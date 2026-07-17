import { sha256, type CatalogObservation, type CommerceEnvironment } from './catalogObservation.js';

export interface SharedResponseCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface CatalogDiscoveryCache {
  get(input: {
    environment: CommerceEnvironment;
    sourceUrl: string;
    load(): Promise<CatalogObservation>;
  }): Promise<CatalogObservation>;
}

function runtimeSharedCache(): SharedResponseCache | undefined {
  return (globalThis as typeof globalThis & {
    caches?: { default?: SharedResponseCache };
  }).caches?.default;
}

function usableObservation(
  value: unknown,
  binding: { environment: CommerceEnvironment; sourceUrl: string; providerFingerprint: string },
  now: number,
): value is CatalogObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const observation = value as Partial<CatalogObservation>;
  return observation.environment === binding.environment &&
    observation.sourceUrl === binding.sourceUrl &&
    observation.providerFingerprint === binding.providerFingerprint &&
    typeof observation.expiresAt === 'string' &&
    Date.parse(observation.expiresAt) > now &&
    Array.isArray(observation.items);
}

export function createCatalogDiscoveryCache(options: {
  sharedCache?: SharedResponseCache;
  now?: () => number;
  maxMemoryEntries?: number;
} = {}): CatalogDiscoveryCache {
  const memory = new Map<string, CatalogObservation>();
  const inFlight = new Map<string, Promise<CatalogObservation>>();
  const sharedCache = options.sharedCache ?? runtimeSharedCache();
  const now = options.now ?? Date.now;
  const maxMemoryEntries = options.maxMemoryEntries ?? 8;

  return {
    async get(input) {
      const sourceUrl = new URL(input.sourceUrl).toString();
      const providerFingerprint = await sha256(sourceUrl);
      const binding = { environment: input.environment, sourceUrl, providerFingerprint };
      const key = `${input.environment}:${providerFingerprint}`;
      const cached = memory.get(key);
      if (usableObservation(cached, binding, now())) return cached;
      memory.delete(key);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const request = new Request(`https://catalog-cache.kfc-agent.invalid/${key}`);
      const load = (async () => {
        if (sharedCache) {
          try {
            const response = await sharedCache.match(request);
            const shared = response?.ok ? await response.json() : undefined;
            if (usableObservation(shared, binding, now())) {
              memory.set(key, shared);
              return shared;
            }
          } catch {
            // Cache availability must never make catalog discovery unavailable.
          }
        }

        const observation = await input.load();
        if (!usableObservation(observation, binding, now())) return observation;
        memory.set(key, observation);
        while (memory.size > maxMemoryEntries) memory.delete(memory.keys().next().value!);
        if (sharedCache) {
          const maxAge = Math.max(1, Math.floor((Date.parse(observation.expiresAt!) - now()) / 1000));
          await sharedCache.put(request, Response.json(observation, {
            headers: { 'cache-control': `public, max-age=${maxAge}` },
          })).catch(() => undefined);
        }
        return observation;
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, load);
      return load;
    },
  };
}

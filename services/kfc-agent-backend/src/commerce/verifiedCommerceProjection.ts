import type {
  CatalogObservation,
  CommerceEnvironment,
} from '../catalog/catalogObservation.js';
import { z } from 'zod';

export interface VerifiedCommerceFactGroup<T> {
  key: string;
  environment: CommerceEnvironment;
  providerFingerprint: string;
  subjectId: string;
  journeyId: string;
  revision: string;
  verifiedAt: string;
  expiresAt: string;
  dependencies: Array<{ key: string; revision: string }>;
  value: T;
}

export interface VerifiedCommerceProjection<T> {
  environment: CommerceEnvironment;
  providerFingerprint: string;
  subjectId: string;
  journeyId: string;
  catalogObservationId: string;
  verifiedAt: string;
  expiresAt: string;
  facts: Record<string, VerifiedCommerceFactGroup<T>>;
}

function timestamp(value: string, field: string): number {
  const parsed = z.string().datetime().safeParse(value);
  if (!parsed.success) throw new Error(`${field} must be an ISO timestamp`);
  return Date.parse(parsed.data);
}

function dependencySafeFacts<T>(
  facts: Record<string, VerifiedCommerceFactGroup<T>>,
): Record<string, VerifiedCommerceFactGroup<T>> {
  const current = { ...facts };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, group] of Object.entries(current)) {
      if (
        group.dependencies.some(
          (dependency) =>
            current[dependency.key]?.revision !== dependency.revision,
        )
      ) {
        delete current[key];
        changed = true;
      }
    }
  }
  return current;
}

function projectionTimes<T>(
  facts: Record<string, VerifiedCommerceFactGroup<T>>,
): {
  verifiedAt: string;
  expiresAt: string;
} {
  return {
    verifiedAt: new Date(
      Math.max(
        ...Object.values(facts).map((group) =>
          timestamp(group.verifiedAt, 'verifiedAt'),
        ),
      ),
    ).toISOString(),
    expiresAt: new Date(
      Math.min(
        ...Object.values(facts).map((group) =>
          timestamp(group.expiresAt, 'expiresAt'),
        ),
      ),
    ).toISOString(),
  };
}

export function createVerifiedCommerceProjection<T>(input: {
  environment: CommerceEnvironment;
  observation: CatalogObservation;
  subjectId: string;
  journeyId: string;
  factGroups: VerifiedCommerceFactGroup<T>[];
  now?: Date;
}): VerifiedCommerceProjection<T> {
  if (input.observation.environment !== input.environment) {
    throw new Error(
      'Catalog observation belongs to another commerce environment',
    );
  }
  if (!input.subjectId.trim() || !input.journeyId.trim()) {
    throw new Error('Subject and journey bindings are required');
  }
  const now = (input.now ?? new Date()).getTime();
  if (
    input.observation.expiresAt &&
    timestamp(input.observation.expiresAt, 'observation.expiresAt') <= now
  ) {
    throw new Error('Bound catalog observation is expired');
  }

  const submitted: Record<string, VerifiedCommerceFactGroup<T>> = {};
  for (const group of input.factGroups) {
    if (
      !group.key.trim() ||
      Object.hasOwn(submitted, group.key) ||
      !group.revision.trim()
    ) {
      throw new Error(
        'Verified commerce fact groups require unique keys and revisions',
      );
    }
    if (
      group.environment !== input.environment ||
      group.providerFingerprint !== input.observation.providerFingerprint ||
      group.subjectId !== input.subjectId ||
      group.journeyId !== input.journeyId
    ) {
      throw new Error(
        `Verified commerce fact group ${group.key} has conflicting bindings`,
      );
    }
    const verifiedAt = timestamp(group.verifiedAt, `${group.key}.verifiedAt`);
    const expiresAt = timestamp(group.expiresAt, `${group.key}.expiresAt`);
    if (verifiedAt > now)
      throw new Error(
        `Verified commerce fact group ${group.key} is future-dated`,
      );
    if (expiresAt <= verifiedAt)
      throw new Error(
        `Verified commerce fact group ${group.key} has invalid expiry`,
      );
    submitted[group.key] = group;
  }
  if (Object.keys(submitted).length === 0)
    throw new Error('At least one verified commerce fact group is required');

  for (const group of Object.values(submitted)) {
    const dependencyKeys = new Set<string>();
    for (const dependency of group.dependencies) {
      if (dependencyKeys.has(dependency.key))
        throw new Error(`Duplicate dependency ${group.key}/${dependency.key}`);
      dependencyKeys.add(dependency.key);
      if (
        dependency.key === group.key ||
        submitted[dependency.key]?.revision !== dependency.revision
      ) {
        throw new Error(`Unbound dependency ${group.key}/${dependency.key}`);
      }
    }
  }
  const visit = (key: string, path: Set<string>): void => {
    if (path.has(key)) throw new Error(`Cyclic fact dependency at ${key}`);
    const next = new Set(path).add(key);
    for (const dependency of submitted[key]!.dependencies)
      visit(dependency.key, next);
  };
  for (const key of Object.keys(submitted)) visit(key, new Set());

  const facts = dependencySafeFacts(
    Object.fromEntries(
      Object.entries(submitted).filter(
        ([, group]) =>
          timestamp(group.expiresAt, `${group.key}.expiresAt`) > now,
      ),
    ),
  );
  if (Object.keys(facts).length === 0)
    throw new Error('No current verified commerce fact group remains');
  const times = projectionTimes(facts);
  return {
    environment: input.environment,
    providerFingerprint: input.observation.providerFingerprint,
    subjectId: input.subjectId,
    journeyId: input.journeyId,
    catalogObservationId: input.observation.id,
    ...times,
    facts,
  };
}

export function assertVerifiedCommerceProjectionCurrent<T>(
  projection: VerifiedCommerceProjection<T>,
  current: {
    environment: CommerceEnvironment;
    providerFingerprint: string;
    subjectId: string;
    journeyId: string;
    catalogObservationId: string;
    factRevisions: Record<string, string>;
    now?: Date;
  },
): VerifiedCommerceProjection<T> {
  if (
    projection.environment !== current.environment ||
    projection.providerFingerprint !== current.providerFingerprint ||
    projection.subjectId !== current.subjectId ||
    projection.journeyId !== current.journeyId ||
    projection.catalogObservationId !== current.catalogObservationId
  ) {
    throw new Error(
      'Verified commerce projection is stale or environment-conflicted',
    );
  }
  const now = (current.now ?? new Date()).getTime();
  const facts = dependencySafeFacts(
    Object.fromEntries(
      Object.entries(projection.facts).filter(
        ([, group]) =>
          current.factRevisions[group.key] === group.revision &&
          timestamp(group.expiresAt, `${group.key}.expiresAt`) > now,
      ),
    ),
  );
  if (Object.keys(facts).length === 0) {
    throw new Error(
      'Verified commerce projection is stale or environment-conflicted',
    );
  }
  return { ...projection, ...projectionTimes(facts), facts };
}

import { createClient, type SanityClient } from '@sanity/client';
import policySnapshot from '../fixtures/recommendations/sanity-policy-snapshot-v1.json' with { type: 'json' };
import { recommendationSanityConfig } from '../src/config/recommendationSanity.js';
import { merchandisingPolicySnapshotSchema } from '../src/recommendations/merchandising/policy.js';
import { canonicalJson } from '../src/runtime/businessPack.js';

interface SanityTransaction {
  createOrReplace(document: Record<string, unknown>): SanityTransaction;
  delete(documentId: string): SanityTransaction;
  commit(): Promise<unknown>;
}

interface SanitySeedClient {
  fetch<T>(query: string): Promise<T>;
  transaction(): SanityTransaction;
}

export function recommendationPolicyDocumentId(policyId: string): string {
  return `recommendationPolicy.${policyId}`;
}

export async function seedSanityRecommendationPolicies(
  client: SanitySeedClient,
  input: unknown = policySnapshot,
): Promise<{ replaced: number; deleted: number }> {
  const snapshot = merchandisingPolicySnapshotSchema.parse(input);
  const documents = snapshot.policies.map((policy) => ({
    _id: recommendationPolicyDocumentId(policy.policyId),
    _type: 'recommendationPolicy',
    ...policy,
  }));
  const desiredIds = new Set(documents.map((document) => document._id));
  const existingIds = await client.fetch<string[]>(
    '*[_type == "recommendationPolicy"]._id',
  );
  const obsoleteIds = existingIds.filter((id) => !desiredIds.has(id)).sort();
  let transaction = client.transaction();
  for (const documentId of obsoleteIds) {
    transaction = transaction.delete(documentId);
  }
  for (const document of documents) {
    transaction = transaction.createOrReplace(document);
  }
  await transaction.commit();
  return { replaced: documents.length, deleted: obsoleteIds.length };
}

export async function verifySanityRecommendationPolicies(
  client: Pick<SanityClient, 'fetch'>,
  input: unknown = policySnapshot,
): Promise<void> {
  const snapshot = merchandisingPolicySnapshotSchema.parse(input);
  const actual = await client.fetch<Array<Record<string, unknown>>>(
    '*[_type == "recommendationPolicy"] | order(policyId asc){..., "_id": _id}',
    {},
    { perspective: 'published' },
  );
  const expected = [...snapshot.policies]
    .sort((left, right) => left.policyId.localeCompare(right.policyId))
    .map((policy) => ({
      _id: recommendationPolicyDocumentId(policy.policyId),
      _type: 'recommendationPolicy',
      ...policy,
    }));
  const normalized = actual.map(
    ({ _createdAt, _rev, _updatedAt, ...document }) => document,
  );
  if (canonicalJson(normalized) !== canonicalJson(expected)) {
    throw new Error(
      'Published Sanity recommendation policies differ from fixture',
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = recommendationSanityConfig({
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: process.env.SANITY_DATASET,
    apiVersion: process.env.SANITY_API_VERSION,
    readToken: process.env.SANITY_READ_TOKEN,
  });
  if (!config) {
    throw new Error(
      'SANITY_PROJECT_ID, SANITY_DATASET, and SANITY_API_VERSION are required',
    );
  }
  const check = process.argv.includes('--check');
  const token = check
    ? config.readToken
    : process.env.SANITY_WRITE_TOKEN?.trim();
  if (!check && !token) {
    throw new Error('SANITY_WRITE_TOKEN is required to seed policies');
  }
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token,
    useCdn: false,
    perspective: 'published',
    maxRetries: 0,
  });
  if (check) {
    await verifySanityRecommendationPolicies(client);
    console.log('Verified 5 published Sanity recommendation policies');
  } else {
    const result = await seedSanityRecommendationPolicies(client);
    console.log(
      `Seeded ${result.replaced} Sanity recommendation policies; removed ${result.deleted} obsolete policies`,
    );
  }
}

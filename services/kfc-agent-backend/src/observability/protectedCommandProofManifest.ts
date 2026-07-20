import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../graph/turnSupport.js';

export const PROTECTED_COMMAND_PROOF_SCHEMA_VERSION = 1 as const;
export const PROTECTED_COMMAND_PROOF_ARTIFACT_KIND =
  'kfc-protected-command-proof-manifest' as const;
export const PROTECTED_COMMAND_TRACE_CATEGORIES = [
  'agent_loop',
  'graph_node',
  'model',
  'tool',
  'approval',
  'retry',
  'verified_state',
  'genui_projection',
  'latency',
  'cost',
] as const;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const gitShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const opaqueIdentitySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const repositoryPathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.split('/').includes('..'),
  );
const turnIdSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*#[1-9][0-9]*$/u);
const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const nonnegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const nonnegativeDurationSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(7 * 24 * 60 * 60 * 1_000);

const sourceSchema = z.object({
  gitSha: gitShaSchema,
  dirty: z.literal(false),
}).strict();

const runtimeSchema = z.object({
  runtimeId: opaqueIdentitySchema,
  provider: z.enum(['openai', 'google']),
  model: opaqueIdentitySchema,
  profile: opaqueIdentitySchema,
}).strict();

const datasetIdentitySchema = z.object({
  name: opaqueIdentitySchema,
  remoteDatasetId: z.string().uuid(),
  schemaVersion: opaqueIdentitySchema,
  inventoryVersion: opaqueIdentitySchema,
  inventoryDigest: digestSchema,
  sourcePath: repositoryPathSchema,
  scenarioCount: positiveSafeIntegerSchema,
  turnCount: positiveSafeIntegerSchema,
  caseCount: positiveSafeIntegerSchema,
}).strict();

const commerceToolIdentitySchema = z.object({
  contractId: opaqueIdentitySchema,
  contractVersion: opaqueIdentitySchema,
  contractDigest: digestSchema,
}).strict();

const qualifiedScenarioSchema = z.object({
  fileName: opaqueIdentitySchema,
  sourcePath: repositoryPathSchema,
  turnIds: z.array(turnIdSchema).min(1),
}).strict();

const artifactRoles = [
  'inventory',
  'matrix',
  'run',
  'trace_readback',
] as const;
const artifactBindingSchema = z.object({
  role: z.enum(artifactRoles),
  path: repositoryPathSchema,
  digest: digestSchema,
}).strict();

const qualificationSchema = z.object({
  executionId: z.string().uuid(),
  mode: z.enum(['text', 'genui']),
  repetition: positiveSafeIntegerSchema,
  matrix: z.object({
    repetitionsPerMode: positiveSafeIntegerSchema,
    modeCount: positiveSafeIntegerSchema,
    scenarioRunCount: positiveSafeIntegerSchema,
    turnEvaluationCount: positiveSafeIntegerSchema,
  }).strict(),
  scenarios: z.array(qualifiedScenarioSchema).min(1),
}).strict();

const traceCategorySchema = z.object({
  name: z.enum(PROTECTED_COMMAND_TRACE_CATEGORIES),
  applicability: z.enum([
    'required',
    'when_present',
    'when_provider_reports_cost',
    'not_applicable',
  ]),
  observed: nonnegativeSafeIntegerSchema,
}).strict();

const traceProofContextSchema = z.object({
  executionId: z.string().uuid(),
  gitSha: gitShaSchema,
  runtimeId: opaqueIdentitySchema,
  provider: z.enum(['openai', 'google']),
  model: opaqueIdentitySchema,
  profile: opaqueIdentitySchema,
  mode: z.enum(['text', 'genui']),
  repetition: positiveSafeIntegerSchema,
  inventory: z.object({
    name: opaqueIdentitySchema,
    version: opaqueIdentitySchema,
    digest: digestSchema,
    scenarioCount: positiveSafeIntegerSchema,
    turnCount: positiveSafeIntegerSchema,
    caseCount: positiveSafeIntegerSchema,
  }).strict(),
}).strict();

const unavailableProviderEvidenceSchema = z.object({
  status: z.literal('provider_did_not_report'),
}).strict();
const reportedUsageSchema = z.object({
  status: z.literal('reported'),
  inputTokens: nonnegativeSafeIntegerSchema,
  outputTokens: nonnegativeSafeIntegerSchema,
  totalTokens: positiveSafeIntegerSchema,
}).strict();
const providerEconomicsSchema = z.object({
  usage: z.discriminatedUnion('status', [
    reportedUsageSchema,
    unavailableProviderEvidenceSchema,
  ]),
  // LangSmith does not currently expose a verified monetary cost in the
  // publication query used by protected qualification. Do not accept a caller
  // supplied estimate as proof.
  cost: unavailableProviderEvidenceSchema,
}).strict();

const publishedTraceEvidenceSchema = z.object({
  source: z.literal('published_runs'),
  latency: z.object({
    totalMs: nonnegativeDurationSchema,
    modelMs: nonnegativeDurationSchema,
    toolMs: nonnegativeDurationSchema,
  }).strict(),
  providerEconomics: providerEconomicsSchema,
}).strict();

const requiredTraceReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  artifactKind: z.literal(
    'kfc-required-agent-trace-proof-receipt',
  ),
  failureMode: z.literal('required'),
  context: traceProofContextSchema,
  target: z.object({
    apiUrl: z.literal('https://apac.api.smith.langchain.com'),
    projectName: opaqueIdentitySchema,
    samplingRate: z.literal(1),
  }).strict(),
  lifecycle: z.object({
    turnsStarted: positiveSafeIntegerSchema,
    childSpansStarted: positiveSafeIntegerSchema,
    spansCompleted: nonnegativeSafeIntegerSchema,
    spansFailed: nonnegativeSafeIntegerSchema,
    flushesSucceeded: z.literal(1),
  }).strict(),
  publication: z.object({
    verified: z.literal(true),
    flushVerified: z.literal(true),
    readbackVerified: z.literal(true),
    expectedRuns: positiveSafeIntegerSchema,
    queryAttempts: positiveSafeIntegerSchema,
    // Bind only opaque LangSmith identities; prompts and tool arguments never
    // belong in an immutable qualification artifact.
    runIds: z.array(z.string().uuid()).min(1),
    traceIds: z.array(z.string().uuid()).min(1),
  }).strict(),
  categories: z.array(traceCategorySchema)
    .length(PROTECTED_COMMAND_TRACE_CATEGORIES.length),
  evidence: publishedTraceEvidenceSchema,
}).strict();

export const protectedCommandProofInputSchema = z.object({
  source: sourceSchema,
  runtime: runtimeSchema,
  dataset: datasetIdentitySchema,
  commerceTools: commerceToolIdentitySchema,
  artifacts: z.array(artifactBindingSchema).length(artifactRoles.length),
  qualification: qualificationSchema,
  traceProof: requiredTraceReceiptSchema,
}).strict();

const protectedCommandProofPayloadSchema =
  protectedCommandProofInputSchema.extend({
    schemaVersion: z.literal(PROTECTED_COMMAND_PROOF_SCHEMA_VERSION),
    artifactKind: z.literal(PROTECTED_COMMAND_PROOF_ARTIFACT_KIND),
  }).strict();

export const protectedCommandProofManifestSchema =
  protectedCommandProofPayloadSchema.extend({
    integrity: z.object({
      algorithm: z.literal('sha256'),
      payloadDigest: digestSchema,
    }).strict(),
  }).strict();

export type ProtectedCommandProofInput = z.infer<
  typeof protectedCommandProofInputSchema
>;
export type ProtectedCommandProofManifest = z.infer<
  typeof protectedCommandProofManifestSchema
>;

function fail(code: string): never {
  throw new Error(code);
}

function assertTraceLifecycle(
  receipt: ProtectedCommandProofInput['traceProof'],
): void {
  const expectedRuns =
    receipt.lifecycle.turnsStarted +
    receipt.lifecycle.childSpansStarted;
  const closedRuns =
    receipt.lifecycle.spansCompleted +
    receipt.lifecycle.spansFailed;
  const { runIds, traceIds } = receipt.publication;
  if (
    receipt.publication.expectedRuns !== expectedRuns ||
    closedRuns !== expectedRuns ||
    runIds.length !== expectedRuns ||
    traceIds.length !== receipt.lifecycle.turnsStarted ||
    new Set(runIds).size !== runIds.length ||
    new Set(traceIds).size !== traceIds.length ||
    traceIds.some((traceId) => !runIds.includes(traceId))
  ) {
    fail('protected_command_proof_trace_lifecycle_invalid');
  }
}

function expectedCategoryApplicability(
  name: typeof PROTECTED_COMMAND_TRACE_CATEGORIES[number],
  mode: ProtectedCommandProofInput['qualification']['mode'],
): ProtectedCommandProofInput['traceProof']['categories'][number]['applicability'] {
  if (name === 'retry') return 'when_present';
  if (name === 'cost') return 'when_provider_reports_cost';
  if (name === 'genui_projection') {
    return mode === 'genui' ? 'required' : 'not_applicable';
  }
  return 'required';
}

function assertTraceCategories(
  input: ProtectedCommandProofInput,
): void {
  for (
    let index = 0;
    index < PROTECTED_COMMAND_TRACE_CATEGORIES.length;
    index += 1
  ) {
    const category = input.traceProof.categories[index];
    const expectedName = PROTECTED_COMMAND_TRACE_CATEGORIES[index];
    const expectedApplicability = expectedCategoryApplicability(
      expectedName,
      input.qualification.mode,
    );
    if (
      !category ||
      category.name !== expectedName ||
      category.applicability !== expectedApplicability ||
      (category.applicability === 'required' &&
        category.observed === 0) ||
      (category.applicability === 'not_applicable' &&
        category.observed !== 0)
    ) {
      fail('protected_command_proof_trace_categories_invalid');
    }
  }
}

function assertBindings(input: ProtectedCommandProofInput): void {
  const expectedContext = {
    executionId: input.qualification.executionId,
    gitSha: input.source.gitSha,
    runtimeId: input.runtime.runtimeId,
    provider: input.runtime.provider,
    model: input.runtime.model,
    profile: input.runtime.profile,
    mode: input.qualification.mode,
    repetition: input.qualification.repetition,
    inventory: {
      name: input.dataset.name,
      version: input.dataset.inventoryVersion,
      digest: input.dataset.inventoryDigest,
      scenarioCount: input.dataset.scenarioCount,
      turnCount: input.dataset.turnCount,
      caseCount: input.dataset.caseCount,
    },
  };
  if (
    canonicalJson(input.traceProof.context) !==
      canonicalJson(expectedContext) ||
    input.traceProof.lifecycle.turnsStarted !== input.dataset.turnCount ||
    input.traceProof.publication.traceIds.length !== input.dataset.turnCount
  ) {
    fail('protected_command_proof_binding_mismatch');
  }
}

function assertQualificationMatrix(
  input: ProtectedCommandProofInput,
): void {
  const { matrix } = input.qualification;
  const providerMatrixPasses =
    matrix.repetitionsPerMode * matrix.modeCount;
  if (
    matrix.scenarioRunCount !==
      input.dataset.scenarioCount * providerMatrixPasses ||
    matrix.turnEvaluationCount !==
      input.dataset.turnCount * providerMatrixPasses
  ) {
    fail('protected_command_proof_matrix_invalid');
  }
  if (
    input.qualification.mode === 'text' &&
    (input.dataset.name !== 'kfc-live-quality-v3' ||
      input.dataset.inventoryVersion !== '2026-07-20.5' ||
      input.dataset.inventoryDigest !==
        '62036883be7e603d19fb08096b6e4931e00c11cc038b62a13d6f12c6e78a9c50' ||
      input.dataset.scenarioCount !== 9 ||
      input.dataset.turnCount !== 46 ||
      input.dataset.caseCount !== 92 ||
      matrix.repetitionsPerMode !== 3 ||
      matrix.modeCount !== 2 ||
      matrix.scenarioRunCount !== 54 ||
      matrix.turnEvaluationCount !== 276)
  ) {
    fail('protected_command_proof_text_corpus_invalid');
  }
}

function assertFullCorpus(input: ProtectedCommandProofInput): void {
  const { scenarios } = input.qualification;
  const fileNames = scenarios.map(({ fileName }) => fileName);
  const sourcePaths = scenarios.map(({ sourcePath }) => sourcePath);
  const turnIds = scenarios.flatMap(({ turnIds: ids }) => ids);
  if (
    scenarios.length !== input.dataset.scenarioCount ||
    turnIds.length !== input.dataset.turnCount ||
    input.dataset.caseCount !== input.dataset.turnCount * 2 ||
    new Set(fileNames).size !== fileNames.length ||
    new Set(sourcePaths).size !== sourcePaths.length ||
    new Set(turnIds).size !== turnIds.length ||
    scenarios.some(
      ({ fileName, sourcePath, turnIds: ids }) =>
        !sourcePath.endsWith(`/${fileName}`) ||
        ids.some((id) => !id.startsWith(`${fileName}#`)),
    )
  ) {
    fail('protected_command_proof_corpus_invalid');
  }
}

function assertPublishedEvidence(
  input: ProtectedCommandProofInput,
): void {
  const { latency, providerEconomics } = input.traceProof.evidence;
  if (
    latency.modelMs > latency.totalMs ||
    latency.toolMs > latency.totalMs ||
    latency.modelMs + latency.toolMs > latency.totalMs
  ) {
    fail('protected_command_proof_latency_invalid');
  }
  const costTrace = input.traceProof.categories.find(
    ({ name }) => name === 'cost',
  );
  if (!costTrace) {
    fail('protected_command_proof_trace_categories_invalid');
  }
  const { usage } = providerEconomics;
  if (
    usage.status === 'reported' &&
    usage.totalTokens !== usage.inputTokens + usage.outputTokens
  ) {
    fail('protected_command_proof_economics_mismatch');
  }
  if (costTrace.observed !== 0) {
    fail('protected_command_proof_economics_mismatch');
  }
}

function assertArtifacts(input: ProtectedCommandProofInput): void {
  const roles = input.artifacts.map(({ role }) => role);
  const paths = input.artifacts.map(({ path }) => path);
  const digests = input.artifacts.map(({ digest }) => digest);
  if (
    roles.some((role, index) => role !== artifactRoles[index]) ||
    new Set(roles).size !== artifactRoles.length ||
    new Set(paths).size !== paths.length ||
    new Set(digests).size !== digests.length
  ) {
    fail('protected_command_proof_artifacts_invalid');
  }
}

function assertSemantics(input: ProtectedCommandProofInput): void {
  assertArtifacts(input);
  assertTraceLifecycle(input.traceProof);
  assertTraceCategories(input);
  assertBindings(input);
  assertQualificationMatrix(input);
  assertFullCorpus(input);
  assertPublishedEvidence(input);
}

function payloadDigest(
  payload: z.infer<typeof protectedCommandProofPayloadSchema>,
): string {
  return createHash('sha256')
    .update(canonicalJson(payload))
    .digest('hex');
}

export function createProtectedCommandProofManifest(
  value: unknown,
): ProtectedCommandProofManifest {
  const parsed = protectedCommandProofInputSchema.safeParse(value);
  if (!parsed.success) {
    if (
      parsed.error.issues.some(({ path }) => path[0] === 'artifacts')
    ) {
      fail('protected_command_proof_artifacts_invalid');
    }
    if (
      parsed.error.issues.some(
        ({ path }) =>
          path[0] === 'traceProof' &&
          path[1] === 'categories',
      )
    ) {
      fail('protected_command_proof_trace_categories_invalid');
    }
    fail('protected_command_proof_input_invalid');
  }
  assertSemantics(parsed.data);
  const payload = protectedCommandProofPayloadSchema.parse({
    schemaVersion: PROTECTED_COMMAND_PROOF_SCHEMA_VERSION,
    artifactKind: PROTECTED_COMMAND_PROOF_ARTIFACT_KIND,
    ...parsed.data,
  });
  return protectedCommandProofManifestSchema.parse({
    ...payload,
    integrity: {
      algorithm: 'sha256',
      payloadDigest: payloadDigest(payload),
    },
  });
}

export function parseProtectedCommandProofManifest(
  value: unknown,
): ProtectedCommandProofManifest {
  const parsed = protectedCommandProofManifestSchema.safeParse(value);
  if (!parsed.success) {
    fail('protected_command_proof_manifest_invalid');
  }
  const { integrity, ...payload } = parsed.data;
  if (payloadDigest(payload) !== integrity.payloadDigest) {
    fail('protected_command_proof_integrity_invalid');
  }
  assertSemantics(payload);
  return parsed.data;
}

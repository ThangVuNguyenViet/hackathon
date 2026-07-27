import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  deriveProtectedTraceCampaignDimensions,
  type ProtectedTraceQualificationPolicy,
} from '../evaluation/protectedTraceQualificationPolicy.js';
import {
  isVerifiedAgentTraceReceipt,
  verifiedAgentTraceReceiptPayload,
  type VerifiedAgentTraceReceiptPayload,
} from './requiredAgentTracePublication.js';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ARTIFACT_ROLES = [
  'inventory',
  'matrix',
  'run',
  'trace_readback',
] as const;

interface ArtifactBinding {
  role: typeof ARTIFACT_ROLES[number];
  path: string;
  digest: string;
}

export interface VerifiedProofArtifacts {
  readonly bindings: readonly ArtifactBinding[];
}

const issuedArtifactBindings = new WeakMap<object, readonly ArtifactBinding[]>();

interface ProtectedCommandProofInput {
  source: { gitSha: string; dirty: false };
  runtime: VerifiedAgentTraceReceiptPayload['context']['runtime'];
  policy: ProtectedTraceQualificationPolicy;
  artifacts: unknown;
  receipts: readonly unknown[];
}

export interface ProtectedCommandProofManifest {
  schemaVersion: 2;
  artifactKind: 'kfc-protected-command-proof-manifest';
  source: ProtectedCommandProofInput['source'];
  runtime: ProtectedCommandProofInput['runtime'];
  policy: ProtectedTraceQualificationPolicy;
  campaign: ReturnType<typeof deriveProtectedTraceCampaignDimensions>;
  target: {
    apiUrl: 'https://apac.api.smith.langchain.com';
    projectName: string;
    remoteDatasetId: string;
  };
  artifacts: ArtifactBinding[];
  receipts: Array<{
    executionId: string;
    mode: 'text' | 'genui';
    repetition: number;
    publication: VerifiedAgentTraceReceiptPayload['publication'];
    runs: VerifiedAgentTraceReceiptPayload['runs'];
    evidence: VerifiedAgentTraceReceiptPayload['evidence'];
  }>;
  integrity: { algorithm: 'sha256'; payloadDigest: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function fail(code: string): never {
  throw new Error(code);
}

function parseRuntime(
  value: unknown,
): VerifiedAgentTraceReceiptPayload['context']['runtime'] {
  if (
    !isRecord(value) ||
    typeof value.runtimeId !== 'string' ||
    (value.provider !== 'openai' && value.provider !== 'google') ||
    typeof value.model !== 'string' ||
    typeof value.profile !== 'string'
  ) {
    fail('protected_command_proof_input_invalid');
  }
  return {
    runtimeId: value.runtimeId,
    provider: value.provider,
    model: value.model,
    profile: value.profile,
  };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function parsePolicy(value: unknown): ProtectedTraceQualificationPolicy {
  if (!isRecord(value) || !isRecord(value.dataset) || !Array.isArray(value.modes)) {
    fail('protected_command_proof_policy_invalid');
  }
  const scenarioCount = positiveInteger(value.dataset.scenarioCount);
  const turnCount = positiveInteger(value.dataset.turnCount);
  const caseCount = positiveInteger(value.dataset.caseCount);
  const repetitionsPerMode = positiveInteger(value.repetitionsPerMode);
  const modes = value.modes.filter(
    (mode): mode is 'text' | 'genui' => mode === 'text' || mode === 'genui',
  );
  if (
    typeof value.policyId !== 'string' ||
    typeof value.dataset.name !== 'string' ||
    typeof value.dataset.schemaVersion !== 'string' ||
    typeof value.dataset.inventoryVersion !== 'string' ||
    typeof value.dataset.inventoryDigest !== 'string' ||
    typeof value.dataset.sourcePath !== 'string' ||
    scenarioCount === undefined ||
    turnCount === undefined ||
    caseCount === undefined ||
    repetitionsPerMode === undefined ||
    modes.length !== value.modes.length ||
    value.costPolicy !== 'provider_reported_or_unavailable'
  ) {
    fail('protected_command_proof_policy_invalid');
  }
  return {
    policyId: value.policyId,
    dataset: {
      name: value.dataset.name,
      schemaVersion: value.dataset.schemaVersion,
      inventoryVersion: value.dataset.inventoryVersion,
      inventoryDigest: value.dataset.inventoryDigest,
      sourcePath: value.dataset.sourcePath,
      scenarioCount,
      turnCount,
      caseCount,
    },
    modes,
    repetitionsPerMode,
    costPolicy: value.costPolicy,
  };
}

function parseInput(value: unknown): ProtectedCommandProofInput {
  if (!isRecord(value)) fail('protected_command_proof_input_invalid');
  const source = value.source;
  const runtime = value.runtime;
  const policy = value.policy;
  const artifacts = value.artifacts;
  const receipts = value.receipts;
  if (
    !isRecord(source) ||
    typeof source.gitSha !== 'string' ||
    !GIT_SHA_PATTERN.test(source.gitSha) ||
    source.dirty !== false ||
    !Array.isArray(receipts)
  ) {
    fail('protected_command_proof_input_invalid');
  }
  return {
    source: { gitSha: source.gitSha, dirty: false },
    runtime: parseRuntime(runtime),
    policy: parsePolicy(policy),
    artifacts,
    receipts,
  };
}

function validatePolicy(policy: ProtectedTraceQualificationPolicy): void {
  const { dataset } = policy;
  if (
    !policy.policyId ||
    policy.modes.length === 0 ||
    new Set(policy.modes).size !== policy.modes.length ||
    policy.modes.some((mode) => mode !== 'text' && mode !== 'genui') ||
    !Number.isSafeInteger(policy.repetitionsPerMode) ||
    policy.repetitionsPerMode < 1 ||
    !dataset.name ||
    !dataset.schemaVersion ||
    !dataset.inventoryVersion ||
    !DIGEST_PATTERN.test(dataset.inventoryDigest) ||
    !dataset.sourcePath ||
    !Number.isSafeInteger(dataset.scenarioCount) ||
    !Number.isSafeInteger(dataset.turnCount) ||
    !Number.isSafeInteger(dataset.caseCount) ||
    dataset.scenarioCount < 1 ||
    dataset.turnCount < 1 ||
    dataset.caseCount !== dataset.turnCount * policy.modes.length
  ) {
    fail('protected_command_proof_policy_invalid');
  }
}

export async function verifyProtectedProofArtifacts(input: {
  inventory: string;
  matrix: string;
  run: string;
  traceReadback: string;
}): Promise<VerifiedProofArtifacts> {
  const files = [input.inventory, input.matrix, input.run, input.traceReadback];
  const contents = await Promise.all(files.map((path) => readFile(path)));
  const bindings = ARTIFACT_ROLES.map((role, index) => ({
    role,
    path: basename(files[index] ?? ''),
    digest: createHash('sha256').update(contents[index] ?? Buffer.alloc(0)).digest('hex'),
  }));
  if (bindings.some(({ path }) => !path) || new Set(bindings.map(({ path }) => path)).size !== bindings.length) {
    fail('protected_command_proof_artifacts_invalid');
  }
  const verified = Object.freeze({ bindings: Object.freeze(bindings) });
  issuedArtifactBindings.set(verified, bindings);
  return verified;
}

function validateArtifacts(value: unknown): ArtifactBinding[] {
  if (typeof value !== 'object' || value === null) {
    fail('protected_command_proof_artifacts_unverified');
  }
  const bindings = issuedArtifactBindings.get(value);
  if (!bindings) fail('protected_command_proof_artifacts_unverified');
  return bindings.map((binding) => ({ ...binding }));
}

function receiptSlots(policy: ProtectedTraceQualificationPolicy): string[] {
  return policy.modes.flatMap((mode) =>
    Array.from(
      { length: policy.repetitionsPerMode },
      (_, index) => `${mode}:${index + 1}`,
    ),
  );
}

function validateReceipts(
  input: ProtectedCommandProofInput,
): VerifiedAgentTraceReceiptPayload[] {
  const payloads: VerifiedAgentTraceReceiptPayload[] = [];
  for (const receipt of input.receipts) {
    if (!isVerifiedAgentTraceReceipt(receipt)) {
      fail('protected_command_proof_receipt_unverified');
    }
    payloads.push(verifiedAgentTraceReceiptPayload(receipt));
  }
  const expectedSlots = receiptSlots(input.policy);
  const actualSlots = payloads.map(
    ({ context }) => `${context.mode}:${context.repetition}`,
  );
  if (
    actualSlots.length !== expectedSlots.length ||
    new Set(actualSlots).size !== actualSlots.length ||
    expectedSlots.some((slot) => !actualSlots.includes(slot))
  ) {
    fail('protected_command_proof_receipts_invalid');
  }
  const allRunIds = payloads.flatMap(({ runs }) => runs.map(({ id }) => id));
  const allTraceIds = payloads.flatMap(({ runs }) =>
    runs.filter(({ parentRunId }) => parentRunId === undefined).map(({ traceId }) => traceId),
  );
  if (
    new Set(allRunIds).size !== allRunIds.length ||
    new Set(allTraceIds).size !== allTraceIds.length
  ) {
    fail('protected_command_proof_receipts_invalid');
  }
  const first = payloads[0];
  if (!first) fail('protected_command_proof_receipts_invalid');
  for (const payload of payloads) {
    if (
      payload.context.gitSha !== input.source.gitSha ||
      canonicalJson(payload.context.runtime) !== canonicalJson(input.runtime) ||
      canonicalJson(payload.context.policy) !== canonicalJson(input.policy) ||
      payload.target.apiUrl !== first.target.apiUrl ||
      payload.target.projectName !== first.target.projectName ||
      payload.context.remoteDatasetId !== first.context.remoteDatasetId ||
      payload.context.executionId !== first.context.executionId
    ) {
      fail('protected_command_proof_binding_mismatch');
    }
  }
  return payloads;
}

function digestPayload(payload: Omit<ProtectedCommandProofManifest, 'integrity'>): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export function createProtectedCommandProofManifest(
  value: unknown,
): ProtectedCommandProofManifest {
  const input = parseInput(value);
  validatePolicy(input.policy);
  const artifacts = validateArtifacts(input.artifacts);
  const receipts = validateReceipts(input);
  const first = receipts[0];
  if (!first) fail('protected_command_proof_receipts_invalid');
  const payload: Omit<ProtectedCommandProofManifest, 'integrity'> = {
    schemaVersion: 2,
    artifactKind: 'kfc-protected-command-proof-manifest',
    source: input.source,
    runtime: input.runtime,
    policy: input.policy,
    campaign: deriveProtectedTraceCampaignDimensions(input.policy),
    target: {
      apiUrl: first.target.apiUrl,
      projectName: first.target.projectName,
      remoteDatasetId: first.context.remoteDatasetId,
    },
    artifacts,
    receipts: receipts.map(({ context, publication, runs, evidence }) => ({
      executionId: context.executionId,
      mode: context.mode,
      repetition: context.repetition,
      publication,
      runs,
      evidence,
    })),
  };
  return {
    ...payload,
    integrity: {
      algorithm: 'sha256',
      payloadDigest: digestPayload(payload),
    },
  };
}

export async function writeProtectedCommandProofManifest(
  path: string,
  manifest: ProtectedCommandProofManifest,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

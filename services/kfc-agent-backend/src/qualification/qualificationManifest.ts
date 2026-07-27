import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

const digestPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40,64}$/u;
const verdicts = new Set([
  'successful',
  'partial',
  'unsuccessful',
  'insufficient_evidence',
]);
const defaultRequiredEvidenceFiles = [
  'manifest.json',
  'environment.json',
  'trace.jsonl',
  'transcript.md',
  'evidence-packet.json',
  'codex-review-packet.md',
] as const;

interface FileRecord {
  path: string;
  sha256: string;
  sizeBytes: number;
}

interface EvaluationCitation {
  artifact: string;
  pointer: string;
  note: string;
}

export async function buildQualificationManifest(input: {
  sourceCommit: string;
  expectedScenarioIds: readonly string[];
  requiredEvidenceFiles?: readonly string[];
  publicProvenancePath: string;
  externalProbePath: string;
  langsmithProbePath: string;
  scenarios: ReadonlyArray<{
    scenarioId: string;
    narrativeSha256: string;
    evidenceDirectory: string;
    evaluationPath: string;
  }>;
  readGlobalFile?: (path: string) => Promise<Buffer>;
}): Promise<{
  schemaVersion: 'kfc-recommendation-live-qualification-v1';
  sourceCommit: string;
  externalArtifacts: Record<string, FileRecord>;
  scenarios: Array<{
    scenarioId: string;
    narrativeSha256: string;
    verdict: string;
    evaluatorTaskId: string;
    evidencePacketSha256: string;
    citations: EvaluationCitation[];
    concerns: string[];
    evaluation: FileRecord;
    artifacts: FileRecord[];
  }>;
  contentDigest: string;
}> {
  if (!commitPattern.test(input.sourceCommit)) {
    throw new Error('qualification source commit must be immutable');
  }
  if (
    new Set(input.expectedScenarioIds).size !==
      input.expectedScenarioIds.length ||
    input.expectedScenarioIds.length === 0
  ) {
    throw new Error('expected qualification scenario IDs are invalid');
  }
  const actualIds = input.scenarios.map(({ scenarioId }) => scenarioId);
  if (
    actualIds.length !== input.expectedScenarioIds.length ||
    actualIds.some(
      (scenarioId, index) => scenarioId !== input.expectedScenarioIds[index],
    )
  ) {
    throw new Error(
      'qualification scenario inventory differs from expected IDs',
    );
  }
  const readGlobal = input.readGlobalFile ?? readFile;
  const externalArtifacts = {
    publicProvenance: await fileRecordFromBytes(
      basename(input.publicProvenancePath),
      await readGlobal(input.publicProvenancePath),
    ),
    externalProbe: await fileRecordFromBytes(
      basename(input.externalProbePath),
      await readGlobal(input.externalProbePath),
    ),
    langsmithProbe: await fileRecordFromBytes(
      basename(input.langsmithProbePath),
      await readGlobal(input.langsmithProbePath),
    ),
  };
  const requiredEvidenceFiles =
    input.requiredEvidenceFiles ?? defaultRequiredEvidenceFiles;
  const scenarios = await Promise.all(
    input.scenarios.map(async (scenario) => {
      if (!digestPattern.test(scenario.narrativeSha256)) {
        throw new Error(
          `narrative digest is invalid for ${scenario.scenarioId}`,
        );
      }
      const artifacts = await directoryFileRecords(scenario.evidenceDirectory);
      const byPath = new Map(
        artifacts.map((artifact) => [artifact.path, artifact]),
      );
      for (const requiredFile of requiredEvidenceFiles) {
        if (!byPath.has(requiredFile)) {
          throw new Error(
            `${scenario.scenarioId} is missing evidence ${requiredFile}`,
          );
        }
      }
      const evaluationBytes = await readFile(scenario.evaluationPath);
      const evaluationValue = parseJsonObject(
        evaluationBytes,
        `${scenario.scenarioId} evaluation`,
      );
      const evaluation = parseEvaluation(evaluationValue, scenario.scenarioId);
      const packet = byPath.get('evidence-packet.json');
      if (!packet || evaluation.evidencePacketSha256 !== packet.sha256) {
        throw new Error(
          `${scenario.scenarioId} evaluator evidence packet digest mismatch`,
        );
      }
      return {
        scenarioId: scenario.scenarioId,
        narrativeSha256: scenario.narrativeSha256,
        verdict: evaluation.verdict,
        evaluatorTaskId: evaluation.evaluatorTaskId,
        evidencePacketSha256: evaluation.evidencePacketSha256,
        citations: evaluation.citations,
        concerns: evaluation.concerns,
        evaluation: await fileRecordFromBytes(
          basename(scenario.evaluationPath),
          evaluationBytes,
        ),
        artifacts,
      };
    }),
  );
  const manifest = {
    schemaVersion: 'kfc-recommendation-live-qualification-v1' as const,
    sourceCommit: input.sourceCommit,
    externalArtifacts,
    scenarios,
  };
  return {
    ...manifest,
    contentDigest: sha256(Buffer.from(canonicalJson(manifest), 'utf8')),
  };
}

function parseEvaluation(
  value: Record<string, unknown>,
  scenarioId: string,
): {
  verdict: string;
  evaluatorTaskId: string;
  evidencePacketSha256: string;
  citations: EvaluationCitation[];
  concerns: string[];
} {
  if (
    value.schemaVersion !== 'kfc-recommendation-independent-evaluation-v1' ||
    value.scenarioId !== scenarioId ||
    typeof value.verdict !== 'string' ||
    !verdicts.has(value.verdict) ||
    typeof value.evaluatorTaskId !== 'string' ||
    !value.evaluatorTaskId ||
    typeof value.evidencePacketSha256 !== 'string' ||
    !digestPattern.test(value.evidencePacketSha256) ||
    !Array.isArray(value.citations) ||
    value.citations.length === 0 ||
    !Array.isArray(value.concerns) ||
    !value.concerns.every(
      (concern) => typeof concern === 'string' && concern.length > 0,
    )
  ) {
    throw new Error(`${scenarioId} independent evaluation is invalid`);
  }
  const citations = value.citations.map((citation) => {
    const record = jsonRecord(citation);
    if (
      !record ||
      typeof record.artifact !== 'string' ||
      !record.artifact ||
      typeof record.pointer !== 'string' ||
      !record.pointer ||
      typeof record.note !== 'string' ||
      !record.note
    ) {
      throw new Error(`${scenarioId} evaluator citation is invalid`);
    }
    return {
      artifact: record.artifact,
      pointer: record.pointer,
      note: record.note,
    };
  });
  return {
    verdict: value.verdict,
    evaluatorTaskId: value.evaluatorTaskId,
    evidencePacketSha256: value.evidencePacketSha256,
    citations,
    concerns: value.concerns as string[],
  };
}

async function directoryFileRecords(root: string): Promise<FileRecord[]> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`evidence root is not a regular directory: ${root}`);
  }
  const records: FileRecord[] = [];
  await walk(root);
  return records.sort((left, right) => left.path.localeCompare(right.path));

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`evidence symlink is not allowed: ${path}`);
      }
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`unsupported evidence entry: ${path}`);
      }
      records.push(
        await fileRecordFromBytes(
          relative(root, path).replaceAll('\\', '/'),
          await readFile(path),
        ),
      );
    }
  }
}

async function fileRecordFromBytes(
  path: string,
  bytes: Buffer,
): Promise<FileRecord> {
  return {
    path,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
  };
}

function parseJsonObject(bytes: Buffer, name: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    const record = jsonRecord(value);
    if (!record) throw new Error('not an object');
    return record;
  } catch (error) {
    throw new Error(`${name} is not valid JSON`, { cause: error });
  }
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

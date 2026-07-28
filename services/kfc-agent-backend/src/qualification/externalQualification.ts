const commitPattern = /^[a-f0-9]{40,64}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const probeRunName = 'kfc.recommendation.qualification.no_model_probe';

export interface ShadowProbeResult {
  ok: true;
  serviceUrl: string;
  modelRevision: string;
  rowCount: number;
  actionIds: string[];
  modelArtifactIds: string[];
  calibrationIds: string[];
  featureSchemas: string[];
}

export async function probeShadowService(input: {
  baseUrl: string;
  modelRevision: string;
  probeRequest: Record<string, unknown>;
  fetcher?: typeof fetch;
}): Promise<ShadowProbeResult> {
  const baseUrl = normalizeHttpsUrl(input.baseUrl);
  if (!commitPattern.test(input.modelRevision)) {
    throw new Error('shadow model revision must be immutable');
  }
  const rows = array(input.probeRequest.dataframe_records);
  if (rows.length === 0) throw new Error('shadow probe rows are required');
  const actionIds = rows.map((row, index) => {
    const actionId = record(row)?.action_id;
    if (typeof actionId !== 'string' || !actionId) {
      throw new Error(`shadow probe action is invalid at row ${index}`);
    }
    return actionId;
  });
  const fetcher = input.fetcher ?? fetch;
  const health = await fetcher(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error(`shadow health probe failed with HTTP ${health.status}`);
  }
  const inference = await fetcher(`${baseUrl}/invocations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input.probeRequest),
  });
  if (!inference.ok) {
    throw new Error(
      `shadow inference probe failed with HTTP ${inference.status}`,
    );
  }
  const body = record(await inference.json());
  const predictions = array(body?.predictions).map((value, index) => {
    const prediction = record(value);
    if (!prediction) {
      throw new Error(`shadow prediction is invalid at row ${index}`);
    }
    if (prediction.action_id !== actionIds[index]) {
      throw new Error(`prediction action mismatch at row ${index}`);
    }
    for (const numericField of [
      'calibrated_probability',
      'expected_value_score',
    ]) {
      if (
        typeof prediction[numericField] !== 'number' ||
        !Number.isFinite(prediction[numericField])
      ) {
        throw new Error(`shadow prediction ${numericField} is invalid`);
      }
    }
    return prediction;
  });
  if (predictions.length !== rows.length) {
    throw new Error('shadow prediction count does not match probe rows');
  }
  return {
    ok: true,
    serviceUrl: baseUrl,
    modelRevision: input.modelRevision,
    rowCount: predictions.length,
    actionIds,
    modelArtifactIds: stringFields(predictions, 'model_artifact_id'),
    calibrationIds: stringFields(predictions, 'calibration_id'),
    featureSchemas: stringFields(predictions, 'feature_schema'),
  };
}

export function validateBackendQualificationEnvironment(
  value: unknown,
  input: { expectedSourceCommit: string },
): {
  ok: true;
  sourceCommit: string;
  deploymentId: string;
  agentCandidate: 'openai-gpt-4.1-mini';
  shadowRuntimeProfile: 'local_docker_cloudflare_tunnel';
  sanitySnapshotDigest: string;
  langsmithProject: string;
} {
  if (!commitPattern.test(input.expectedSourceCommit)) {
    throw new Error('expected source commit must be immutable');
  }
  const environment = record(value);
  const release = record(environment?.release);
  if (
    environment?.ok !== true ||
    release?.gitSha !== input.expectedSourceCommit ||
    release.dirty !== false ||
    typeof release.deploymentId !== 'string' ||
    !release.deploymentId
  ) {
    throw new Error(
      'backend release callback does not attest the clean source',
    );
  }
  const checks = record(environment.checks);
  const shadow = record(checks?.recommendationShadow);
  if (
    shadow?.ok !== true ||
    shadow.configured !== true ||
    shadow.runtimeProfile !== 'local_docker_cloudflare_tunnel' ||
    shadow.outputMode !== 'baseline'
  ) {
    throw new Error(
      'backend recommendation shadow binding is not baseline-ready',
    );
  }
  const sanity = record(checks?.recommendationSanity);
  if (
    sanity?.ok !== true ||
    sanity.configured !== true ||
    sanity.authority !== 'sanity' ||
    sanity.reachable !== true ||
    sanity.policyCount !== 5 ||
    typeof sanity.snapshotDigest !== 'string' ||
    !digestPattern.test(sanity.snapshotDigest)
  ) {
    throw new Error('backend Sanity production binding is not ready');
  }
  const observability = record(checks?.observability);
  const langsmith = record(observability?.langsmith);
  if (
    observability?.ok !== true ||
    langsmith?.configured !== true ||
    typeof langsmith.project !== 'string' ||
    !langsmith.project ||
    typeof langsmith.endpoint !== 'string' ||
    !isHttpsUrl(langsmith.endpoint) ||
    typeof langsmith.samplingRate !== 'number' ||
    langsmith.samplingRate <= 0 ||
    langsmith.samplingRate > 1
  ) {
    throw new Error('backend LangSmith binding is not queryable');
  }
  const proof = record(environment.proof);
  const versions = record(proof?.versions);
  const agent = record(versions?.agent);
  if (
    agent?.candidateId !== 'openai-gpt-4.1-mini' ||
    agent.provider !== 'openai' ||
    agent.model !== 'gpt-4.1-mini'
  ) {
    throw new Error('backend agent is not the qualified OpenAI candidate');
  }
  return {
    ok: true,
    sourceCommit: input.expectedSourceCommit,
    deploymentId: release.deploymentId,
    agentCandidate: 'openai-gpt-4.1-mini',
    shadowRuntimeProfile: 'local_docker_cloudflare_tunnel',
    sanitySnapshotDigest: sanity.snapshotDigest,
    langsmithProject: langsmith.project,
  };
}

interface LangSmithNoModelClient {
  createRun(run: {
    id: string;
    name: string;
    run_type: string;
    project_name: string;
    start_time: string;
    end_time: string;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    extra: Record<string, unknown>;
  }): Promise<void>;
  readRun(runId: string): Promise<unknown>;
}

export async function runLangSmithNoModelProbe(
  client: LangSmithNoModelClient,
  input: {
    projectName: string;
    runId: string;
    now?: () => Date;
  },
): Promise<{
  ok: true;
  projectName: string;
  runId: string;
  runName: typeof probeRunName;
  runType: 'tool';
  queryable: true;
}> {
  if (!input.projectName.trim())
    throw new Error('LangSmith project is required');
  if (!/^[a-f0-9-]{36}$/u.test(input.runId)) {
    throw new Error('LangSmith probe run ID is invalid');
  }
  const now = input.now ?? (() => new Date());
  const at = now().toISOString();
  await client.createRun({
    id: input.runId,
    name: probeRunName,
    run_type: 'tool',
    project_name: input.projectName,
    start_time: at,
    end_time: at,
    inputs: { probe: 'no_model_ingestion' },
    outputs: { ingested: true },
    extra: {
      metadata: {
        purpose: 'kfc_recommendation_qualification',
        invokesModel: false,
      },
    },
  });
  const run = record(await client.readRun(input.runId));
  if (
    run?.id !== input.runId ||
    run.name !== probeRunName ||
    run.run_type !== 'tool'
  ) {
    throw new Error('LangSmith probe was not queryable by immutable run ID');
  }
  return {
    ok: true,
    projectName: input.projectName,
    runId: input.runId,
    runName: probeRunName,
    runType: 'tool',
    queryable: true,
  };
}

function stringFields(
  records: Array<Record<string, unknown>>,
  field: string,
): string[] {
  return records.map((recordValue) => {
    const value = recordValue[field];
    if (typeof value !== 'string' || !value) {
      throw new Error(`shadow prediction ${field} is invalid`);
    }
    return value;
  });
}

function normalizeHttpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('shadow service URL is invalid');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('shadow service URL must be a credential-free HTTPS URL');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.toString().replace(/\/$/u, '');
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('expected an array');
  return value;
}

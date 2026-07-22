import type { FastifyInstance } from 'fastify';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createCommerceProofGatewayMutationState,
  restoreCommerceProofGatewayMutationState,
  snapshotCommerceProofGatewayMutationState,
  type CommerceProofGatewayMutationSnapshot,
  type CommerceProofGatewayMutationState,
} from '../src/commerceProof/gatewayMutationContracts.js';
import { buildCommerceProofGatewayServer } from '../src/commerceProof/gatewayServer.js';
import { buildCommerceProofMockOmsServer } from '../src/commerceProof/mockOmsServer.js';
import { buildCommerceProofMockPosServer } from '../src/commerceProof/mockPosServer.js';

const gatewayToken = requiredEnv('KFC_SANDBOX_GATEWAY_TOKEN');
const host = process.env.HOST?.trim() || '127.0.0.1';
const port = Number.parseInt(process.env.PORT?.trim() || '8790', 10);
const mutationStatePath = resolve(
  process.env.KFC_SANDBOX_GATEWAY_MUTATION_STATE_PATH?.trim() ||
    '.runtime/sandbox-commerce-gateway-mutations.json',
);
const initializationMarker = 'kfc-commerce-proof-gateway-mutation-state-v1\n';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const servers: FastifyInstance[] = [];
const mutationState = await loadOrBootstrapMutationState(mutationStatePath);
const persistMutationSnapshot =
  createSerializedMutationSnapshotWriter(mutationStatePath);
const omsToken = crypto.randomUUID();
const posToken = crypto.randomUUID();
const oms = buildCommerceProofMockOmsServer({
  token: omsToken,
  adminToken: crypto.randomUUID(),
});
const pos = buildCommerceProofMockPosServer({
  token: posToken,
  adminToken: crypto.randomUUID(),
});
const omsBaseUrl = await listen(oms);
const posBaseUrl = await listen(pos);
const gateway = buildCommerceProofGatewayServer({
  token: gatewayToken,
  oms: { baseUrl: omsBaseUrl, token: omsToken },
  pos: { baseUrl: posBaseUrl, token: posToken },
  timeoutMs: 3_000,
  readinessTimeoutMs: 3_000,
  mutationState,
  persistMutationSnapshot,
});
servers.push(gateway);
const baseUrl = await gateway.listen({ host, port });

console.log(
  JSON.stringify({
    ok: true,
    service: 'sandbox-commerce-gateway',
    commerceEnvironment: 'sandbox',
    baseUrl,
  }),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown());
}
await new Promise<void>(() => {});

async function listen(server: FastifyInstance): Promise<string> {
  servers.push(server);
  return server.listen({ host: '127.0.0.1', port: 0 });
}

async function shutdown(): Promise<void> {
  await Promise.allSettled(servers.reverse().map((server) => server.close()));
  process.exit(0);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function loadOrBootstrapMutationState(
  statePath: string,
): Promise<CommerceProofGatewayMutationState> {
  const markerPath = `${statePath}.initialized`;
  await mkdir(dirname(statePath), { recursive: true });
  const [stateFile, markerFile] = await Promise.all([
    readOptionalFile(statePath),
    readOptionalFile(markerPath),
  ]);
  if (stateFile !== undefined || markerFile !== undefined) {
    if (
      stateFile === undefined ||
      markerFile?.toString('utf8') !== initializationMarker
    ) {
      throw new Error(
        'sandbox_gateway_mutation_state_missing_or_untrusted_after_initialization',
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stateFile.toString('utf8'));
    } catch (error) {
      throw new Error('sandbox_gateway_mutation_state_json_invalid', {
        cause: error,
      });
    }
    return restoreCommerceProofGatewayMutationState(parsed);
  }

  await createInitializationMarker(markerPath);
  const state = createCommerceProofGatewayMutationState();
  await writeMutationSnapshotAtomically(
    statePath,
    snapshotCommerceProofGatewayMutationState(state),
  );
  return state;
}

function createSerializedMutationSnapshotWriter(statePath: string) {
  let pending = Promise.resolve();
  return (snapshot: CommerceProofGatewayMutationSnapshot): Promise<void> => {
    const write = pending.then(() =>
      writeMutationSnapshotAtomically(statePath, snapshot),
    );
    pending = write.catch(() => {});
    return write;
  };
}

async function createInitializationMarker(markerPath: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(markerPath, 'wx', 0o600);
    await handle.writeFile(initializationMarker, 'utf8');
    await handle.sync();
  } catch (error) {
    throw new Error('sandbox_gateway_mutation_state_bootstrap_refused', {
      cause: error,
    });
  } finally {
    await handle?.close();
  }
  await syncDirectory(dirname(markerPath));
}

async function writeMutationSnapshotAtomically(
  statePath: string,
  snapshot: CommerceProofGatewayMutationSnapshot,
): Promise<void> {
  const temporaryPath = `${statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(snapshot)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, statePath);
    await syncDirectory(dirname(statePath));
  } catch (error) {
    await handle?.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readOptionalFile(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
}

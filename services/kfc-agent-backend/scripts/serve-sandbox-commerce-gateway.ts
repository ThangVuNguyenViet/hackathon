import type { FastifyInstance } from "fastify";
import { buildCommerceProofGatewayServer } from "../src/commerceProof/gatewayServer.js";
import { buildCommerceProofMockOmsServer } from "../src/commerceProof/mockOmsServer.js";
import { buildCommerceProofMockPosServer } from "../src/commerceProof/mockPosServer.js";

const gatewayToken = requiredEnv("KFC_SANDBOX_GATEWAY_TOKEN");
const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.PORT?.trim() || "8790", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const servers: FastifyInstance[] = [];
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
});
servers.push(gateway);
const baseUrl = await gateway.listen({ host, port });

console.log(JSON.stringify({
  ok: true,
  service: "sandbox-commerce-gateway",
  commerceEnvironment: "sandbox",
  baseUrl,
}));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown());
}
await new Promise<void>(() => {});

async function listen(server: FastifyInstance): Promise<string> {
  servers.push(server);
  return server.listen({ host: "127.0.0.1", port: 0 });
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

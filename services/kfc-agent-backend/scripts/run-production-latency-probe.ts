import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'langsmith';
import {
  evaluateProductionLatency,
  productionProbeMetadataFilter,
  type ProductionLatencySample,
} from '../src/evaluation/productionLatency.js';

const chatBaseUrl = (process.env["PRODUCTION_CHAT_URL"] ?? 'https://kfc-ai-chatbot.pages.dev').replace(/\/$/, '');
const iterations = Number(process.env["PRODUCTION_LATENCY_ITERATIONS"] ?? '20');
const targetP95Ms = Number(process.env["PRODUCTION_LATENCY_TARGET_MS"] ?? '8000');
const projectName = process.env["LANGSMITH_PROJECT"] ?? 'kfc-agent-backend-local';
const apiKey = process.env["LANGSMITH_API_KEY"];
const apiUrl = process.env["LANGSMITH_ENDPOINT"];
if (!apiKey) throw new Error('LANGSMITH_API_KEY is required');
if (!apiUrl) throw new Error('LANGSMITH_ENDPOINT is required');
if (!Number.isInteger(iterations) || iterations < 1) throw new Error('PRODUCTION_LATENCY_ITERATIONS must be a positive integer');

const probeRunId = `latency-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const startedAt = new Date();
const samples: Array<ProductionLatencySample & { sessionId: string; status: number; responseText?: string | undefined }> = [];

for (const kind of ['greeting', 'menu'] as const) {
  for (let index = 0; index < iterations; index += 1) {
    const identity = `${probeRunId}-${kind}-${index + 1}`;
    const body = {
      sessionId: `kfc:${identity}`,
      customerId: identity,
      clientMessageId: `message-${identity}`,
      text: kind === 'greeting' ? 'Xin chào KFC' : 'Hôm nay KFC có món gì ngon?',
      metadata: { probeRunId, probeKind: kind, probeIndex: index + 1 },
    };
    const started = performance.now();
    let status = 0;
    let responseText: string | undefined;
    try {
      const response = await fetch(`${chatBaseUrl}/chat/kfc/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      status = response.status;
      const payload = await response.json().catch(() => ({})) as { responseText?: string | undefined };
      responseText = payload.responseText;
    } catch {
      status = 0;
    }
    const durationMs = Math.round(performance.now() - started);
    samples.push({ kind, ok: status === 200 && Boolean(responseText), durationMs, sessionId: body.sessionId, status, responseText });
    console.info(JSON.stringify({ type: 'production_latency_sample', probeRunId, kind, index: index + 1, status, durationMs }));
  }
}

const latency = evaluateProductionLatency(samples, targetP95Ms);
const client = new Client({ apiKey, apiUrl });
let agentTurns = 0;
let monitorTurns = 0;
const traceDeadline = Date.now() + 60_000;
while (Date.now() < traceDeadline) {
  agentTurns = 0;
  monitorTurns = 0;
  for await (const run of client.listRuns({
    projectName,
    isRoot: true,
    startTime: startedAt,
    filter: productionProbeMetadataFilter(probeRunId),
    limit: iterations * 4,
  })) {
    if (run.name === 'agent_turn') agentTurns += 1;
    if (run.name === 'post_turn_monitor') monitorTurns += 1;
  }
  if (agentTurns === iterations * 2 && monitorTurns === iterations * 2) break;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
}

const traceGate = agentTurns === iterations * 2 && monitorTurns === iterations * 2;
const report = {
  schemaVersion: 1,
  probeRunId,
  chatBaseUrl,
  projectName,
  targetP95Ms,
  latency,
  traces: { agentTurns, monitorTurns, expectedEach: iterations * 2, ok: traceGate },
  samples,
};
const reportDir = resolve(process.cwd(), '../../artifacts/production-latency');
await mkdir(reportDir, { recursive: true });
const reportPath = resolve(reportDir, `${probeRunId}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.info(JSON.stringify({ type: 'production_latency_summary', reportPath, ...report }));
if (!latency.ok || !traceGate) process.exitCode = 1;

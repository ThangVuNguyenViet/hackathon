import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { evaluateMessengerTurnOutcome, parseMessengerTurnExpectations } from '../src/evaluation/messengerOutcomeEvaluation.js';
import { OpenAIOutcomeJudgeClient } from '../src/evaluation/outcomeJudge.js';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  externalMessageId?: string | null;
  deliveryStatus?: string;
  createdAt?: string;
  metadata?: Record<string, unknown> | null;
}

const journey = [
  'Có combo gà cay không?',
  'Chọn gà cay, burger cay.',
  'Hai Pepsi vừa, thêm giỏ.',
  'Đổi cả hai Pepsi lớn.',
  'Giao Quận 7.',
  'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng, Quận 7, TP.HCM.',
  'Giao đến địa chỉ này.',
  'ZaloPay được không?',
  'Apple Pay được không?',
  'Chọn ZaloPay.',
  'Xác nhận đặt đơn.',
  'Thanh toán xong chưa?',
  'Đơn đang làm chưa?',
  'Bao giờ giao tới?',
] as const;
const backendUrl = deployedUrl(requiredEnv('KFC_AGENT_BACKEND_URL'));
const adminToken = requiredEnv('KFC_PROOF_ADMIN_TOKEN');
const outcomeJudgeClient = new OpenAIOutcomeJudgeClient({
  apiKey: requiredEnv('OPENAI_API_KEY'),
  baseUrl: process.env.OPENAI_BASE_URL,
});
const outcomeJudgeModel = process.env.OUTCOME_JUDGE_MODEL?.trim() || 'gpt-4.1-mini';
const sessionId = requiredEnv('KFC_MESSENGER_SESSION_ID');
if (!sessionId.startsWith('messenger:')) throw new Error('KFC_MESSENGER_SESSION_ID must be a Messenger session');
const outputDir = resolve(requiredEnv('KFC_MESSENGER_OUTPUT_DIR'));
if (existsSync(outputDir) && readdirSync(outputDir).length > 0) throw new Error(`Proof output is not empty: ${outputDir}`);
mkdirSync(outputDir, { recursive: true });
const expectedRuntime = readJson(requiredEnv('KFC_EXPECTED_RUNTIME_BINDING_FILE'));
const expectations = parseMessengerTurnExpectations(readJson(requiredEnv('KFC_MESSENGER_EXPECTATIONS_FILE')), journey.length);
const duplicateBody = readFileSync(resolve(requiredEnv('KFC_MESSENGER_DUPLICATE_WEBHOOK_FILE')));
const duplicateSignature = requiredEnv('KFC_MESSENGER_DUPLICATE_SIGNATURE');
const duplicateMessage = messengerText(JSON.parse(duplicateBody.toString('utf8')));
assertCustomerText(duplicateMessage);
const prompt = createInterface({ input: stdin, output: stdout });
const startedAt = new Date().toISOString();

try {
  const readiness = await requestJson(`${backendUrl}/ready?deep=1`);
  if (readiness.ok !== true) throw new Error('Deep readiness is not healthy');
  const runtime = record(readiness.proof);
  assertSubset(runtime, expectedRuntime, 'readiness.proof');

  await requestJson(`${backendUrl}/dashboard/sessions/${encodeURIComponent(sessionId)}/demo-reset`, {
    method: 'POST', headers: adminHeaders(),
  });
  const emptyTurns = await turns();
  const emptyEvents = await events();
  if (emptyTurns.length || emptyEvents.length) throw new Error('Session reset did not produce an empty deployed session');

  let lifecycle = await requestJson(
    `${backendUrl}/admin/lifecycle/sessions/${encodeURIComponent(sessionId)}/instances`,
    { method: 'POST', headers: adminHeaders() },
  );
  assertLifecycleBinding(lifecycle, runtime);
  const steps: Record<string, unknown>[] = [];
  let confirmedOrderId: string | undefined;
  for (const [index, text] of journey.entries()) {
    if (index === 11) {
      if (!confirmedOrderId) throw new Error('Confirmed Messenger order is missing its real orderId');
      lifecycle = await lifecycleEvent(lifecycle, { type: 'order_accepted', orderId: confirmedOrderId }, 'turn-12-order-accepted');
      lifecycle = await lifecycleEvent(lifecycle, { type: 'payment_pending', attemptId: 'messenger-proof-payment', orderId: confirmedOrderId }, 'turn-12-payment-pending');
      lifecycle = await lifecycleEvent(lifecycle, { type: 'payment_paid' }, `turn-${index + 1}-payment-paid`);
    }
    if (index === 12) lifecycle = await lifecycleEvent(lifecycle, { type: 'order_preparing' }, `turn-${index + 1}-order-preparing`);
    if (index === 13) {
      lifecycle = await lifecycleEvent(lifecycle, { type: 'order_ready' }, 'turn-14-order-ready');
      lifecycle = await lifecycleEvent(lifecycle, { type: 'delivery_pending', attemptId: 'messenger-proof-delivery', orderId: confirmedOrderId }, 'turn-14-delivery-pending');
      lifecycle = await lifecycleEvent(lifecycle, { type: 'delivery_assigned' }, 'turn-14-delivery-assigned');
      lifecycle = await lifecycleEvent(lifecycle, { type: 'delivery_started' }, 'turn-14-delivery-started');
    }
    const before = await turns();
    const beforeEventIds = new Set(
      (await events()).map((event) => string(record(event).id)).filter((id): id is string => Boolean(id)),
    );
    stdout.write(`\nSend this exact message from the real Messenger tester:\n${text}\n`);
    await prompt.question('Press Enter only after Messenger shows it as sent. ');
    const expectation = expectations[index]!;
    const pair = await waitForPair(text, before.map(({ id }) => id), expectation.maxLatencyMs);
    const dashboardEvents = (await events()).filter((event) => {
      const id = string(record(event).id);
      return !id || !beforeEventIds.has(id);
    });
    const outcomeJudgment = await evaluateMessengerTurnOutcome({
      expectation,
      customerText: text,
      assistantText: pair.assistant.text,
      toolNames: collectKey(dashboardEvents, 'toolName').filter((value): value is string => typeof value === 'string'),
      monitorEventTypes: collectKey(dashboardEvents, 'type').filter((value): value is string => typeof value === 'string'),
    }, { client: outcomeJudgeClient, model: outcomeJudgeModel });
    if (index === 10) {
      confirmedOrderId = collectKey(pair, 'orderId').find((value): value is string => typeof value === 'string' && value.length > 0);
    }
    const evidence = { step: index + 1, customerText: text, expectation, outcomeJudgment, ...pair, lifecycleRevision: number(lifecycle.revision), dashboardEvents };
    writeExclusive(`turn-${String(index + 1).padStart(2, '0')}.json`, evidence);
    steps.push(evidence);
  }

  const beforeDuplicate = await turns();
  const duplicateResponses = await Promise.all([
    replayWebhook(duplicateBody, duplicateSignature),
    replayWebhook(duplicateBody, duplicateSignature),
  ]);
  const duplicatePair = await waitForPair(duplicateMessage, beforeDuplicate.map(({ id }) => id));
  const duplicateTurns = (await turns()).filter((turn) => !beforeDuplicate.some(({ id }) => id === turn.id));
  if (duplicateTurns.filter((turn) => turn.role === 'user' && turn.externalMessageId === duplicatePair.user.externalMessageId).length !== 1) {
    throw new Error('Duplicate webhook created more than one customer turn');
  }
  const duplicateEvidence = { requestSha256: sha256(duplicateBody), responses: duplicateResponses, ...duplicatePair, dashboardEvents: await events() };
  writeExclusive('duplicate-boundary.json', duplicateEvidence);

  const coalescedMessages = ['Thêm tương ớt.', 'Và lấy thêm khăn giấy.'];
  const beforeCoalescing = await turns();
  stdout.write(`\nSend these two messages immediately, in order:\n${coalescedMessages.join('\n')}\n`);
  await prompt.question('Press Enter only after both messages show as sent. ');
  const coalesced = await waitForCoalesced(coalescedMessages, beforeCoalescing.map(({ id }) => id));
  writeExclusive('coalescing-boundary.json', { messages: coalescedMessages, ...coalesced, dashboardEvents: await events() });

  const proofEnvelope = await messengerProofEnvelope();
  writeExclusive('durable-proof-envelope.json', proofEnvelope);

  const manifest = {
    schemaVersion: 1,
    artifactKind: 'deployed-live-messenger-proof',
    status: 'PASS',
    startedAt,
    completedAt: new Date().toISOString(),
    runtime,
    lifecycle,
    proofEnvelope: 'durable-proof-envelope.json',
    sessionId,
    journey: { turnCount: steps.length, evidence: steps.map((_, index) => `turn-${String(index + 1).padStart(2, '0')}.json`) },
    boundaries: ['duplicate-boundary.json', 'coalescing-boundary.json'],
    retries: 0,
    manualRepairs: 0,
    files: readdirSync(outputDir).sort().map((name) => ({ name, sha256: sha256(readFileSync(resolve(outputDir, name))) })),
  };
  writeExclusive('manifest.json', manifest);
  stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} catch (error) {
  if (!existsSync(resolve(outputDir, 'manifest.json'))) {
    writeExclusive('manifest.json', {
      schemaVersion: 1,
      artifactKind: 'deployed-live-messenger-proof',
      status: 'FAIL',
      startedAt,
      completedAt: new Date().toISOString(),
      failure: error instanceof Error ? error.message : String(error),
      files: readdirSync(outputDir).sort(),
    });
  }
  throw error;
} finally {
  prompt.close();
}

async function lifecycleEvent(current: Record<string, unknown>, event: Record<string, unknown>, key: string) {
  const instanceId = string(current.instanceId);
  const revision = number(current.revision);
  if (!instanceId || revision === undefined) throw new Error('Lifecycle instance is missing identity or revision');
  const next = await requestJson(`${backendUrl}/admin/lifecycle/instances/${encodeURIComponent(instanceId)}/events`, {
    method: 'POST',
    headers: { ...adminHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: revision, idempotencyKey: key, event }),
  });
  if (number(next.revision) !== revision + 1) throw new Error(`Lifecycle revision did not advance for ${key}`);
  return next;
}

async function waitForPair(text: string, previousIds: string[], maxLatencyMs = 10_000): Promise<{ user: Turn; assistant: Turn; latencyMs: number }> {
  if (!Number.isInteger(maxLatencyMs) || maxLatencyMs < 1 || maxLatencyMs > 10_000) throw new Error('Turn latency limit must be 1-10000ms');
  const deadline = Date.now() + maxLatencyMs;
  while (Date.now() < deadline) {
    const fresh = (await turns()).filter((turn) => !previousIds.includes(turn.id));
    const userIndex = fresh.findIndex((turn) => turn.role === 'user' && turn.text === text);
    const user = fresh[userIndex];
    const assistant = fresh.slice(userIndex + 1).find((turn) => turn.role === 'assistant');
    if (user && assistant) {
      assertDeliveredPair(user, assistant);
      const latencyMs = Date.parse(assistant.createdAt ?? '') - Date.parse(user.createdAt ?? '');
      if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > maxLatencyMs) throw new Error(`Messenger reply exceeded ${maxLatencyMs}ms: ${text}`);
      return { user, assistant, latencyMs };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Messenger turn did not reach a delivered reply: ${text}`);
}

async function waitForCoalesced(messages: string[], previousIds: string[]) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const fresh = (await turns()).filter((turn) => !previousIds.includes(turn.id));
    const users = fresh.filter((turn) => turn.role === 'user');
    const assistants = fresh.filter((turn) => turn.role === 'assistant');
    if (users.length >= 2 && assistants.length >= 1) {
      if (users.slice(0, 2).map(({ text }) => text).join('\n') !== messages.join('\n')) throw new Error('Coalesced messages changed order');
      if (assistants.length !== 1) throw new Error('Coalesced messages produced more than one assistant reply');
      for (const user of users.slice(0, 2)) if (!user.externalMessageId?.startsWith('m_')) throw new Error('Coalescing probe lacks a real Meta message ID');
      assertAssistant(assistants[0]!);
      return { users: users.slice(0, 2), assistant: assistants[0] };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Coalescing probe did not reach one delivered reply');
}

function assertDeliveredPair(user: Turn, assistant: Turn): void {
  if (!user.externalMessageId?.startsWith('m_')) throw new Error('Journey turn lacks a real Meta inbound ID');
  assertAssistant(assistant);
}

function assertAssistant(turn: Turn): void {
  if (!turn.text.trim() || turn.deliveryStatus !== 'sent' || !turn.externalMessageId) throw new Error('Assistant reply is not durably delivered');
  if (record(turn.metadata).genUi !== undefined) throw new Error('Messenger assistant reply contains GenUI metadata');
}

async function replayWebhook(body: Buffer, signature: string) {
  const response = await fetch(`${backendUrl}/webhooks/messenger`, {
    method: 'POST', body: body.toString('utf8'), headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    signal: AbortSignal.timeout(10_000),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Signed duplicate webhook replay failed: HTTP ${response.status}`);
  return { status: response.status, body: value };
}

async function turns(): Promise<Turn[]> {
  const value = await requestJson(`${backendUrl}/dashboard/sessions/${encodeURIComponent(sessionId)}/turns?limit=100`, { headers: adminHeaders() });
  if (!Array.isArray(value.turns)) throw new Error('Dashboard turns response is malformed');
  return value.turns as Turn[];
}

async function events(): Promise<unknown[]> {
  const value = await requestJson(`${backendUrl}/dashboard/events/${encodeURIComponent(sessionId)}`, { headers: adminHeaders() });
  if (!Array.isArray(value.events)) throw new Error('Dashboard events response is malformed');
  return value.events;
}

async function messengerProofEnvelope(): Promise<Record<string, unknown>> {
  const url = `${backendUrl}/admin/proof/messenger/sessions/${encodeURIComponent(sessionId)}/envelope`;
  const response = await fetch(url, { headers: adminHeaders(), signal: AbortSignal.timeout(10_000) });
  const value = await response.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Messenger proof envelope is malformed');
  const envelope = value as Record<string, unknown>;
  if (!response.ok || envelope.complete !== true || (Array.isArray(envelope.missing) && envelope.missing.length > 0)) {
    throw new Error(`Messenger durable proof envelope is incomplete: ${JSON.stringify(envelope.missing ?? [])}`);
  }
  return envelope;
}

async function requestJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${url} failed with HTTP ${response.status}`);
  return value as Record<string, unknown>;
}

function assertLifecycleBinding(lifecycle: Record<string, unknown>, runtime: Record<string, unknown>): void {
  const commerce = record(runtime.commerce);
  for (const [field, expected] of [
    ['environment', commerce.environmentId ?? commerce.environment ?? runtime.commerceEnvironment],
    ['catalogObservationId', commerce.catalogObservationId ?? record(commerce.catalogObservation).id ?? record(runtime.catalogObservation).id],
    ['catalogHash', commerce.catalogObservationHash ?? record(commerce.catalogObservation).sha256 ?? record(runtime.catalogObservation).sha256],
    ['releaseId', record(runtime.backend).gitSha ?? record(runtime.deployment).gitSha],
  ] as Array<[string, unknown]>) {
    if (expected !== undefined && lifecycle[field] !== expected) throw new Error(`Lifecycle ${field} conflicts with readiness`);
  }
  if (lifecycle.sessionBinding !== sha256(Buffer.from(`session:${sessionId}`))) throw new Error('Lifecycle instance is bound to another session');
}

function assertSubset(actual: unknown, expected: unknown, path: string): void {
  if (Array.isArray(expected) || typeof expected !== 'object' || expected === null) {
    if (actual !== expected) throw new Error(`${path} does not match expected release binding`);
    return;
  }
  const actualRecord = record(actual);
  for (const [key, value] of Object.entries(expected)) assertSubset(actualRecord[key], value, `${path}.${key}`);
}

function messengerText(payload: unknown): string {
  const entries = Array.isArray(record(payload).entry) ? record(payload).entry as unknown[] : [];
  for (const entry of entries) {
    const messages = Array.isArray(record(entry).messaging) ? record(entry).messaging as unknown[] : [];
    for (const message of messages) {
      const text = string(record(record(message).message).text);
      if (text) return text;
    }
  }
  throw new Error('Duplicate webhook file does not contain a Messenger text message');
}

function assertCustomerText(text: string): void {
  if (!text.trim()) throw new Error('Customer-visible webhook text is empty');
}

function collectKey(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectKey(item, key));
  if (typeof value !== 'object' || value === null) return [];
  const item = value as Record<string, unknown>;
  return [...(Object.hasOwn(item, key) ? [item[key]] : []), ...Object.values(item).flatMap((child) => collectKey(child, key))];
}

function writeExclusive(name: string, value: unknown): void {
  writeFileSync(resolve(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function adminHeaders(): Record<string, string> {
  return { 'x-kfc-demo-admin-token': adminToken };
}

function deployedUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Messenger proof requires a deployed HTTPS backend');
  return url.toString().replace(/\/$/, '');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

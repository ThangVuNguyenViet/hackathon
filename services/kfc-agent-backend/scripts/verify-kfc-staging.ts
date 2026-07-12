import { randomUUID } from 'node:crypto';

const baseUrl = process.env["KFC_STAGING_URL"]?.replace(/\/$/, '');
if (!baseUrl) throw new Error('KFC_STAGING_URL is required');
if (process.env["KFC_STAGING_ACCEPTANCE"] !== '1') {
  throw new Error('Set KFC_STAGING_ACCEPTANCE=1 to acknowledge that this writes a staging conversation');
}

const suffix = randomUUID();
const customerId = `anon_customer_staging_${suffix}`;
const sessionId = `kfc:${customerId}`;
const firstMessageId = `staging_${suffix}_1`;
const headers = {
  'content-type': 'application/json',
  ...(process.env["KFC_DEMO_ADMIN_TOKEN"]
    ? { authorization: `Bearer ${process.env["KFC_DEMO_ADMIN_TOKEN"]}` }
    : {}),
};

const readiness = await request('/ready');
assert(readiness.response.ok, `/ready failed with HTTP ${readiness.response.status}`);

const firstPayload = {
  sessionId,
  customerId,
  clientMessageId: firstMessageId,
  text: 'Xin chao, cho minh xem cac combo dang co.',
};
const first = await request('/chat/kfc/message', { method: 'POST', headers, body: JSON.stringify(firstPayload) });
assert(first.response.ok, `first KFC message failed with HTTP ${first.response.status}`);

const duplicate = await request('/chat/kfc/message', {
  method: 'POST',
  headers,
  body: JSON.stringify(firstPayload),
});
assert(duplicate.response.ok, `duplicate KFC message failed with HTTP ${duplicate.response.status}`);

const second = await request('/chat/kfc/message', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    sessionId,
    customerId,
    clientMessageId: `staging_${suffix}_2`,
    text: 'Van dung dung phien nay, cho minh tiep tuc.',
  }),
});
assert(second.response.ok, `second KFC message failed with HTTP ${second.response.status}`);

const turns = await request(`/dashboard/sessions/${encodeURIComponent(sessionId)}/turns`);
assert(turns.response.ok, `dashboard turns failed with HTTP ${turns.response.status}`);
const turnList = asArray(asRecord(turns.body)["turns"]);
const matchingFirstMessages = turnList.filter(
  (turn) => asRecord(turn)["externalMessageId"] === firstMessageId && asRecord(turn)["role"] === 'user',
);
assert(matchingFirstMessages.length === 1, `expected one idempotent first user turn, got ${matchingFirstMessages.length}`);
assert(turnList.filter((turn) => asRecord(turn)["role"] === 'user').length >= 2, 'stable session did not retain both user turns');

const sessions = await request('/dashboard/sessions');
const session = asArray(asRecord(sessions.body)["sessions"])
  .map(asRecord)
  .find((candidate) => candidate["sessionId"] === sessionId);
assert(session, 'KFC session is missing from dashboard summaries');
const deeplink = asRecord(session["deeplink"]);
assert(deeplink["status"] === 'unavailable', `expected disabled KFC deeplink, got ${String(deeplink["status"])}`);

const humanJoin = await request(`/dashboard/sessions/${encodeURIComponent(sessionId)}/human-join`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ agentId: 'staging_acceptance' }),
});
assert(humanJoin.response.status === 409, `expected KFC human join HTTP 409, got ${humanJoin.response.status}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      sessionId,
      customerId,
      readiness: asRecord(readiness.body)["checks"],
      userTurnCount: turnList.filter((turn) => asRecord(turn)["role"] === 'user').length,
      deeplink,
      humanJoinStatus: humanJoin.response.status,
    },
    null,
    2,
  ),
);

async function request(path: string, init?: RequestInit): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => null);
  return { response, body };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

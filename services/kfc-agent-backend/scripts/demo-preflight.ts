interface CheckResult {
  name: string;
  ok: boolean;
  status?: number;
  message?: string;
  body?: unknown;
}

const workerUrl = normalizeWorkerUrl(
  process.env.KFC_WORKER_URL ??
    process.env.WORKER_URL ??
    'https://kfc-agent-backend-demo.thangvnv0806.workers.dev',
);
const verifyToken = process.env.MESSENGER_VERIFY_TOKEN ?? '';
const proofSessionId =
  process.env.KFC_PROOF_SESSION_ID ?? process.env.KFC_LIVE_SESSION_ID ?? '';

const checks: CheckResult[] = [];

checks.push(
  await requestJson(
    'health',
    `${workerUrl}/health`,
    (body) => isRecord(body) && body.ok === true,
  ),
);
checks.push(
  await requestJson(
    'ready',
    `${workerUrl}/ready`,
    (body) => isRecord(body) && body.ok === true,
  ),
);
checks.push(
  await requestJson(
    'ready:deep',
    `${workerUrl}/ready?deep=1`,
    (body) => isRecord(body) && body.ok === true,
  ),
);
checks.push(await checkMessengerVerification());
checks.push(
  await requestJson(
    'dashboard:sessions',
    `${workerUrl}/dashboard/sessions`,
    (body) => isRecord(body) && Array.isArray(body.sessions),
  ),
);
if (proofSessionId) {
  const encodedSessionId = encodeURIComponent(proofSessionId);
  checks.push(
    await requestJson(
      'dashboard:session-control',
      `${workerUrl}/dashboard/sessions/${encodedSessionId}/control`,
      (body) => isRecord(body) && body.agentMode !== 'human_paused',
    ),
  );
  checks.push(
    await requestJson(
      'dashboard:turns',
      `${workerUrl}/dashboard/sessions/${encodedSessionId}/turns`,
      (body) => isRecord(body) && Array.isArray(body.turns),
    ),
  );
}

const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({ ok, workerUrl, checks }, null, 2));
if (!ok) process.exitCode = 1;

function normalizeWorkerUrl(value: string): string {
  return value.replace(/\/$/, '');
}

async function checkMessengerVerification(): Promise<CheckResult> {
  if (!verifyToken) {
    return {
      name: 'messenger:verify',
      ok: false,
      message:
        'MESSENGER_VERIFY_TOKEN is required to verify the deployed callback challenge',
    };
  }

  const endpoint = new URL(`${workerUrl}/webhooks/messenger`);
  endpoint.searchParams.set('hub.mode', 'subscribe');
  endpoint.searchParams.set('hub.verify_token', verifyToken);
  endpoint.searchParams.set('hub.challenge', 'KFC_DEMO_PREFLIGHT');

  try {
    endpoint.searchParams.set('_', String(Date.now()));
    const response = await fetch(endpoint, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    const body = await response.text();
    return {
      name: 'messenger:verify',
      ok: response.ok && body === 'KFC_DEMO_PREFLIGHT',
      status: response.status,
      body,
      message: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name: 'messenger:verify',
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'Messenger verification check failed',
    };
  }
}

async function requestJson(
  name: string,
  url: string,
  validate: (body: unknown) => boolean,
): Promise<CheckResult> {
  try {
    const endpoint = new URL(url);
    endpoint.searchParams.set('_', String(Date.now()));
    const response = await fetch(endpoint, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    const text = await response.text();
    const body = text.length > 0 ? JSON.parse(text) : null;
    const ok = response.ok && validate(body);
    return {
      name,
      ok,
      status: response.status,
      body,
      message: ok ? undefined : `Unexpected response from ${name}`,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      message: error instanceof Error ? error.message : `${name} check failed`,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

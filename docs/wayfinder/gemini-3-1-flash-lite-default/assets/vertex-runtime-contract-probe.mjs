const project = 'kfc-model-arena-gemini';
const endpoint = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/endpoints/openapi/chat/completions`;

const base64url = (value) => btoa(String.fromCharCode(...value))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

async function accessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const der = Uint8Array.from(
    atob(serviceAccount.private_key.replace(/-----[^-]+-----|\s/g, '')),
    (character) => character.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64url(new Uint8Array(signature))}`,
    }),
  });
  const body = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`OAuth ${tokenResponse.status}: ${body.error ?? 'unknown_error'}: ${body.error_description ?? ''}`);
  }
  return body.access_token;
}

async function probe(serviceAccount, timeoutMs = 15_000) {
  const token = await accessToken(serviceAccount);
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3.1-flash-lite',
        messages: [
          { role: 'system', content: 'Return only the requested JSON.' },
          { role: 'user', content: 'Set ok to true and provider to vertex.' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'contract_probe',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                provider: { type: 'string', enum: ['vertex'] },
              },
              required: ['ok', 'provider'],
              additionalProperties: false,
            },
          },
        },
        google: { thinking_config: { thinking_level: 'minimal' } },
      }),
    });
    const body = await response.json();
    return {
      request: {
        endpoint,
        model: 'google/gemini-3.1-flash-lite',
        auth: 'OAuth service-account JWT, cloud-platform scope',
        thinkingLevel: 'minimal',
        strictJsonSchema: true,
        maxOutputTokens: 'omitted',
        timeoutMs,
      },
      response: {
        status: response.status,
        latencyMs: Date.now() - startedAt,
        model: body.model,
        finishReason: body.choices?.[0]?.finish_reason,
        content: body.choices?.[0]?.message?.content,
        thoughtSignaturePresent: Boolean(body.choices?.[0]?.message?.extra_content?.google?.thought_signature),
        usage: body.usage,
        error: body.error,
      },
    };
  } catch (error) {
    return {
      request: { endpoint, timeoutMs },
      response: {
        status: null,
        latencyMs: Date.now() - startedAt,
        error: { name: error.name, message: error.message },
      },
    };
  }
}

export default {
  async fetch(request, env) {
    const timeoutMs = Number(new URL(request.url).searchParams.get('timeoutMs')) || 15_000;
    return Response.json(await probe(JSON.parse(env.VERTEX_SERVICE_ACCOUNT_JSON), timeoutMs));
  },
};

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('vertex-runtime-contract-probe.mjs')) {
  console.log(JSON.stringify(
    await probe(
      JSON.parse(process.env.VERTEX_SERVICE_ACCOUNT_JSON),
      Number(process.env.VERTEX_TIMEOUT_MS) || 15_000,
    ),
    null,
    2,
  ));
}

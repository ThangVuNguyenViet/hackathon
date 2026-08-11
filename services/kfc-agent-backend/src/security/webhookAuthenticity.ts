function decodeHex(value: string): Uint8Array | undefined {
  if (!/^[0-9a-f]{64}$/i.test(value)) return undefined;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function verifyMetaWebhookSignature(input: {
  rawBody: Uint8Array;
  signatureHeader: string | null;
  appSecret: string;
}): Promise<boolean> {
  if (!input.appSecret || !input.signatureHeader?.startsWith('sha256=')) return false;
  const received = decodeHex(input.signatureHeader.slice('sha256='.length));
  if (!received) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, Uint8Array.from(input.rawBody).buffer));
  return equalBytes(expected, received);
}

export async function verifyZaloWebhookSignature(input: {
  rawBody: Uint8Array;
  signatureHeader: string | null;
  oaSecret: string;
  expectedAppId?: string;
}): Promise<boolean> {
  if (!input.oaSecret || !input.signatureHeader) return false;
  const header = input.signatureHeader.startsWith('sha256=')
    ? input.signatureHeader.slice('sha256='.length)
    : input.signatureHeader.startsWith('mac=')
      ? input.signatureHeader.slice('mac='.length)
      : input.signatureHeader;
  const received = decodeHex(header);
  if (!received) return false;

  const rawText = new TextDecoder().decode(input.rawBody);
  let body: unknown;
  try {
    body = JSON.parse(rawText) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(body)) return false;
  const record = body;
  if (typeof record.app_id !== 'string') return false;
  if (input.expectedAppId && record.app_id !== input.expectedAppId) return false;
  if (
    typeof record.timestamp !== 'string' &&
    typeof record.timestamp !== 'number'
  ) {
    return false;
  }

  const digestInput = `${record.app_id}${rawText}${String(record.timestamp)}${input.oaSecret}`;
  const expected = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(digestInput),
    ),
  );
  return equalBytes(expected, received);
}

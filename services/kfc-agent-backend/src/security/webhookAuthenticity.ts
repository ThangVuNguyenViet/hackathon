function decodeHex(value: string): Uint8Array | undefined {
  if (!/^[0-9a-f]{64}$/i.test(value)) return undefined;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export async function verifyMetaWebhookSignature(input: {
  rawBody: Uint8Array;
  signatureHeader: string | null;
  appSecret: string;
}): Promise<boolean> {
  if (!input.appSecret || !input.signatureHeader?.startsWith('sha256='))
    return false;
  const received = decodeHex(input.signatureHeader.slice('sha256='.length));
  if (!received) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      Uint8Array.from(input.rawBody).buffer,
    ),
  );
  return equalBytes(expected, received);
}

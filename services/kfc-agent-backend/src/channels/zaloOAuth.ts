import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.coerce.number().positive().default(86_400),
  oa_id: z.union([z.string(), z.number()]).optional(),
});

type CredentialRow = {
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  access_expires_at: Date | string;
};

export type ZaloOAuthRuntime = {
  authorizationUrl(): Promise<string>;
  completeAuthorization(query: unknown): Promise<void>;
  accessToken(): Promise<string | undefined>;
  readiness(): Promise<{ ok: boolean; error?: string }>;
};

function encryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.byteLength !== 32) {
    throw new Error(
      'ZALO_TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key',
    );
  }
  return key;
}

export function encryptZaloCredential(value: string, keyValue: string): string {
  const key = encryptionKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptZaloCredential(value: string, keyValue: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Invalid encrypted Zalo credential');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(keyValue),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function safeTokenError(): Error {
  return new Error('Zalo credential refresh failed');
}

export async function createZaloOAuthRuntime(input: {
  pool: Pool;
  appId: string;
  appSecret: string;
  oaId: string;
  callbackUrl: string;
  encryptionKey: string;
  fetchImpl?: typeof fetch;
  oauthBaseUrl?: string;
  initialAccessToken?: string;
  initialRefreshToken?: string;
}): Promise<ZaloOAuthRuntime> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const oauthBaseUrl = input.oauthBaseUrl ?? 'https://oauth.zaloapp.com';
  const keyValue = input.encryptionKey;
  encryptionKey(keyValue);
  await input.pool.query(`
    CREATE TABLE IF NOT EXISTS zalo_oauth_credentials (
      app_id text NOT NULL,
      oa_id text NOT NULL,
      access_token_ciphertext text NOT NULL,
      refresh_token_ciphertext text NOT NULL,
      access_expires_at timestamptz NOT NULL,
      authorized_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (app_id, oa_id)
    )
  `);
  await input.pool.query(`
    CREATE TABLE IF NOT EXISTS zalo_oauth_states (
      state_hash text PRIMARY KEY,
      app_id text NOT NULL,
      oa_id text NOT NULL,
      code_verifier_ciphertext text NOT NULL,
      expires_at timestamptz NOT NULL,
      used_at timestamptz
    )
  `);

  const readCredential = async (db: Pool | PoolClient) => {
    const result = await db.query<CredentialRow>(
      `SELECT access_token_ciphertext, refresh_token_ciphertext, access_expires_at
       FROM zalo_oauth_credentials WHERE app_id = $1 AND oa_id = $2`,
      [input.appId, input.oaId],
    );
    return result.rows[0];
  };

  const saveTokens = async (
    db: Pool | PoolClient,
    tokens: z.infer<typeof tokenResponseSchema>,
  ) => {
    if (tokens.oa_id !== undefined && String(tokens.oa_id) !== input.oaId) {
      throw new Error('Zalo authorization returned the wrong OA');
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokens.expires_in * 1_000);
    await db.query(
      `INSERT INTO zalo_oauth_credentials (
         app_id, oa_id, access_token_ciphertext, refresh_token_ciphertext,
         access_expires_at, authorized_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (app_id, oa_id) DO UPDATE SET
         access_token_ciphertext = EXCLUDED.access_token_ciphertext,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         access_expires_at = EXCLUDED.access_expires_at,
         updated_at = EXCLUDED.updated_at`,
      [
        input.appId,
        input.oaId,
        encryptZaloCredential(tokens.access_token, keyValue),
        encryptZaloCredential(tokens.refresh_token, keyValue),
        expiresAt.toISOString(),
        now.toISOString(),
      ],
    );
  };

  if (
    input.initialAccessToken &&
    input.initialRefreshToken &&
    !(await readCredential(input.pool))
  ) {
    await saveTokens(input.pool, {
      access_token: input.initialAccessToken,
      refresh_token: input.initialRefreshToken,
      expires_in: 3_600,
    });
  }

  const exchange = async (form: URLSearchParams) => {
    let response: Response;
    try {
      response = await fetchImpl(`${oauthBaseUrl}/v4/oa/access_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          secret_key: input.appSecret,
        },
        body: form,
      });
    } catch {
      throw safeTokenError();
    }
    if (!response.ok) throw safeTokenError();
    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw safeTokenError();
    return parsed.data;
  };

  let refreshInFlight: Promise<string | undefined> | undefined;
  const refresh = async () => {
    const client = await input.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `zalo:${input.appId}:${input.oaId}`,
      ]);
      const latest = await readCredential(client);
      if (!latest) {
        await client.query('ROLLBACK');
        return undefined;
      }
      if (new Date(latest.access_expires_at).getTime() > Date.now() + 300_000) {
        await client.query('COMMIT');
        return decryptZaloCredential(latest.access_token_ciphertext, keyValue);
      }
      const previousAccessToken = decryptZaloCredential(
        latest.access_token_ciphertext,
        keyValue,
      );
      try {
        const tokens = await exchange(
          new URLSearchParams({
            app_id: input.appId,
            grant_type: 'refresh_token',
            refresh_token: decryptZaloCredential(
              latest.refresh_token_ciphertext,
              keyValue,
            ),
          }),
        );
        await saveTokens(client, tokens);
        await client.query('COMMIT');
        return tokens.access_token;
      } catch {
        await client.query('ROLLBACK');
        if (new Date(latest.access_expires_at).getTime() > Date.now()) {
          return previousAccessToken;
        }
        throw safeTokenError();
      }
    } finally {
      client.release();
    }
  };

  const accessToken = async () => {
    const credential = await readCredential(input.pool);
    if (!credential) return undefined;
    if (
      new Date(credential.access_expires_at).getTime() >
      Date.now() + 300_000
    ) {
      return decryptZaloCredential(
        credential.access_token_ciphertext,
        keyValue,
      );
    }
    refreshInFlight ??= refresh().finally(() => {
      refreshInFlight = undefined;
    });
    return refreshInFlight;
  };

  return {
    async authorizationUrl() {
      if (await readCredential(input.pool)) {
        throw new Error('Zalo OA is already authorized');
      }
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url');
      await input.pool.query(
        `INSERT INTO zalo_oauth_states (
           state_hash, app_id, oa_id, code_verifier_ciphertext, expires_at
         ) VALUES ($1,$2,$3,$4,$5)`,
        [
          createHash('sha256').update(state).digest('hex'),
          input.appId,
          input.oaId,
          encryptZaloCredential(verifier, keyValue),
          new Date(Date.now() + 10 * 60_000).toISOString(),
        ],
      );
      const url = new URL(`${oauthBaseUrl}/v4/oa/permission`);
      url.searchParams.set('app_id', input.appId);
      url.searchParams.set('redirect_uri', input.callbackUrl);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('state', state);
      return url.toString();
    },
    async completeAuthorization(query) {
      const parsed = z
        .object({ code: z.string().min(1), state: z.string().min(1) })
        .parse(query);
      const client = await input.pool.connect();
      try {
        await client.query('BEGIN');
        const stateResult = await client.query<{
          code_verifier_ciphertext: string;
        }>(
          `UPDATE zalo_oauth_states SET used_at = now()
           WHERE state_hash = $1 AND app_id = $2 AND oa_id = $3
             AND used_at IS NULL AND expires_at > now()
           RETURNING code_verifier_ciphertext`,
          [
            createHash('sha256').update(parsed.state).digest('hex'),
            input.appId,
            input.oaId,
          ],
        );
        const state = stateResult.rows[0];
        if (!state) throw new Error('Invalid or expired Zalo OAuth state');
        const tokens = await exchange(
          new URLSearchParams({
            app_id: input.appId,
            grant_type: 'authorization_code',
            code: parsed.code,
            code_verifier: decryptZaloCredential(
              state.code_verifier_ciphertext,
              keyValue,
            ),
          }),
        );
        await saveTokens(client, tokens);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    accessToken,
    async readiness() {
      const credential = await readCredential(input.pool);
      if (!credential) return { ok: false, error: 'zalo_oa_not_authorized' };
      try {
        const token = await accessToken();
        return token
          ? { ok: true }
          : { ok: false, error: 'zalo_token_unusable' };
      } catch {
        return { ok: false, error: 'zalo_token_unusable' };
      }
    },
  };
}

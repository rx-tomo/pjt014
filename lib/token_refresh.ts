import { oauth2Client } from './google';
import { query } from './db';
import { decrypt, encrypt } from './crypto';

export const REFRESH_THRESHOLD_MS = 10 * 60 * 1000;

export function should_refresh(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < REFRESH_THRESHOLD_MS;
}

export async function refresh_tokens(
  row: { id: string; refresh_token: string },
  deps: { oauth2Client?: typeof oauth2Client; query?: typeof query } = {}
) {
  const o = deps.oauth2Client || oauth2Client;
  const q = deps.query || query;
  const refreshToken = decrypt(row.refresh_token);
  o.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await o.refreshAccessToken();
  const { refresh_token, expiry_date } = credentials;
  const expiresAt = expiry_date ? new Date(expiry_date) : null;
  const encrypted = refresh_token ? encrypt(refresh_token) : row.refresh_token;
  await q(
    'update oauth_tokens set tokens=$1, refresh_token=$2, expires_at=$3 where id=$4',
    [credentials as unknown as Record<string, unknown>, encrypted, expiresAt, row.id]
  );
  return { tokens: credentials, expires_at: expiresAt };
}

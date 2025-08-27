import { oauth2Client } from '@/lib/google';
import { query } from '@/lib/db';
import { decryptTextFromBuffer, encryptTextToBuffer } from '@/lib/crypto';

export const REFRESH_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export function shouldRefresh(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < REFRESH_THRESHOLD_MS;
}

export async function refreshTokens(row: { id: string; encrypted_refresh_token: Buffer }) {
  const refresh = decryptTextFromBuffer(row.encrypted_refresh_token);
  oauth2Client.setCredentials({ refresh_token: refresh });
  // @ts-expect-error: refreshAccessToken is available at runtime
  const { credentials } = await oauth2Client.refreshAccessToken();
  const { refresh_token, expiry_date } = credentials as any;
  const expiresAt = expiry_date ? new Date(expiry_date) : null;
  const encrypted = refresh_token ? encryptTextToBuffer(refresh_token) : row.encrypted_refresh_token;
  await query(
    'update oauth_tokens set tokens=$1, encrypted_refresh_token=$2, expires_at=$3 where id=$4',
    [credentials as unknown as Record<string, unknown>, encrypted, expiresAt, row.id]
  );
  return { tokens: credentials, expires_at: expiresAt };
}


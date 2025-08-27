import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { oauth2Client } from '@/lib/google';
import { pool } from '@/lib/db';

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
process.env.SUPABASE_DB_URL = 'postgres://localhost/test';

const { GET } = await import('@/app/api/gbp/callback/route');
const { decrypt } = await import('@/src/lib/crypto');

test('tokens are encrypted before persistence', async () => {
  const sample = { access_token: 'a', refresh_token: 'r' };
  mock.method(oauth2Client, 'getToken', async () => ({ tokens: sample }));
  let saved: any;
  mock.method(pool, 'connect', async () => ({
    query: async (_text: string, params: any[]) => {
      saved = params[2];
      return { rows: [] } as any;
    },
    release() {}
  } as any));

  const req = new Request('http://localhost/api/gbp/callback?code=xyz', {
    headers: { 'x-user-id': '123e4567-e89b-12d3-a456-426614174000' }
  });
  const res = await GET(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.tokens, sample);
  assert.ok(body.persisted);
  assert.ok(Buffer.isBuffer(saved));
  assert.notDeepEqual(saved, sample);
  const decoded = decrypt(saved);
  assert.deepEqual(decoded, sample);
});

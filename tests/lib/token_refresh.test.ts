import { test } from 'node:test';
import assert from 'node:assert';
import { refresh_tokens, should_refresh } from '../../lib/token_refresh.ts';
import { encrypt, decrypt } from '../../lib/crypto.ts';

test('refresh_tokens updates record', async () => {
  const client = {
    setCredentials: () => {},
    refreshAccessToken: async () => ({
      credentials: {
        access_token: 'new',
        refresh_token: 'newref',
        expiry_date: 1000
      }
    })
  } as any;
  const calls: any[] = [];
  const q = async (text: string, params: any[]) => {
    calls.push({ text, params });
    return { rows: [] };
  };
  const row = { id: '1', refresh_token: encrypt('oldref') };
  await refresh_tokens(row, { oauth2Client: client, query: q });
  assert.equal(calls.length, 1);
  const p = calls[0].params;
  assert.equal(decrypt(p[1]), 'newref');
  assert.equal(p[2] instanceof Date && p[2].getTime() === 1000, true);
});

test('refresh_tokens propagates error', async () => {
  const client = {
    setCredentials: () => {},
    refreshAccessToken: async () => {
      throw new Error('fail');
    }
  } as any;
  const q = async () => ({ rows: [] });
  const row = { id: '1', refresh_token: encrypt('oldref') };
  await assert.rejects(() => refresh_tokens(row, { oauth2Client: client, query: q }), /fail/);
});

test('should_refresh detects expiration', () => {
  const now = new Date();
  const soon = new Date(now.getTime() + 5 * 60 * 1000);
  const later = new Date(now.getTime() + 20 * 60 * 1000);
  assert.equal(should_refresh(soon, now), true);
  assert.equal(should_refresh(later, now), false);
});

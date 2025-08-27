import PgBoss from 'pg-boss';
import { query } from '@/lib/db';
import { refreshTokens, shouldRefresh } from '@/lib/token_refresh';

const DATABASE_URL = process.env.SUPABASE_DB_URL || 'postgres://postgres:postgres@localhost:54322/postgres';
const boss = new PgBoss(DATABASE_URL);

async function scan() {
  const res = await query<{ id: string; encrypted_refresh_token: Buffer | null; expires_at: Date | null }>(
    'select id, encrypted_refresh_token, expires_at from oauth_tokens where encrypted_refresh_token is not null'
  );
  const now = new Date();
  for (const row of res.rows) {
    if (row.expires_at && shouldRefresh(new Date(row.expires_at), now)) {
      await refreshTokens({ id: row.id, encrypted_refresh_token: row.encrypted_refresh_token! });
    }
  }
}

async function main() {
  await boss.start();
  await boss.schedule('tokens.refresh', '*/5 * * * *');
  await boss.work('tokens.refresh', async () => {
    await scan();
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


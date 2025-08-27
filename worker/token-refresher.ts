import PgBoss from 'pg-boss';
import { query } from '../lib/db';
import { refresh_tokens, should_refresh } from '../lib/token_refresh';

const DATABASE_URL =
  process.env.SUPABASE_DB_URL || 'postgres://postgres:postgres@localhost:54322/postgres';
const boss = new PgBoss(DATABASE_URL);

async function scan() {
  const res = await query(
    'select id, refresh_token, expires_at from oauth_tokens where refresh_token is not null'
  );
  const now = new Date();
  for (const row of res.rows) {
    if (row.expires_at && should_refresh(new Date(row.expires_at), now)) {
      await refresh_tokens({ id: row.id, refresh_token: row.refresh_token });
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

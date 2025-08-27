import PgBoss from 'pg-boss';
import { query } from '@/lib/db';
import { refreshTokens, shouldRefresh } from '@/lib/token_refresh';
import { logger } from '@/lib/logger';

const DATABASE_URL = process.env.SUPABASE_DB_URL || 'postgres://postgres:postgres@localhost:54322/postgres';
const boss = new PgBoss(DATABASE_URL);

async function scan() {
  const started = Date.now();
  const res = await query<{ id: string; encrypted_refresh_token: Buffer | null; expires_at: Date | null }>(
    'select id, encrypted_refresh_token, expires_at from oauth_tokens where encrypted_refresh_token is not null'
  );
  const now = new Date();
  let candidates = 0;
  let refreshed = 0;
  for (const row of res.rows) {
    if (row.expires_at && shouldRefresh(new Date(row.expires_at), now)) {
      candidates += 1;
      try {
        await refreshTokens({ id: row.id, encrypted_refresh_token: row.encrypted_refresh_token! });
        refreshed += 1;
        logger.info('token refreshed', { token_id: row.id });
      } catch (e) {
        logger.error('token refresh failed', { token_id: row.id, error: (e as Error).message });
      }
    }
  }
  const took_ms = Date.now() - started;
  logger.info('refresh scan completed', { scanned: res.rows.length, candidates, refreshed, took_ms });
  return { scanned: res.rows.length, candidates, refreshed, took_ms };
}

async function main() {
  logger.info('worker starting', { queue: 'tokens.refresh' });
  await boss.start();
  await boss.schedule('tokens.refresh', '*/5 * * * *');
  await boss.work('tokens.refresh', async (job) => {
    logger.debug('job started', { job_id: job?.id });
    try {
      const summary = await scan();
      logger.info('job finished', { job_id: job?.id, ...summary });
    } catch (e) {
      logger.error('job failed', { job_id: job?.id, error: (e as Error).message });
      throw e; // Let pg-boss handle retry
    }
  });
}

main().catch(err => {
  logger.error('worker fatal', { error: (err as Error).message });
  process.exit(1);
});

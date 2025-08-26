import PgBoss from 'pg-boss';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import pg from 'pg';

const DATABASE_URL = process.env.SUPABASE_DB_URL || 'postgres://postgres:postgres@localhost:54322/postgres';
const QPM = 300; // 全体
const PER_LOCATION_PER_MIN = 10; // 各ロケーション

const boss = new PgBoss(DATABASE_URL);

async function main() {
  await boss.start();
  await boss.work('gbp.patch', { teamSize: 5 }, async job => {
    const { accessToken, locationName, updateMask, body } = job.data as {
      accessToken: string;
      locationName: string; // accounts/{accountId}/locations/{locationId}
      updateMask: string;
      body: Record<string, unknown>;
    };

    const auth = new OAuth2Client();
    auth.setCredentials({ access_token: accessToken });
    const info = google.mybusinessbusinessinformation({ version: 'v1', auth });

    // レート制御は簡易（本番はトークンバケット/Redis等に移行推奨）
    await new Promise(r => setTimeout(r, Math.ceil(60000 / QPM)));

    const res = await info.locations.patch({
      name: locationName,
      updateMask,
      requestBody: body
    });

    console.log('patched', res.status, locationName, updateMask);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


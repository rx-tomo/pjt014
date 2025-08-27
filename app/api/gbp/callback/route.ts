import { oauth2Client } from '@/lib/google';
import * as db from '@/lib/db';
import { encrypt } from '@/src/lib/crypto';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) return Response.json({ error: 'missing code' }, { status: 400 });

  const userId = req.headers.get('x-user-id');
  if (!userId) return Response.json({ error: 'missing user' }, { status: 401 });

  const { tokens } = await oauth2Client.getToken(code);
  let encrypted: Buffer;
  try {
    encrypted = encrypt(tokens);
  } catch (e) {
    return Response.json(
      { error: `encrypt failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
  try {
    if (!process.env.SUPABASE_DB_URL) {
      throw new Error('SUPABASE_DB_URL not set');
    }
    await db.query(
      'insert into oauth_tokens (provider, user_id, encrypted_tokens) values ($1, $2, $3)',
      ['google', userId, encrypted]
    );
  } catch (e) {
    // 保存に失敗しても、開発フェーズでは結果を返して状況確認できるようにします。
    return Response.json({ ok: true, tokens, persisted: false, error: (e as Error).message });
  }
  return Response.json({ ok: true, tokens, persisted: true });
}

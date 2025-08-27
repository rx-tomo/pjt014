import { NextRequest, NextResponse } from 'next/server';
import { oauth2Client } from '@/lib/google';
import { query } from '@/lib/db';
import { encryptTextToBuffer } from '@/lib/crypto';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 });

  const { tokens } = await oauth2Client.getToken(code);
  const refreshToken = (tokens as any).refresh_token as string | undefined;
  const expiryDate = (tokens as any).expiry_date as number | undefined; // ms epoch
  const expiresAt = expiryDate ? new Date(expiryDate) : null;
  const userId = req.headers.get('x-user-id'); // optional in MVP
  let encryptedRefresh: Buffer | null = null;
  try {
    if (refreshToken) {
      encryptedRefresh = encryptTextToBuffer(refreshToken);
    }
  } catch (e) {
    return NextResponse.json({ error: `encrypt failed: ${(e as Error).message}` }, { status: 500 });
  }
  // NOTE: 実運用では KMS 等で暗号化保管し、ユーザ/テナントにひも付けます。
  try {
    if (!process.env.SUPABASE_DB_URL) {
      throw new Error('SUPABASE_DB_URL not set');
    }
    await query(
      'insert into oauth_tokens (provider, tokens, user_id, encrypted_refresh_token, expires_at) values ($1, $2, $3, $4, $5)',
      [
        'google',
        tokens as unknown as Record<string, unknown>,
        userId,
        encryptedRefresh,
        expiresAt
      ]
    );
  } catch (e) {
    // 保存に失敗しても、開発フェーズでは結果を返して状況確認できるようにします。
    return NextResponse.json({ ok: true, tokens, persisted: false, error: (e as Error).message });
  }
  return NextResponse.json({ ok: true, tokens, persisted: true });
}

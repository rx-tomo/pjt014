import { NextRequest, NextResponse } from 'next/server';
import { oauth2Client } from '@/lib/google';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 });

  const { tokens } = await oauth2Client.getToken(code);
  // NOTE: 実運用では KMS 等で暗号化保管し、ユーザ/テナントにひも付けます。
  try {
    if (!process.env.SUPABASE_DB_URL) {
      throw new Error('SUPABASE_DB_URL not set');
    }
    await query(
      'insert into oauth_tokens (provider, tokens) values ($1, $2)',
      ['google', tokens as unknown as Record<string, unknown>]
    );
  } catch (e) {
    // 保存に失敗しても、開発フェーズでは結果を返して状況確認できるようにします。
    return NextResponse.json({ ok: true, tokens, persisted: false, error: (e as Error).message });
  }
  return NextResponse.json({ ok: true, tokens, persisted: true });
}

function write_json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

import { parse_cookies, sign_value, verify_value, set_cookie, clear_cookie } from '../core/cookies.js';
import { create_session, get_session, destroy_session } from '../core/session_store.js';
import { aes_gcm_encrypt } from '../core/crypto.js';
import { verify_google_id_token } from '../core/oidc.js';

export function handle_oauth_status(req, res) {
  const cookies = parse_cookies(req.headers.cookie || '');
  const secret = process.env.APP_SECRET || 'dev_secret';
  const signed_sid = cookies.sid;
  let session = null;
  if (signed_sid) {
    const sid = verify_value(signed_sid, secret);
    if (sid) session = get_session(sid);
  }
  const authenticated = Boolean(session);
  const email = session?.user?.email || null;

  write_json(res, 200, {
    ok: true,
    services: {
      google: {
        configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || null,
        authenticated,
        email
      }
    }
  });
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

function build_google_auth_url({ state }) {
  const client_id = process.env.GOOGLE_CLIENT_ID;
  const redirect_uri = process.env.GOOGLE_REDIRECT_URI;
  if (!client_id || !redirect_uri) return null;
  const params = new URLSearchParams({
    client_id,
    redirect_uri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: state || ''
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function handle_oauth_start(_req, res, query) {
  const provider = query?.provider || 'google';
  if (provider !== 'google') {
    return write_json(res, 400, { ok: false, error: 'unsupported_provider' });
  }
  const state = Math.random().toString(36).slice(2);
  const nonce = Math.random().toString(36).slice(2);
  const secret = process.env.APP_SECRET || 'dev_secret';
  // 状態保持: stateを署名付きCookieとして短時間保持
  set_cookie(res, 'oauth_state', sign_value(state, secret), { httpOnly: true, maxAge: 600, sameSite: 'Lax' });
  set_cookie(res, 'oauth_nonce', sign_value(nonce, secret), { httpOnly: true, maxAge: 600, sameSite: 'Lax' });
  const url = build_google_auth_url({ state, nonce });
  if (!url) {
    return write_json(res, 500, { ok: false, error: 'google_not_configured' });
  }
  return redirect(res, url);
}

export async function handle_oauth_callback(_req, res, query) {
  const { code, state, error } = query || {};
  if (error) return write_json(res, 400, { ok: false, error });
  if (!code) return write_json(res, 400, { ok: false, error: 'missing_code' });
  // state検証
  const cookies = parse_cookies(_req.headers.cookie || '');
  const secret = process.env.APP_SECRET || 'dev_secret';
  const saved = cookies.oauth_state ? verify_value(cookies.oauth_state, secret) : null;
  const savedNonce = cookies.oauth_nonce ? verify_value(cookies.oauth_nonce, secret) : null;
  if (!saved || saved !== state) {
    return write_json(res, 400, { ok: false, error: 'invalid_state' });
  }
  // 1回限り
  clear_cookie(res, 'oauth_state');
  clear_cookie(res, 'oauth_nonce');

  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || '',
    grant_type: 'authorization_code'
  });

  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return write_json(res, 502, { ok: false, error: 'token_exchange_failed', detail: txt });
    }
    const tokens = await resp.json();
    // id_token をJWKSで検証し、nonce/audも確認
    const audience = process.env.GOOGLE_CLIENT_ID || '';
    const payload = await verify_google_id_token(tokens.id_token, { audience, nonce: savedNonce || undefined });
    const email = payload.email || null;
    // 永続化（Supabaseが設定されていれば保存）
    let persisted = false;
    try {
      const url = process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && serviceKey) {
        // 現行スキーマ: oauth_tokens(provider text not null, tokens jsonb not null, ...)
        const expiresAtIso = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
        const payload = [{
          provider: 'google',
          tokens: {
            email,
            id_token: tokens.id_token || null,
            access_token: tokens.access_token || null,
            refresh_token: tokens.refresh_token || null,
            expires_at: expiresAtIso
          }
        }];
        const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/oauth_tokens`, {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'content-type': 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify(payload)
        });
        if (!r.ok) {
          const txt = await r.text();
          console.error('[supabase] persist failed:', r.status, txt);
        }
        persisted = r.ok;
      }
    } catch (e) {
      console.error('[supabase] persist error:', e);
      // 永続化失敗は致命ではないため握りつぶし（ログは本番で送る）
    }

    // セッション作成（開発用：メモリ保持）
    const sid = create_session({ provider: 'google', user: { email, sub: payload.sub }, tokens, oidc: { verified: true } }, 3600);
    set_cookie(res, 'sid', sign_value(sid, secret), { httpOnly: true, maxAge: 3600, sameSite: 'Lax' });
    // UX: ダッシュボードへ戻す
    return redirect(res, `/?ok=1&persisted=${persisted ? '1' : '0'}`);
  } catch (e) {
    return write_json(res, 500, { ok: false, error: 'network_error', detail: String(e) });
  }
}

export function handle_oauth_logout(req, res) {
  const cookies = parse_cookies(req.headers.cookie || '');
  const secret = process.env.APP_SECRET || 'dev_secret';
  const signed_sid = cookies.sid;
  if (signed_sid) {
    const sid = verify_value(signed_sid, secret);
    if (sid) destroy_session(sid);
  }
  clear_cookie(res, 'sid');
  return redirect(res, '/');
}

export async function handle_oauth_refresh(req, res) {
  const cookies = parse_cookies(req.headers.cookie || '');
  const secret = process.env.APP_SECRET || 'dev_secret';
  const signed_sid = cookies.sid;
  if (!signed_sid) return write_json(res, 401, { ok: false, error: 'no_session' });
  const sid = verify_value(signed_sid, secret);
  if (!sid) return write_json(res, 401, { ok: false, error: 'invalid_session' });
  const session = get_session(sid);
  if (!session) return write_json(res, 401, { ok: false, error: 'session_expired' });
  const refresh = session.tokens?.refresh_token;
  if (!refresh) return write_json(res, 400, { ok: false, error: 'no_refresh_token' });

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
    refresh_token: refresh,
  });
  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return write_json(res, 502, { ok: false, error: 'refresh_failed', detail: txt });
    }
    const tokens = await resp.json();
    // セッションを更新
    session.tokens = { ...session.tokens, ...tokens };
    // Supabaseにも新しいトークンスナップショットを追加保存（同じ形式）
    try {
      const url = process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && serviceKey) {
        const expiresAtIso = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
        const payload = [{
          provider: 'google',
          tokens: {
            email: session.user?.email || null,
            id_token: tokens.id_token || session.tokens?.id_token || null,
            access_token: tokens.access_token || null,
            refresh_token: session.tokens?.refresh_token || null,
            expires_at: expiresAtIso,
          },
        }];
        await fetch(`${url.replace(/\/$/, '')}/rest/v1/oauth_tokens`, {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'content-type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(payload),
        });
      }
    } catch {}
    return write_json(res, 200, { ok: true, refreshed: true });
  } catch (e) {
    return write_json(res, 500, { ok: false, error: 'network_error', detail: String(e) });
  }
}

import http from 'node:http';
import fs from 'node:fs';
import { parse, fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  handle_oauth_status,
  handle_oauth_start,
  handle_oauth_callback,
  handle_oauth_logout,
  handle_oauth_refresh,
} from '../auth/oauth_routes.js';
import { parse as parseUrl } from 'node:url';
import { parse_cookies, verify_value, set_cookie } from './cookies.js';
import { get_session } from './session_store.js';
import { load_env_from_file } from './env.js';
import { get_locations, get_location } from './locations_stub.js';
import { get_owned_location_ids } from './memberships_stub.js';
import { create_change_request, list_change_requests, set_status, get_change_request, set_checks, set_status_and_reason, upsert_change_request } from './change_requests_store.js';
import { notify, buildChangeRequestNotification } from './notifier.js';
import { check_changes } from './compliance_stub.js';

const DEFAULT_PORT = Number(process.env.PORT || 3014);
// localhostでも外部IFでも到達できるようデフォルトは0.0.0.0
const DEFAULT_HOST = process.env.HOST || '0.0.0.0';

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

  function html(res, status, body) {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  }

  // Dev live-reload (SSE) support
  const dev_clients = [];
  const DEV_ENABLED = process.env.NODE_ENV !== 'production' && process.env.DEV_RELOAD !== '0';
  let DEV_WATCHER_STARTED = false;

  function dev_reload_script() {
    if (!DEV_ENABLED) return '';
    return `\n<script>\n(()=>{\n  let es=null;\n  const close=()=>{ try{ es && es.close(); }catch(_){} };\n  const connect = ()=>{ try{ es = new EventSource('/__dev/reload'); es.onmessage = (e)=>{ if(e.data==='reload'){ location.reload(); } }; }catch(e){} };\n  if (document.readyState === 'complete') { setTimeout(connect, 0); } else { window.addEventListener('load', connect, { once: true }); }\n  window.addEventListener('pagehide', close, { once: true });\n  window.addEventListener('beforeunload', close, { once: true });\n  document.addEventListener('visibilitychange', ()=>{ if(document.hidden){ close(); } });\n})();\n</script>\n`;
  }

  function dev_broadcast_reload() {
    for (const res of dev_clients.slice()) {
      try { res.write('data: reload\n\n'); } catch {}
    }
  }

  function start_dev_watcher_once() {
    if (!DEV_ENABLED || DEV_WATCHER_STARTED) return;
    DEV_WATCHER_STARTED = true;
    try {
      const watchPath = path.resolve('src');
      if (fs.existsSync(watchPath)) {
        fs.watch(watchPath, { recursive: true }, () => dev_broadcast_reload());
      }
    } catch {}
  }

  // --- Minimal in-memory audit log + optional Supabase outbox ---
  const AUDIT = globalThis.__pjt014_audits || (globalThis.__pjt014_audits = []);
  function record_audit(evt) {
    const rec = Object.assign({
      id: randomUUID(),
      created_at: new Date().toISOString(),
    }, evt || {});
    try { AUDIT.push(rec); } catch {}
    try {
      if (supabaseEnabled()) {
        enqueueOutbox({ type: 'insert_audit_log', data: rec });
      }
    } catch {}
    return rec;
  }

  // Simple top navigation to clarify who each screen is for
  function header_nav() {
    const dev = DEV_ENABLED;
    const roleSwitch = dev
      ? '<span id="__role_switch" style="float:right; color:#555">Role: '+
        '<a data-role="owner" href="/__dev/impersonate?role=owner">Owner</a> | '+
        '<a data-role="reviewer" href="/__dev/impersonate?role=reviewer">Reviewer</a> | '+
        '<a data-role="admin" href="/__dev/impersonate?role=admin">Admin</a>'+ 
        '<span id="__role_current"></span>'+ 
        '</span>'
      : '';
    const roleHighlightScript = dev
      ? '<script>(function(){try{var m=document.cookie.match(/(?:^|;)[\s]*role=([^;]+)/);var r=m?decodeURIComponent(m[1]):"";var w=document.getElementById("__role_switch");if(w){var as=w.querySelectorAll("a[data-role]");for(var i=0;i<as.length;i++){if(as[i].getAttribute("data-role")===(r||"")){as[i].style.fontWeight="700";as[i].style.color="#c30";}}var cur=document.getElementById("__role_current");if(cur){cur.textContent=r?" ("+r+")":"";cur.style.color="#c30";}var hb=document.getElementById("__health_bar");if(hb){fetch("/api/health").then(function(x){return x.json()}).then(function(j){if(j&&j.ok){var rt=j.runtime||{};hb.textContent=(rt.supabase_configured?"DB:on":"DB:off")+" | Outbox:"+(rt.outbox_len||0);}}).catch(function(){})}}catch(e){}})();</script>'
      : '';
    return `
      <nav style="margin:8px 0 16px; padding-bottom:8px; border-bottom:1px solid #ddd; overflow:auto">
        <a href="/">Home</a> |
        <a href="/locations">Locations</a> |
        <a href="/owner">Owner Portal</a> |
        <a href="/review">Review Queue</a>
        ${roleSwitch}
        <span id="__health_bar" style="float:right; margin-right:8px; color:#555"></span>
      </nav>${roleHighlightScript}
    `;
  }

  function seconds_left(session) {
    try {
      const expIn = Number(session?.tokens?.expires_in || 0);
      const obtained = Number(session?.tokens_obtained_at || 0);
      if (!expIn || !obtained) return null;
      const left = Math.floor(obtained / 1000 + expIn - Date.now() / 1000);
      return left;
    } catch {
      return null;
    }
  }

export function create_server() {
  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    const { pathname, query } = parse(req.url || '/', true);
    const method = (req.method || 'GET').toUpperCase();
    const reqId = randomUUID().slice(0, 8);
    try { res.setHeader('x-request-id', reqId); } catch {}

    // CORS: 許可オリジンの制御（ENV: ALLOWED_ORIGINS="https://a.com,https://b.com"）
    try {
      const allowEnv = (process.env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
      const origin = (req.headers.origin || '').toString();
      if (allowEnv.length && origin && allowEnv.includes(origin)) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
      } else if (allowEnv.length) {
        // 限定モードで不一致 → 明示的にnull（ブラウザは利用不可）
        res.setHeader('access-control-allow-origin', 'null');
        res.setHeader('vary', 'Origin');
      } else {
        // 既定: ワイドオープン（MVP開発用）
        res.setHeader('access-control-allow-origin', '*');
      }
    } catch { res.setHeader('access-control-allow-origin', '*'); }
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    try {
      const ref = (req.headers.referer || '').toString();
      const ua = (req.headers['user-agent'] || '').toString();
      console.log(`[http] -> start ${reqId} ${method} ${pathname} ref=${ref||'-'} ua=${ua.slice(0,60)}`);
      // basic request timing log
      res.on('finish', () => {
        const ms = Date.now() - t0;
        try { console.log(`[http] <- end   ${reqId} ${method} ${pathname} ${res.statusCode} ${ms}ms`); } catch {}
      });
      res.on('close', () => {
        const ms = Date.now() - t0;
        try { console.log(`[http] !! close ${reqId} ${method} ${pathname} ${res.statusCode} ${ms}ms`); } catch {}
      });
      // Dev SSE endpoint
      if (DEV_ENABLED && method === 'GET' && pathname === '/__dev/reload') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write('retry: 1000\n\n');
        dev_clients.push(res);
        req.on('close', () => {
          const i = dev_clients.indexOf(res);
          if (i >= 0) dev_clients.splice(i, 1);
        });
        return; // keep open
      }
      // Dev: role impersonation
      if (DEV_ENABLED && method === 'GET' && pathname === '/__dev/impersonate') {
        try {
          const url = new URL(req.url || '', 'http://x');
          const role = String(url.searchParams.get('role') || '').toLowerCase();
          const allowed = new Set(['owner','reviewer','admin']);
          if (!allowed.has(role)) {
            res.statusCode = 400; res.end('invalid role'); return;
          }
          const SECURE = (function(){
            const v = String(process.env.COOKIE_SECURE || '').toLowerCase();
            if (v === '1' || v === 'true' || v === 'yes') return true;
            if (v === '0' || v === 'false' || v === 'no') return false;
            return process.env.NODE_ENV === 'production';
          })();
          set_cookie(res, 'role', role, { httpOnly: true, sameSite: 'Lax', secure: SECURE, path: '/' });
          const ref = req.headers.referer || '/';
          res.statusCode = 302; res.setHeader('location', ref); return res.end();
        } catch {
          res.statusCode = 400; return res.end('bad request');
        }
      }

      start_dev_watcher_once();
      async function read_json() {
        const tStart = Date.now();
        return await new Promise((resolve, reject) => {
          const chunks = [];
          const onError = (e) => {
            const ms = Date.now() - tStart;
            console.warn(`[http] ${method} ${pathname} read_json error after ${ms}ms: ${e && e.message ? e.message : e}`);
            reject(e || new Error('request_error'));
          };
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            const ms = Date.now() - tStart;
            try {
              const rawBuf = Buffer.concat(chunks);
              const raw = rawBuf.toString('utf8') || '{}';
              console.log(`[http] ${method} ${pathname} read_json ok ${rawBuf.length}B ${ms}ms`);
              resolve(JSON.parse(raw));
            } catch (e) {
              console.warn(`[http] ${method} ${pathname} read_json parse failed ${ms}ms: ${e && e.message ? e.message : e}`);
              reject(e);
            }
          });
          req.on('error', onError);
          req.on('aborted', () => onError(new Error('request_aborted')));
        });
      }

      if (method === 'GET' && pathname === '/') {
        const page = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>pjt014 Dev Dashboard</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;}
      .ok{color:#0a0}
      .err{color:#a00}
      code{background:#f4f4f4;padding:2px 4px;border-radius:4px}
      a.button{display:inline-block;padding:8px 12px;border:1px solid #333;border-radius:6px;text-decoration:none}
    </style>
  </head>
  <body>
    ${header_nav()}
    <h1>pjt014 Dev Dashboard</h1>
    <p>ローカル環境の確認用ダッシュボードです。</p>
    <div style="background:#f6fafe;border:1px solid #cde;padding:10px;border-radius:6px;margin:10px 0">
      <b>画面の使い分け（デモ）</b>
      <ul>
        <li><a href="/locations">Locations</a>: 対象=全ユーザー（閲覧）。ロケーション一覧/詳細の確認。</li>
        <li><a href="/owner">Owner Portal</a>: 対象=オーナー。ロケーションを選び、変更依頼を提出。</li>
        <li><a href="/review">Review Queue</a>: 対象=オペレーター/承認者。依頼のチェック/承認/差戻し。</li>
      </ul>
      <div style="margin-top:8px">
        <b>推奨チェック手順</b>
        <ol style="margin:6px 0 0 18px; padding:0">
          <li>Locationsで対象ロケーションを確認</li>
          <li>Owner Portalで変更依頼を作成し送信（同意チェック必須）</li>
          <li>Review Queueで新規依頼を開き、自動チェックとチェックリストを確認</li>
          <li>問題なければ承認（approved）。修正要なら差戻し（needs_fix）。</li>
        </ol>
      </div>
    </div>
    <h2>Dashboard</h2>
    <div id="auth" style="margin-bottom:12px;">
      <div id="status">loading...</div>
      <div id="token"></div>
    </div>
    <p>
      <a class="button" id="oauth-btn" href="/api/gbp/oauth?provider=google">GoogleでOAuth開始</a>
      <a class="button" id="logout-btn" href="/api/gbp/logout" style="display:none">ログアウト</a>
      <button class="button" id="refresh-btn" style="display:none">アクセストークン更新</button>
    </p>
    <h2>その他</h2>
    <ul>
      <li><a href="/jobs">Jobs UI (placeholder)</a></li>
      <li><a href="/locations">ロケーション一覧（読み取り）</a></li>
      <li><a href="/owner">オーナーポータル（最小）</a></li>
    </ul>
    <script>
      async function load() {
        try{
          const d = await (await fetch('/api/dashboard')).json();
          const statusEl = document.getElementById('status');
          const tokenEl = document.getElementById('token');
          const btn = document.getElementById('oauth-btn');
          const logout = document.getElementById('logout-btn');
          const refreshBtn = document.getElementById('refresh-btn');
          const cfg = d?.config?.google_configured;
          const authed = d?.session?.authenticated;
          const email = d?.session?.email;
          const secLeft = d?.session?.token_seconds_left;
          const persistedAt = d?.persistence?.last_saved_at;
          const persistedExp = d?.persistence?.last_expires_at;
          statusEl.innerHTML = 'OAuth: <span class="'+(cfg?'ok':'err')+'">'+(cfg?'configured':'not configured')+'</span>' + (authed? ' - signed in as <b>'+(email||'unknown')+'</b>':'');
          btn.style.display = cfg && !authed ? 'inline-block' : 'none';
          logout.style.display = authed ? 'inline-block' : 'none';
          refreshBtn.style.display = authed ? 'inline-block' : 'none';
          tokenEl.innerHTML = authed ? ('Token: ' + (secLeft!=null? (secLeft+'s left'):'n/a') + (persistedAt? ' | last saved: '+persistedAt: '') + (persistedExp? ' | last expires_at: '+persistedExp: '')) : '';
          refreshBtn.onclick = async ()=>{
            const r = await fetch('/api/gbp/oauth/refresh', { method:'POST' });
            const j = await r.json();
            if(j.ok){ load(); } else { alert('refresh failed'); }
          };
        }catch(e){
          const el = document.getElementById('status');
          el.textContent = 'Dashboard load error';
          el.className = 'err';
        }
      }
      load();
    </script>
  </body>
  </html>`;
        return html(res, 200, page + dev_reload_script());
      }

      if (method === 'GET' && pathname === '/oauth/status') {
        return handle_oauth_status(req, res);
      }

      if (method === 'GET' && pathname === '/api/gbp/oauth') {
        return handle_oauth_start(req, res, query);
      }
      if (method === 'GET' && pathname === '/api/gbp/oauth/callback') {
        return handle_oauth_callback(req, res, query);
      }
      if (method === 'GET' && pathname === '/api/gbp/logout') {
        return handle_oauth_logout(req, res);
      }
      if (method === 'POST' && pathname === '/api/gbp/oauth/refresh') {
        return handle_oauth_refresh(req, res);
      }

      if (method === 'GET' && pathname === '/api/dashboard') {
        // 集約状態
        const cookies = req.headers.cookie || '';
        const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
        const secret = process.env.APP_SECRET || 'dev_secret';
        let session = null;
        try {
          const sidSigned = parsed.sid;
          if (sidSigned) {
            const sid = verify_value(sidSigned, secret);
            if (sid) session = get_session(sid);
          }
        } catch {}
        const authenticated = !!session;
        const email = session?.user?.email || null;
        const left = seconds_left(session);
        const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        // Supabaseの最終保存を参照
        let persistence = { last_saved_at: null, last_expires_at: null };
        try {
          if (supabaseEnabled() && email) {
            const qs = `email=eq.${encodeURIComponent(email)}&select=created_at,expires_at&order=created_at.desc&limit=1`;
            const r = await sbFetch(`/rest/v1/oauth_tokens_secure?${qs}`, { method: 'GET' }, 600);
            if (r && r.ok) {
              const arr = await r.json();
              if (arr && arr.length) {
                persistence.last_saved_at = arr[0].created_at || null;
                persistence.last_expires_at = arr[0].expires_at || null;
              }
            }
          }
        } catch {}
        const outboxLen = (globalThis.__pjt014_outbox || []).length;
        const storeCount = (()=>{ try { return list_change_requests().length; } catch { return null; } })();
        return json(res, 200, {
          ok: true,
          config: { google_configured: googleConfigured },
          session: { authenticated, email, token_seconds_left: left },
          persistence,
          runtime: { outbox_len: outboxLen, store_count: storeCount, supabase_configured: supabaseEnabled() },
        });
      }

      // API: locations (stub)
      if (method === 'GET' && pathname === '/api/locations') {
        return json(res, 200, { ok: true, items: get_locations() });
      }
      if (method === 'GET' && pathname.startsWith('/api/locations/')) {
        const id = pathname.split('/').pop();
        const loc = get_location(id || '');
        if (!loc) return json(res, 404, { ok: false, error: 'not_found' });
        return json(res, 200, { ok: true, item: loc });
      }

      // API: change requests (in-memory + optional Supabase)
      function supabaseEnabled() {
        return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
      }
      async function sbFetch(pathname, init, timeoutMs = 1500) {
        const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        const headers = Object.assign({}, init?.headers || {}, { apikey: key, Authorization: `Bearer ${key}` });
        const controller = new AbortController();
        const to = Math.max(250, timeoutMs);
        const started = Date.now();
        const t = setTimeout(() => controller.abort(), to);
        try {
          console.log(`[sb] -> ${init?.method || 'GET'} ${pathname} (timeout=${to}ms)`);
          const res = await fetch(base + pathname, Object.assign({}, init, { headers, signal: controller.signal }));
          const ms = Date.now() - started;
          console.log(`[sb] <- ${res.status} ${pathname} ${ms}ms`);
          return res;
        } catch (e) {
          const ms = Date.now() - started;
          console.warn(`[sb] !! error ${pathname} after ${ms}ms: ${e && e.message ? e.message : e}`);
          throw e;
        } finally {
          clearTimeout(t);
        }
      }

      // --- Outbox: 非同期保存の再送キュー（メモリ + ディスク永続） ---
      const OUTBOX = globalThis.__pjt014_outbox || (globalThis.__pjt014_outbox = []);
      const { persist_dir, load_json, save_json_atomic } = await import('./persist.js');
      const OUTBOX_FILE = path.join(persist_dir(), 'outbox.json');
      function outbox_save() { try { save_json_atomic(OUTBOX_FILE, OUTBOX); } catch {} }
      // bootstrap from disk once
      if (!globalThis.__pjt014_outbox_loaded) {
        try {
          const arr = load_json(OUTBOX_FILE, []);
          if (Array.isArray(arr) && arr.length) { OUTBOX.push(...arr); }
        } catch {}
        globalThis.__pjt014_outbox_loaded = true;
      }
      function enqueueOutbox(task) {
        const now = Date.now();
        OUTBOX.push({ ...task, attempts: 0, nextAt: now });
        outbox_save();
      }
      let OUTBOX_TIMER = globalThis.__pjt014_outbox_timer || null;
      async function processOutboxTick() {
        if (!supabaseEnabled()) return;
        const now = Date.now();
        for (const task of OUTBOX.slice()) {
          if (task.nextAt > now) continue;
          try {
          if (task.type === 'insert_change_request') {
              const payload = [{
                id: task.data.id,
                location_id: task.data.location_id,
                changes: task.data.changes,
                status: task.data.status,
                owner_signoff: task.data.owner_signoff,
                created_by_email: task.data.created_by_email,
              }];
              const r = await sbFetch('/rest/v1/owner_change_requests', {
                method: 'POST',
                headers: { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify(payload),
              }, 1500);
              if (r.ok || r.status === 409) {
                OUTBOX.splice(OUTBOX.indexOf(task), 1);
                outbox_save();
                continue;
              }
              throw new Error('persist_failed:'+r.status);
            }
            if (task.type === 'insert_audit_log') {
              const payload = [{
                id: task.data.id,
                entity: task.data.entity,
                entity_id: task.data.entity_id,
                action: task.data.action,
                actor_email: task.data.actor_email || null,
                meta: task.data.meta || {},
                created_at: task.data.created_at,
              }];
              const r = await sbFetch('/rest/v1/audit_logs', {
                method: 'POST',
                headers: { 'content-type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify(payload),
              }, 1500);
              if (r.ok || r.status === 409) {
                OUTBOX.splice(OUTBOX.indexOf(task), 1);
                continue;
              }
              throw new Error('audit_persist_failed:'+r.status);
            }
          if (task.type === 'patch_change_request') {
            const r = await sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(task.id)}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify(task.patch || {}),
            }, 1500);
              if (r.ok) {
                OUTBOX.splice(OUTBOX.indexOf(task), 1);
                outbox_save();
                continue;
              }
            throw new Error('patch_failed:'+r.status);
          }
          if (task.type === 'insert_notification') {
            const r = await sbFetch('/rest/v1/notifications', {
              method: 'POST',
              headers: { 'content-type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify([{ 
                channel: task.data.channel || 'change_request',
                target: task.data.target || null,
                subject: task.data.subject || null,
                body: task.data.body || null,
                status: task.data.status || 'queued'
              }]),
            }, 1500);
              if (r.ok) {
                OUTBOX.splice(OUTBOX.indexOf(task), 1);
                outbox_save();
                continue;
              }
            throw new Error('notification_persist_failed:'+r.status);
          }
          } catch (e) {
            task.attempts += 1;
            const backoff = Math.min(60000, 1000 * Math.pow(2, Math.min(8, task.attempts - 1)));
            task.nextAt = Date.now() + backoff;
            console.warn('[outbox] retry in', backoff, 'ms', e && e.message ? e.message : e);
          }
        }
      }
      function ensureOutboxTimer() {
        if (!OUTBOX_TIMER) {
          OUTBOX_TIMER = globalThis.__pjt014_outbox_timer = setInterval(processOutboxTick, 1000);
        }
      }
      ensureOutboxTimer();
      if (method === 'GET' && pathname === '/api/change-requests') {
        const locId = query?.location_id || null;
        const st = query?.status || null;
        if (locId) {
          // 所有者のみ該当ロケーションの一覧にアクセス可能
          let session = null;
          let devRole = null;
          try {
            const cookies = req.headers.cookie || '';
            const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
            const secret = process.env.APP_SECRET || 'dev_secret';
            devRole = (parsed.role || '').toString();
            const sidSigned = parsed.sid;
            if (sidSigned) {
              const sid = verify_value(sidSigned, secret);
              if (sid) session = get_session(sid);
            }
          } catch {}
          let email = session?.user?.email || null;
          if (!email && DEV_ENABLED && devRole === 'owner') {
            email = process.env.DEV_OWNER_EMAIL || 'owner1@example.com';
          }
          if (!email) return json(res, 401, { ok: false, error: 'unauthorized' });
          const allowed = new Set(get_owned_location_ids(email));
          if (!allowed.has(locId)) return json(res, 403, { ok: false, error: 'forbidden' });
        } else {
          // 全件一覧はレビュアーのみ（dev時の簡易ガード）
          try {
            const cookies = req.headers.cookie || '';
            const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
            const role = (parsed.role || '').toString();
            if (DEV_ENABLED && role !== 'reviewer') {
              return json(res, 403, { ok: false, error: 'forbidden' });
            }
          } catch {}
        }
        if (supabaseEnabled()) {
          try {
            const params = new URLSearchParams();
            if (locId) params.set('location_id', `eq.${encodeURIComponent(locId)}`);
            if (st) params.set('status', `eq.${encodeURIComponent(String(st))}`);
            const qs = params.toString();
            const r = await sbFetch('/rest/v1/owner_change_requests' + (qs ? `?${qs}` : ''), { method: 'GET' }, 600);
            const arr = r.ok ? await r.json() : [];
            if (Array.isArray(arr) && arr.length) {
              // read-through cache: sync into local store
              try { for (const it of arr) upsert_change_request(it); } catch {}
              return json(res, 200, { ok: true, items: arr });
            }
          } catch {}
        }
        const all = list_change_requests();
        let items = all;
        if (locId) items = items.filter(r => (r.payload?.location_id||null) === locId);
        if (st) items = items.filter(r => (r.status||'') === st);
        return json(res, 200, { ok: true, items });
      }
      if (method === 'GET' && pathname.startsWith('/api/change-requests/')) {
        const id = pathname.split('/').pop();
        if (!id) return json(res, 400, { ok: false, error: 'bad_request' });
        if (supabaseEnabled()) {
          try {
            const r = await sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`, { method: 'GET' }, 600);
            if (r.ok) {
              const arr = await r.json();
              const item = Array.isArray(arr) && arr[0] ? arr[0] : null;
              if (item) { try { upsert_change_request(item); } catch {} return json(res, 200, { ok: true, item }); }
            }
          } catch {}
        }
        const rec = get_change_request(id);
        if (!rec) return json(res, 404, { ok: false, error: 'not_found' });
        const item = {
          id: rec.id,
          location_id: rec.payload?.location_id || null,
          changes: rec.payload?.changes || {},
          status: rec.status,
          created_at: rec.created_at,
          review_note: rec.review_note || null,
          owner_signoff: Boolean(rec.payload?.owner_signoff || false),
          checks: rec.checks || {},
        };
        return json(res, 200, { ok: true, item });
      }
      if (method === 'POST' && pathname === '/api/change-requests') {
        try {
          const body = await read_json();
          if (!body || typeof body.location_id !== 'string' || !body.location_id) {
            return json(res, 400, { ok: false, error: 'invalid_location_id' });
          }
          if (!body || !(body.owner_signoff === true || body.owner_signoff === 'true' || body.owner_signoff === 1 || body.owner_signoff === '1')) {
            return json(res, 400, { ok: false, error: 'invalid_owner_signoff' });
          }
          // 認可: 所属ロケーションのみ作成可能
          let session = null;
          let devRole = null;
          try {
            const cookies = req.headers.cookie || '';
            const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
            const secret = process.env.APP_SECRET || 'dev_secret';
            devRole = (parsed.role || '').toString();
            const sidSigned = parsed.sid;
            if (sidSigned) {
              const sid = verify_value(sidSigned, secret);
              if (sid) session = get_session(sid);
            }
          } catch {}
          let email = session?.user?.email || null;
          if (!email && DEV_ENABLED && devRole === 'owner') {
            email = process.env.DEV_OWNER_EMAIL || 'owner1@example.com';
          }
          if (!email) return json(res, 401, { ok: false, error: 'unauthorized' });
          const allowed = new Set(get_owned_location_ids(email));
          if (!allowed.has(body.location_id)) return json(res, 403, { ok: false, error: 'forbidden' });

          // 入力バリデーション（簡易）
          const errors = {};
          if (body.phone != null && String(body.phone).trim() !== '') {
            const phone = String(body.phone).trim();
            const phoneOk = /^(?:\+?\d{1,4}[ \-]?)?(?:\d{2,4}[ \-]?){2,4}\d{2,4}$/.test(phone);
            if (!phoneOk) errors.phone = 'invalid_format';
          }
          if (body.url != null && String(body.url).trim() !== '') {
            const url = String(body.url).trim();
            let parsedUrlOk = true;
            try { new URL(url); } catch { parsedUrlOk = false; }
            const httpsOk = /^https:\/\//i.test(url);
            if (!parsedUrlOk) errors.url = 'invalid_url';
            else if (!httpsOk) errors.url = 'require_https';
          }
          if (Object.keys(errors).length) return json(res, 400, { ok: false, error: 'validation_error', errors });
          const rec = create_change_request({
            location_id: body?.location_id || null,
            changes: {
              phone: body?.phone ?? null,
              hours: body?.hours ?? null,
              url: body?.url ?? null,
              description: body?.description ?? null,
              photo_url: body?.photo_url ?? null,
            },
            owner_signoff: Boolean(body?.owner_signoff || false),
          });
          try { rec.created_by_email = email || null; } catch {}
          // Outbox: 後続でSupabaseに非同期保存（リトライあり）
          enqueueOutbox({ type: 'insert_change_request', data: { id: rec.id, location_id: rec.payload.location_id, changes: rec.payload.changes, status: rec.status, owner_signoff: Boolean(rec.payload.owner_signoff||false), created_by_email: email } });
          // Audit: 作成
          record_audit({ entity: 'change_request', entity_id: rec.id, action: 'created', actor_email: email, meta: { location_id: body.location_id } });
          return json(res, 201, { ok: true, id: rec.id });
        } catch (e) {
          return json(res, 400, { ok: false, error: 'invalid_json' });
        }
      }
      if (method === 'POST' && pathname.startsWith('/api/change-requests/') && pathname.endsWith('/status')) {
        try {
          const id = pathname.split('/')[3];
          const body = await read_json();
          const st = String(body?.status || '').toLowerCase();
          if (!['submitted','in_review','needs_fix','approved','syncing','synced','failed'].includes(st)) {
            return json(res, 400, { ok: false, error: 'invalid_status' });
          }
          const reason = (typeof body?.reason === 'string' ? body.reason.trim() : '');
          if (st === 'needs_fix' && reason.length < 3) {
            return json(res, 400, { ok: false, error: 'invalid_reason' });
          }
          let rec = reason ? set_status_and_reason(id, st, reason) : set_status(id, st);
          if (!rec) {
            // Fallback: if not in memory and Supabase enabled, patch directly
            if (supabaseEnabled()) {
              const patch = Object.assign({}, { status: st }, (st==='needs_fix' && reason ? { review_note: reason } : {}));
              try {
                const r = await sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`, {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json', Prefer: 'return=representation' },
                  body: JSON.stringify(patch),
                }, 1200);
                if (!r.ok) return json(res, 404, { ok: false, error: 'not_found' });
                const arr = await r.json();
                rec = Array.isArray(arr) && arr[0] ? arr[0] : { id, status: st };
              } catch {
                return json(res, 404, { ok: false, error: 'not_found' });
              }
            } else {
              return json(res, 404, { ok: false, error: 'not_found' });
            }
          } else {
            // Outbox: 状態更新を非同期保存（メモリ→Supabase）
            const patch = { status: st };
            if (st === 'needs_fix' && reason) patch.review_note = reason;
            enqueueOutbox({ type: 'patch_change_request', id, patch });
          }
          // Audit: 状態変更
          try {
            const cookies = req.headers.cookie || '';
            const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
            const secret = process.env.APP_SECRET || 'dev_secret';
            const sidSigned = parsed.sid;
            const sid = sidSigned ? verify_value(sidSigned, secret) : null;
            const session = sid ? get_session(sid) : null;
            const email = session?.user?.email || null;
            record_audit({ entity: 'change_request', entity_id: id, action: `status:${st}`, actor_email: email || null, meta: reason ? { reason } : {} });
          } catch {}
          // Notify owner (console/webhook) and persist notification to Supabase if configured
          try {
            const rec2 = get_change_request(id) || { id, status: st };
            const note = buildChangeRequestNotification({ action: st, request: rec2, reason });
            const targetEmail = rec2?.created_by_email || null;
            await notify({ type: 'change_request', action: st, target: targetEmail, subject: note.subject, body: note.body });
            if (supabaseEnabled()) {
              enqueueOutbox({ type: 'insert_notification', data: {
                channel: 'change_request', target: targetEmail, subject: note.subject, body: note.body, status: 'queued'
              }});
            }
          } catch {}
          return json(res, 200, { ok: true });
        } catch { return json(res, 400, { ok: false, error: 'bad_request' }); }
      }
      if (method === 'POST' && pathname === '/api/compliance-check') {
        try {
          const body = await read_json();
          const changes = body?.changes || {};
          const results = check_changes(changes);
          return json(res, 200, { ok: true, results });
        } catch { return json(res, 400, { ok: false, error: 'bad_request' }); }
      }
      if (method === 'POST' && pathname.startsWith('/api/change-requests/') && pathname.endsWith('/checks')) {
        try {
          const id = pathname.split('/')[3];
          const body = await read_json();
          let rec = set_checks(id, body || {});
          if (!rec) {
            if (supabaseEnabled()) {
              try {
                const r = await sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`, {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json', Prefer: 'return=minimal' },
                  body: JSON.stringify({ checks: body || {} }),
                }, 1200);
                if (!r.ok) return json(res, 404, { ok: false, error: 'not_found' });
              } catch { return json(res, 404, { ok: false, error: 'not_found' }); }
            } else {
              return json(res, 404, { ok: false, error: 'not_found' });
            }
          } else {
            // Outbox: チェック保存を非同期保存
            enqueueOutbox({ type: 'patch_change_request', id, patch: { checks: body || {} } });
          }
          // Audit: チェック保存
          try {
            const cookies = req.headers.cookie || '';
            const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
            const secret = process.env.APP_SECRET || 'dev_secret';
            const sidSigned = parsed.sid;
            const sid = sidSigned ? verify_value(sidSigned, secret) : null;
            const session = sid ? get_session(sid) : null;
            const email = session?.user?.email || null;
            record_audit({ entity: 'change_request', entity_id: id, action: 'checks_saved', actor_email: email || null, meta: {} });
          } catch {}
          return json(res, 200, { ok: true });
        } catch { return json(res, 400, { ok: false, error: 'bad_request' }); }
      }

      if (method === 'GET' && pathname.startsWith('/api/change-requests/') && pathname.endsWith('/compliance')) {
        const id = pathname.split('/')[3];
        let changes = null;
        const rec = get_change_request(id || '');
        if (rec) {
          changes = rec?.payload?.changes || {};
        } else if (supabaseEnabled()) {
          try {
            const r = await sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`, { method: 'GET' }, 600);
            if (r.ok) {
              const arr = await r.json();
              const item = Array.isArray(arr) && arr[0] ? arr[0] : null;
              if (item) changes = item?.changes || {};
            }
          } catch {}
        }
        if (!changes) return json(res, 404, { ok: false, error: 'not_found' });
        const results = check_changes(changes);
        return json(res, 200, { ok: true, results });
      }

      if (method === 'GET' && pathname === '/jobs') {
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Jobs</title></head><body>${header_nav()}<h1>Jobs UI (placeholder)</h1></body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      // API: audit logs (simple viewer)
      if (method === 'GET' && pathname === '/api/audits') {
        const e = (query?.entity || '').toString();
        const eid = (query?.id || '').toString();
        // Prefer Supabase when available and filters provided
        if (supabaseEnabled() && e && eid) {
          try {
            const qs = `entity=eq.${encodeURIComponent(e)}&entity_id=eq.${encodeURIComponent(eid)}&order=created_at.desc&limit=50`;
            const r = await sbFetch(`/rest/v1/audit_logs?${qs}`, { method: 'GET' }, 800);
            if (r.ok) {
              const items = await r.json();
              return json(res, 200, { ok: true, items });
            }
          } catch {}
        }
        // Fallback to in-memory filtered view
        const items = AUDIT.filter(x => (!e || x.entity===e) && (!eid || x.entity_id===eid)).slice(-50).reverse();
        return json(res, 200, { ok: true, items });
      }

      if (method === 'GET' && pathname === '/login') {
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Sign In</title>
          <style>body{font-family:system-ui;padding:24px} a.button{display:inline-block;padding:8px 12px;border:1px solid #333;border-radius:6px;text-decoration:none}</style>
        </head><body>
          ${header_nav()}
          <h1>サインインが必要です</h1>
          <p>オーナーポータルを利用するには、Googleアカウントでログインしてください。</p>
          <p><a class="button" href="/api/gbp/oauth?provider=google">Googleでログイン</a></p>
          <p style="color:#555">開発中: ログイン後は自分が担当するロケーションのみ表示されます。</p>
        </body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      if (method === 'GET' && pathname === '/locations') {
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Locations</title>
          <style>body{font-family:system-ui;padding:20px;} ul{padding-left:0;} li{margin:6px 0; list-style:none;} a{color:#06c;}</style>
        </head><body>
        ${header_nav()}
        <h1>ロケーション一覧（stub）</h1>
        <p style="color:#555">対象: 閲覧者/オーナー/オペレーター。できること: ロケーションの閲覧、詳細へ遷移。</p>
        <div style="background:#f9f9f9;border:1px solid #eee;padding:8px;border-radius:6px;margin:8px 0">
          <b>使い方</b>：対象ロケーションをクリックして詳細を確認し、変更が必要なら詳細ページからオーナーポータルへ進みます。
        </div>
        <ul id="list"></ul>
        <script>
          fetch('/api/locations').then(r=>r.json()).then(j=>{
            const ul = document.getElementById('list');
            (j.items||[]).forEach(it=>{
              const li=document.createElement('li');
              li.innerHTML = '<a href="/locations/'+it.id+'">'+it.name+'</a> - '+(it.phone||'')+' - '+(it.address||'');
              ul.appendChild(li);
            });
          });
        </script>
        </body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      if (method === 'GET' && pathname.startsWith('/locations/')) {
        const id = pathname.split('/').pop();
        const loc = get_location(id || '');
        if (!loc) return html(res, 404, '<!doctype html><html><body><h1>Not Found</h1></body></html>');
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>${loc.name}</title>
          <style>body{font-family:system-ui;padding:20px;} dt{font-weight:bold;margin-top:8px}</style>
        </head><body>
        ${header_nav()}<p><a href="/locations">← 一覧へ</a></p>
        <h1>${loc.name}</h1>
        <p style="color:#555">対象: 閲覧者/オーナー/オペレーター。できること: 基本情報の確認、オーナー編集画面へ。</p>
        <div style="background:#f9f9f9;border:1px solid #eee;padding:8px;border-radius:6px;margin:8px 0">
          <b>使い方</b>：内容に変更が必要な場合、下部のリンクからオーナーポータルで変更依頼を作成します。
        </div>
        <dl>
          <dt>電話</dt><dd>${loc.phone||''}</dd>
          <dt>住所</dt><dd>${loc.address||''}</dd>
          <dt>営業時間</dt><dd>${loc.hours||''}</dd>
          <dt>URL</dt><dd><a href="${loc.url||'#'}" target="_blank" rel="noreferrer">${loc.url||''}</a></dd>
        </dl>
        <p style="margin-top:16px"><a href="/owner/${loc.id}">変更依頼を出す（オーナーポータル）</a></p>
        </body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      if (method === 'GET' && pathname === '/owner') {
        // 選択画面（複数ロケーションを持つオーナー向け）
        // 認可: 未サインインならログインページへ
        let session = null;
        try {
          const cookies = req.headers.cookie || '';
          const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
          const secret = process.env.APP_SECRET || 'dev_secret';
          const sidSigned = parsed.sid;
          if (sidSigned) {
            const sid = verify_value(sidSigned, secret);
            if (sid) session = get_session(sid);
          }
        } catch {}
        const email = session?.user?.email || null;
        if (!email) { res.statusCode = 302; res.setHeader('location', '/login'); return res.end(); }
        const allowed = email ? new Set(get_owned_location_ids(email)) : new Set();
        const source = get_locations();
        const items = source.filter(it => allowed.has(it.id));
        const li = items.map(it=>('<li><a href="/owner/'+it.id+'">'+it.name+'</a> - '+(it.address||'')+'</li>')).join('');
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Owner Portal - Select</title>
          <style>body{font-family:system-ui;padding:20px;} li{margin:6px 0}</style>
        </head><body>
          ${header_nav()}
          <h1>オーナーポータル：ロケーション選択</h1>
          <p style="color:#555">対象: オーナー。できること: 編集対象のロケーションを選択。</p>
          <div style="background:#f9f9f9;border:1px solid #eee;padding:8px;border-radius:6px;margin:8px 0">
            <b>使い方</b>：変更したいロケーションを選び、次の画面で編集内容を入力して送信します。
          </div>
          <p>編集したいロケーションを選択してください。</p>
          <ul>${li}</ul>
        </body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      if (method === 'GET' && pathname.startsWith('/owner/')) {
        const id = pathname.split('/').pop();
        // 認可: セッションの所属ロケーションのみ許可
        try {
          const cookies = req.headers.cookie || '';
          const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
          const secret = process.env.APP_SECRET || 'dev_secret';
          const sidSigned = parsed.sid;
          let email = null;
          if (sidSigned) {
            const sid = verify_value(sidSigned, secret);
            const session = sid ? get_session(sid) : null;
            email = session?.user?.email || null;
          }
          if (!email && DEV_ENABLED && (parsed.role||'') === 'owner') {
            email = process.env.DEV_OWNER_EMAIL || 'owner1@example.com';
          }
          if (email) {
            const allowed = new Set(get_owned_location_ids(email));
            if (!allowed.has(id || '')) {
              return html(res, 403, '<!doctype html><html><body><h1>Forbidden</h1><p>このロケーションを編集する権限がありません。</p></body></html>');
            }
          } else {
            res.statusCode = 302; res.setHeader('location', '/login'); return res.end();
          }
        } catch {}
        const loc = get_location(id || '');
        if (!loc) return html(res, 404, '<!doctype html><html><body><h1>Not Found</h1></body></html>');
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Owner Portal (stub)</title>
          <style>
            body{font-family:system-ui;padding:20px;}
            .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
            label{display:block;margin-top:8px}
            input,textarea{width:100%;padding:6px}
            .card{border:1px solid #ddd;border-radius:8px;padding:12px}
            .ok{color:#090}
            .err{color:#900}
            table{width:100%;border-collapse:collapse}
            th,td{border:1px solid #ddd;padding:6px;text-align:left}
            a{color:#06c}
          </style>
        </head><body>
          ${header_nav()}
          <p><a href="/owner">← ロケーション選択へ</a></p>
          <h1>オーナーポータル（最小） - ${loc.name}</h1>
          <p style="color:#555">対象: オーナー。できること: 基本項目の変更依頼を提出（保存は開発用の一時保存）。</p>
          <div class="card" style="margin:10px 0; background:#fafcff">
            <b>使い方</b>
            <ol style="margin:6px 0 0 18px; padding:0">
              <li>変更したい項目を入力（説明は自動チェック対象）</li>
              <li>自動チェックの警告を確認し、必要に応じて文面を修正</li>
              <li>「オーナーによる内容確認（必須）」にチェックを入れる</li>
              <li>送信すると下の一覧に追加され、レビュー画面で確認できます</li>
            </ol>
          </div>
          <div class="grid">
            <div class="card">
              <h2>ステータス/KPI（stub）</h2>
              <div id="status">loading...</div>
              <ul id="kpi"><li>Profile completeness: stub</li><li>Token: see Dashboard</li></ul>
            </div>
            <div class="card">
          <h2>変更依頼フォーム（限定項目）</h2>
          <form id="req">
            <input type="hidden" name="location_id" value="${loc.id}" />
            <label>電話<input name="phone" value="${loc.phone||''}" /></label>
            <label>営業時間<input name="hours" value="${loc.hours||''}" /></label>
            <label>URL<input name="url" value="${loc.url||''}" /></label>
            <label>説明<textarea name="description" rows="3" id="desc"></textarea></label>
            <div id="warn" style="color:#900"></div>
            <label>写真URL<input name="photo_url" /></label>
            <label><input type="checkbox" id="owner_signoff" name="owner_signoff" value="1"> オーナーによる内容確認（必須）</label>
            <div id="form_err" class="err"></div>
            <button id="submit_btn" type="submit" disabled>送信</button>
            <span id="msg"></span>
          </form>
            </div>
          </div>
          <div class="card" style="margin-top:16px">
            <div id="last_reason" style="margin:8px 0;color:#900"></div>
            <h2>依頼一覧（最新順, stub保存）</h2>
            <table>
              <thead><tr><th>ID</th><th>Location</th><th>Status</th><th>Reason</th><th>Created</th></tr></thead>
              <tbody id="reqs"></tbody>
            </table>
          </div>
          <script>
            function fmt(ts){ try{ const d=new Date(ts); if(!isNaN(d)) return d.toLocaleString(); }catch{} return ts||''; }
            async function loadStatus(){
              try{ const j = await (await fetch('/api/dashboard')).json();
                const el = document.getElementById('status');
                const authed = j?.session?.authenticated; const email = j?.session?.email;
                el.innerHTML = 'OAuth: '+(j?.config?.google_configured?'configured':'not configured') + (authed? ' | signed in as <b>'+email+'</b>':'' );
                el.className = authed? 'ok':'err';
              }catch{ document.getElementById('status').textContent='status error'; }
            }
            async function loadRequests(){
              const tb = document.getElementById('reqs'); tb.innerHTML='';
              try{
                const r = await fetch('/api/change-requests?location_id=${loc.id}');
                const j = await r.json();
                const arr = j.items||[];
                if(!arr.length){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="5" style="color:#555">依頼はまだありません</td>'; tb.appendChild(tr); document.getElementById('last_reason').textContent=''; return; }
                // 最新のneeds_fix理由（あれば）
                try{
                  const nfArr = arr.filter(x=>x.status==='needs_fix' && (x.review_note||'').trim().length>0);
                  nfArr.sort(function(a,b){
                    const da = Date.parse(a.created_at||'');
                    const db = Date.parse(b.created_at||'');
                    return (db||0) - (da||0);
                  });
                  const nf = nfArr[0] || null;
                  const el = document.getElementById('last_reason');
                  if (nf) {
                    const key = 'pjt014:last_seen_reason:' + ${JSON.stringify(loc.id)};
                    const lastSeen = localStorage.getItem(key) || '';
                    const created = nf.created_at || '';
                    const isNew = created && created !== lastSeen;
                    function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]); }); }
                    el.innerHTML = (isNew? '<b style="background:#ff0;color:#900;padding:0 6px;margin-right:6px">新着</b>' : '') + '最新の差戻し理由: ' + esc(nf.review_note||'') + ' <span class="muted">(' + fmt(created) + ')</span>' + (isNew? ' <button id="mark_seen" style="margin-left:6px">既読にする</button>' : '');
                    const btn = document.getElementById('mark_seen'); if(btn) btn.onclick = ()=>{ localStorage.setItem(key, created||''); el.innerHTML = '最新の差戻し理由: ' + (nf.review_note||'') + ' <span class="muted">(' + fmt(created) + ')</span>'; };
                  } else {
                    el.textContent = '';
                  }
                }catch{ document.getElementById('last_reason').textContent=''; }
                arr.forEach(r=>{ const tr=document.createElement('tr');
                  const reason = (r.review_note||'');
                  const st = (r.status||'');
                  const reasonCell = reason ? ('<span style="color:#900">'+reason.replace(/</g,'&lt;')+'</span>') : '';
                  tr.innerHTML = '<td>'+r.id+'</td><td>'+(r.payload?.location_id||r.location_id||'')+'</td><td>'+st+'</td><td>'+reasonCell+'</td><td>'+fmt(r.created_at||'')+'</td>';
                  tb.appendChild(tr);
                });
              }catch{ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="5" style="color:#900">一覧の取得に失敗しました</td>'; tb.appendChild(tr); }
            }
            async function liveCheck(){
              const desc = document.getElementById('desc').value||'';
              try{
                const r = await fetch('/api/compliance-check', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ changes: { description: desc } })});
                const j = await r.json();
                const el = document.getElementById('warn');
                const hits = (j.results && j.results.description) ? j.results.description : [];
                el.innerHTML = hits.length? ('自動チェック: '+hits.map(h=>h.label+':\"'+h.match+'\"').join(', ')) : '';
              }catch{ /* noop */ }
            }
            function updateSubmit(){
              const checked = document.getElementById('owner_signoff').checked;
              document.getElementById('submit_btn').disabled = !checked;
            }
            document.getElementById('owner_signoff').addEventListener('change', updateSubmit);
            document.getElementById('req').onsubmit = async (e)=>{
              e.preventDefault(); const f = new FormData(e.target); const obj = Object.fromEntries(f.entries());
              const errEl = document.getElementById('form_err'); const m = document.getElementById('msg');
              m.textContent=''; errEl.textContent='';
              if (!document.getElementById('owner_signoff').checked){ errEl.textContent='オーナー確認への同意が必要です'; return; }
              obj.owner_signoff = true;
              try{
                const r = await fetch('/api/change-requests', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(obj)});
                const j = await r.json();
                if(j.ok){ m.textContent='送信しました: '+j.id; (e.target).reset(); updateSubmit(); loadRequests(); } else { errEl.textContent='送信失敗: '+(j.error||''); }
              }catch{ errEl.textContent='送信エラー'; }
            };
            loadStatus(); loadRequests(); updateSubmit();
            document.getElementById('desc').addEventListener('input', liveCheck);
            liveCheck();
          </script>
        </body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      if (method === 'GET' && pathname === '/review') {
        // Access control (dev): only reviewer role can view review pages
        try {
          const cookies = req.headers.cookie || '';
          const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
          const role = (parsed.role || '').toString();
          if (DEV_ENABLED && role !== 'reviewer') {
            res.statusCode = 302; res.setHeader('location', '/login'); return res.end();
          }
        } catch {}
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Review Queue</title>
          <style>body{font-family:system-ui;padding:20px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px} select{margin-left:8px} .muted{color:#666}</style>
        </head><body>
          ${header_nav()}
          <h1>承認キュー</h1>
          <p style="color:#555">対象: オペレーター/承認者。できること: 依頼のレビュー/承認/差戻し。</p>
          <div style="background:#f9f9f9;border:1px solid #eee;padding:8px;border-radius:6px;margin:8px 0">
            <b>使い方</b>：一覧からIDをクリックして詳細へ。詳細画面で自動チェックとチェックリストを確認し、承認/差戻しを行います。
          </div>
          <div style="margin:8px 0">
            表示フィルタ: 
            <select id="filter">
              <option value="">すべて</option>
              <option value="submitted">submitted</option>
              <option value="in_review">in_review</option>
              <option value="needs_fix">needs_fix</option>
              <option value="approved">approved</option>
              <option value="syncing">syncing</option>
              <option value="synced">synced</option>
              <option value="failed">failed</option>
            </select>
          </div>
          <table><thead><tr><th>ID</th><th>Loc</th><th>Status</th><th>Created</th></tr></thead><tbody id="rows"><tr><td colspan="4" style="color:#555">loading...</td></tr></tbody></table>
          <script>
            function fmt(ts){ try{ const d=new Date(ts); if(!isNaN(d)) return d.toLocaleString(); }catch{} return ts||''; }
            function getQueryParam(name){ const u=new URL(location.href); return u.searchParams.get(name)||''; }
            function setQueryParam(name,val){ const u=new URL(location.href); if(val) u.searchParams.set(name,val); else u.searchParams.delete(name); history.replaceState(null,'',u.toString()); }
            async function load(){
              const tb = document.getElementById('rows'); tb.innerHTML='';
              const st = getQueryParam('status');
              const sel = document.getElementById('filter');
              if (st) sel.value = st;
              sel.onchange = ()=>{ setQueryParam('status', sel.value||''); load(); };
              try{
                const j = await (await fetch('/api/change-requests'+(st?('?status='+encodeURIComponent(st)):'') )).json();
                const arr = j.items||[];
                if(!arr.length){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="4" class="muted">該当する依頼はありません</td>'; tb.appendChild(tr); return; }
                arr.forEach(r=>{
                  const tr = document.createElement('tr');
                  const id = r.id; const loc = (r.location_id||r.payload?.location_id||'');
                  const st = (r.status||''); const created = fmt(r.created_at||'');
                  tr.innerHTML = '<td><a href="/review/'+id+'">'+id+'</a></td><td>'+loc+'</td><td>'+st+'</td><td>'+created+'</td>';
                  tb.appendChild(tr);
                });
              }catch{ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="4" style="color:#900">一覧の取得に失敗しました</td>'; tb.appendChild(tr); }
            }
            load();
          </script>
        </body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      if (method === 'GET' && pathname.startsWith('/review/')) {
        // Access control (dev): only reviewer role can view
        try {
          const cookies = req.headers.cookie || '';
          const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
          const role = (parsed.role || '').toString();
          if (DEV_ENABLED && role !== 'reviewer') {
            res.statusCode = 302; res.setHeader('location', '/login'); return res.end();
          }
        } catch {}
        const id = pathname.split('/').pop();
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Review ${id}</title>
          <style>body{font-family:system-ui;padding:20px} label{display:block;margin:6px 0}</style>
        </head><body>
          ${header_nav()}
          <p><a href="/review">← 承認キュー</a></p>
          <h1>レビュー（stub） - <span id="loc"></span></h1>
          <div id="cur_status" style="margin:6px 0;color:#555">Status: loading...</div>
          <p style="color:#555">対象: レビュアー/承認者。できること: 自動チェックの確認、チェックリスト保存、状態更新（承認/差戻し）。</p>
          <div style="background:#f9f9f9;border:1px solid #eee;padding:8px;border-radius:6px;margin:8px 0">
            <b>使い方</b>
            <ol style="margin:6px 0 0 18px; padding:0">
              <li>上部の変更内容（JSON）を確認</li>
              <li>「コンプライアンス（自動チェック）」の警告を確認</li>
              <li>「チェックリスト」に沿って目視確認し、必要項目にチェック → 保存</li>
              <li>承認（approved）または差戻し（needs_fix）を選択して状態更新</li>
            </ol>
            <div style="margin-top:6px;color:#555">補足：オーナー確認の有無も表示されます。</div>
          </div>
          <pre id="payload" style="background:#f7f7f7;padding:8px;border:1px solid #eee">loading...</pre>
          <div id="err" style="color:#900"></div>
          <h2>コンプライアンス（自動チェック・簡易）</h2>
          <div id="auto">loading...</div>
          <h2>チェックリスト</h2>
          <form id="checks">
            <label><input type="checkbox" name="no_overclaim"> 過大表現なし</label>
            <label><input type="checkbox" name="has_risk_note"> リスク/副作用の記載</label>
            <label><input type="checkbox" name="pricing_clear"> 料金の明確性</label>
            <label><input type="checkbox" name="privacy_safe"> 個人情報に配慮</label>
            <button type="submit">チェック保存</button>
          </form>
          <p id="msg"></p>
          <p id="owner"></p>
          <div class="card" style="border:1px solid #eee;padding:8px;border-radius:6px;margin:8px 0">
            <h3>差戻し理由（needs_fix時に必須）</h3>
            <textarea id="reason" rows="3" style="width:100%" placeholder="例: 診療内容の表現に修正が必要です。具体的に…"></textarea>
          </div>
          <h2>監査ログ</h2>
          <div id="audit" style="border:1px solid #eee;padding:8px;border-radius:6px;color:#555">loading...</div>
          <p>
            <button id="start_review">レビュー開始（in_review）</button>
            <button id="approve">承認（approved）</button>
            <button id="needs_fix">差戻し（needs_fix）</button>
          </p>
          <script>
            async function loadItem(){
              try{
                const res = await fetch('/api/change-requests/${id}');
                let j=null; let parseErr=null; try{ j=await res.json(); }catch(e){ parseErr=e; }
                if(!res.ok || !j || j.ok===false){
                  document.getElementById('payload').textContent = 'not found';
                  document.getElementById('cur_status').textContent = 'Status: not_found';
                  document.getElementById('err').textContent = '取得に失敗しました (HTTP '+res.status+(parseErr?' parse error':'')+')';
                  return;
                }
                const item = j.item;
                document.getElementById('loc').textContent = item.location_id || '';
                document.getElementById('payload').textContent = JSON.stringify(item.changes||{}, null, 2);
                document.getElementById('cur_status').textContent = 'Status: ' + (item.status||'');
                // Auto-transition: move submitted -> in_review on open
                try{
                  if ((item.status||'') === 'submitted') {
                    await setStatus('in_review');
                    document.getElementById('cur_status').textContent = 'Status: in_review';
                  }
                }catch{}
                // prefill checks
                try{
                  const ch = item.checks||{}; const f = document.getElementById('checks');
                  for(const k of Object.keys(ch)){
                    const el = f.querySelector('input[name="'+k+'"]'); if(el) el.checked = Boolean(ch[k]);
                  }
                }catch{}
                // show owner signoff
                document.getElementById('owner').textContent = 'オーナー確認: ' + (item.owner_signoff ? '済' : '未');
                // toggle start review button
                try{
                  const btn = document.getElementById('start_review');
                  const st = (item.status||'');
                  const hide = (st==='in_review' || st==='approved' || st==='needs_fix' || st==='synced');
                  btn.style.display = hide ? 'none' : 'inline-block';
                }catch{}
              }catch{ document.getElementById('payload').textContent='取得に失敗しました'; }
            }
            async function loadAuto(){
              try{
                const j = await (await fetch('/api/change-requests/${id}/compliance')).json();
                const el = document.getElementById('auto');
                if(!j.ok){ el.textContent='自動チェックの取得に失敗しました'; return; }
                const res = j.results||{};
                const rows = [];
                if(res.description && res.description.length){
                  rows.push('<b>説明</b>: '+res.description.map(h=>h.label+':"'+h.match+'"').join(', '));
                }
                el.innerHTML = rows.length? rows.map(r=>'<div style="color:#900">'+r+'</div>').join('') : '<div style="color:#090">自動チェック: 問題なし</div>';
              }catch{ document.getElementById('auto').textContent='自動チェックエラー'; }
            }
            async function loadAudit(){
              try{
                const j = await (await fetch('/api/audits?entity=change_request&id=${id}')).json();
                const el = document.getElementById('audit');
                if(!j.ok){ el.textContent='取得に失敗しました'; return; }
                const arr = j.items||[];
                if(!arr.length){ el.textContent='記録なし'; return; }
                function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]); }); }
                el.innerHTML = '<ul style="margin:0;padding-left:18px">'+arr.map(function(a){ return '<li><code>'+esc(a.created_at||'')+'</code> '+esc(a.action||'')+' by '+esc(a.actor_email||'-')+'</li>'; }).join('')+'</ul>';
              }catch{ document.getElementById('audit').textContent='監査取得エラー'; }
            }
            document.getElementById('checks').onsubmit = async (e)=>{
              e.preventDefault(); const f=new FormData(e.target); const obj={}; for(const [k,v] of f.entries()){ obj[k]=true; }
              try{
                const r = await fetch('/api/change-requests/${id}/checks', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(obj)});
                const j = await r.json();
                document.getElementById('msg').textContent = j.ok? '保存しました' : '保存に失敗しました';
              }catch{ document.getElementById('msg').textContent='保存エラー'; }
            };
            async function setStatus(st){
              try{
                const payload = { status: st };
                if (st === 'needs_fix') {
                  const reason = (document.getElementById('reason').value || '').trim();
                  if (!reason || reason.length < 3) { document.getElementById('msg').textContent='差戻し理由を入力してください'; return; }
                  payload.reason = reason;
                }
                const r = await fetch('/api/change-requests/${id}/status', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload)});
                let j=null; let parseErr=null; try{ j=await r.json(); }catch(e){ parseErr=e; }
                if (r.ok && j && j.ok) {
                  document.getElementById('msg').textContent = '状態を '+st+' に更新しました';
                  document.getElementById('cur_status').textContent = 'Status: '+st;
                } else {
                  document.getElementById('msg').textContent = '更新に失敗しました (HTTP '+r.status+(parseErr?' parse error':'')+')';
                }
              }catch{ document.getElementById('msg').textContent='更新エラー'; }
            }
            document.getElementById('approve').onclick = ()=> setStatus('approved');
            document.getElementById('needs_fix').onclick = ()=> setStatus('needs_fix');
            document.getElementById('start_review').onclick = ()=> setStatus('in_review');
            loadItem(); loadAuto(); loadAudit();
          </script>
        </body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      json(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      console.error(err);
      json(res, 500, { ok: false, error: 'internal_error' });
    }
  });

  return server;
}

// NodeのESMにはCJSのrequire.mainがないため、実行ファイル判定を自前で行う
const is_main = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);

if (is_main) {
  // .env 自動読込（既存の環境変数は上書きしない）
  const loaded = load_env_from_file('.env');
  if (loaded) {
    console.log('[env] .env loaded');
  }
  const server = create_server();
  server.on('error', (err) => {
    console.error('[server] listen error:', err && err.message ? err.message : err);
    console.error('[server] hint: try another PORT or set HOST=127.0.0.1');
    process.exitCode = 1;
  });
  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    const host = DEFAULT_HOST === '0.0.0.0' ? 'localhost' : DEFAULT_HOST;
    console.log(`[server] listening on http://${host}:${DEFAULT_PORT}`);
  });
}
      if (method === 'GET' && pathname === '/api/health') {
        try {
          const outboxLen = (globalThis.__pjt014_outbox || []).length;
          const storeCount = (()=>{ try { return list_change_requests().length; } catch { return null; } })();
          return json(res, 200, {
            ok: true,
            runtime: {
              supabase_configured: supabaseEnabled(),
              outbox_len: outboxLen,
              store_count: storeCount,
            }
          });
        } catch {
          return json(res, 500, { ok: false });
        }
      }

import http from 'node:http';
import fs from 'node:fs';
import { parse, fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  handle_oauth_status,
  handle_oauth_start,
  handle_oauth_callback,
  handle_oauth_logout,
  handle_oauth_refresh,
} from '../auth/oauth_routes.js';
import { parse as parseUrl } from 'node:url';
import { parse_cookies, verify_value } from './cookies.js';
import { get_session } from './session_store.js';
import { load_env_from_file } from './env.js';
import { get_locations, get_location } from './locations_stub.js';
import { create_change_request, list_change_requests, set_status, get_change_request, set_checks } from './change_requests_store.js';
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
    return `\n<script>\n(()=>{ try{ const es = new EventSource('/__dev/reload'); es.onmessage = (e)=>{ if(e.data==='reload'){ location.reload(); } }; }catch(e){} })();\n</script>\n`;
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

  // Simple top navigation to clarify who each screen is for
  function header_nav() {
    return `
      <nav style="margin:8px 0 16px; padding-bottom:8px; border-bottom:1px solid #ddd">
        <a href="/">Home</a> |
        <a href="/locations">Locations</a> |
        <a href="/owner">Owner Portal</a> |
        <a href="/review">Review Queue</a>
      </nav>
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
    const { pathname, query } = parse(req.url || '/', true);
    const method = (req.method || 'GET').toUpperCase();

    // CORS (シンプルに許可)
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    try {
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

      start_dev_watcher_once();
      async function read_json() {
        return await new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            try {
              const raw = Buffer.concat(chunks).toString('utf8') || '{}';
              resolve(JSON.parse(raw));
            } catch (e) {
              reject(e);
            }
          });
          req.on('error', reject);
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
        <li><a href="/owner">Owner Portal</a>: 対象=オーナー。自分のロケーションを選び、変更依頼を提出。</li>
        <li><a href="/review">Review Queue</a>: 対象=オペレーター/承認者。依頼のチェック/承認/差戻し。</li>
        <li><a href="/locations">Locations</a>: 対象=全ユーザー（閲覧）。ロケーション一覧/詳細の確認。</li>
      </ul>
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
            const r = await sbFetch(`/rest/v1/oauth_tokens_secure?${qs}`, { method: 'GET' }, 1200);
            if (r && r.ok) {
              const arr = await r.json();
              if (arr && arr.length) {
                persistence.last_saved_at = arr[0].created_at || null;
                persistence.last_expires_at = arr[0].expires_at || null;
              }
            }
          }
        } catch {}
        return json(res, 200, {
          ok: true,
          config: { google_configured: googleConfigured },
          session: { authenticated, email, token_seconds_left: left },
          persistence,
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
        const t = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));
        try {
          return await fetch(base + pathname, Object.assign({}, init, { headers, signal: controller.signal }));
        } finally {
          clearTimeout(t);
        }
      }
      if (method === 'GET' && pathname === '/api/change-requests') {
        const locId = query?.location_id || null;
        if (supabaseEnabled()) {
          try {
            const params = new URLSearchParams();
            if (locId) params.set('location_id', `eq.${encodeURIComponent(locId)}`);
            const qs = params.toString();
            const r = await sbFetch('/rest/v1/owner_change_requests' + (qs ? `?${qs}` : ''));
            const arr = r.ok ? await r.json() : [];
            return json(res, 200, { ok: true, items: arr });
          } catch {}
        }
        const all = list_change_requests();
        const items = locId ? all.filter(r => (r.payload?.location_id||null) === locId) : all;
        return json(res, 200, { ok: true, items });
      }
      if (method === 'GET' && pathname.startsWith('/api/change-requests/')) {
        const id = pathname.split('/').pop();
        if (!id) return json(res, 400, { ok: false, error: 'bad_request' });
        if (supabaseEnabled()) {
          try {
            const r = await sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`);
            if (r.ok) {
              const arr = await r.json();
              const item = Array.isArray(arr) && arr[0] ? arr[0] : null;
              if (!item) return json(res, 404, { ok: false, error: 'not_found' });
              return json(res, 200, { ok: true, item });
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
          // Optional: persist to Supabase (non-blocking)
          if (supabaseEnabled()) {
            try {
              sbFetch('/rest/v1/owner_change_requests', {
                method: 'POST',
                headers: { 'content-type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify([{ id: rec.id, location_id: rec.payload.location_id, changes: rec.payload.changes, status: rec.status, owner_signoff: Boolean(rec.payload.owner_signoff||false) }]),
              }, 1500).catch(()=>{});
            } catch {}
          }
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
          const rec = set_status(id, st);
          if (!rec) return json(res, 404, { ok: false, error: 'not_found' });
          // Optional: persist to Supabase (non-blocking)
          if (supabaseEnabled()) {
            try {
              sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ status: st }),
              }, 1500).catch(()=>{});
            } catch {}
          }
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
          const rec = set_checks(id, body || {});
          if (!rec) return json(res, 404, { ok: false, error: 'not_found' });
          // Optional: persist to Supabase (non-blocking)
          if (supabaseEnabled()) {
            try {
              sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ checks: body || {} }),
              }, 1500).catch(()=>{});
            } catch {}
          }
          return json(res, 200, { ok: true });
        } catch { return json(res, 400, { ok: false, error: 'bad_request' }); }
      }

      if (method === 'GET' && pathname.startsWith('/api/change-requests/') && pathname.endsWith('/compliance')) {
        const id = pathname.split('/')[3];
        const rec = get_change_request(id || '');
        if (!rec) return json(res, 404, { ok: false, error: 'not_found' });
        const results = check_changes(rec?.payload?.changes || {});
        return json(res, 200, { ok: true, results });
      }

      if (method === 'GET' && pathname === '/jobs') {
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Jobs</title></head><body>${header_nav()}<h1>Jobs UI (placeholder)</h1></body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      if (method === 'GET' && pathname === '/locations') {
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Locations</title>
          <style>body{font-family:system-ui;padding:20px;} ul{padding-left:0;} li{margin:6px 0; list-style:none;} a{color:#06c;}</style>
        </head><body>
        ${header_nav()}
        <h1>ロケーション一覧（stub）</h1>
        <p style="color:#555">対象: 閲覧者/オーナー/オペレーター（デモ）。できること: ロケーションの閲覧、詳細へ遷移。</p>
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
        <p style="color:#555">対象: 閲覧者/オーナー/オペレーター（デモ）。できること: 基本情報の確認、オーナー編集画面へ。</p>
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
        const items = get_locations(); // TODO: 認可後は所属ロケーションに限定
        const li = items.map(it=>`<li><a href="/owner/${it.id}">${it.name}</a> - ${it.address||''}</li>`).join('');
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Owner Portal - Select</title>
          <style>body{font-family:system-ui;padding:20px;} li{margin:6px 0}</style>
        </head><body>
          ${header_nav()}
          <h1>オーナーポータル：ロケーション選択</h1>
          <p style="color:#555">対象: オーナー。できること: 編集対象のロケーションを選択。</p>
          <p>編集したいロケーションを選択してください。</p>
          <ul>${li}</ul>
        </body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      if (method === 'GET' && pathname.startsWith('/owner/')) {
        const id = pathname.split('/').pop();
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
            <h2>依頼一覧（最新順, stub保存）</h2>
            <table>
              <thead><tr><th>ID</th><th>Location</th><th>Status</th><th>Created</th></tr></thead>
              <tbody id="reqs"></tbody>
            </table>
          </div>
          <script>
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
                if(!arr.length){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="4" style="color:#555">依頼はまだありません</td>'; tb.appendChild(tr); return; }
                arr.forEach(r=>{ const tr=document.createElement('tr');
                  tr.innerHTML = '<td>'+r.id+'</td><td>'+(r.payload?.location_id||r.location_id||'')+'</td><td>'+(r.status||'')+'</td><td>'+(r.created_at||'')+'</td>';
                  tb.appendChild(tr);
                });
              }catch{ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="4" style="color:#900">一覧の取得に失敗しました</td>'; tb.appendChild(tr); }
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
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Review Queue</title>
          <style>body{font-family:system-ui;padding:20px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px}</style>
        </head><body>
          ${header_nav()}
          <h1>承認キュー</h1>
          <p style="color:#555">対象: オペレーター/承認者。できること: 依頼のレビュー/承認/差戻し。</p>
          <table><thead><tr><th>ID</th><th>Loc</th><th>Status</th><th>Created</th></tr></thead><tbody id="rows"><tr><td colspan="4" style="color:#555">loading...</td></tr></tbody></table>
          <script>
            async function load(){
              const tb = document.getElementById('rows'); tb.innerHTML='';
              try{
                const j = await (await fetch('/api/change-requests')).json();
                const arr = j.items||[];
                if(!arr.length){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="4" style="color:#555">0件</td>'; tb.appendChild(tr); return; }
                arr.forEach(r=>{
                  const tr = document.createElement('tr');
                  const id = r.id; const loc = (r.location_id||r.payload?.location_id||'');
                  const st = (r.status||''); const created = (r.created_at||'');
                  tr.innerHTML = '<td><a href="/review/'+id+'">'+id+'</a></td><td>'+loc+'</td><td>'+st+'</td><td>'+created+'</td>';
                  tb.appendChild(tr);
                });
              }catch{ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="4" style="color:#900">取得に失敗しました</td>'; tb.appendChild(tr); }
            }
            load();
          </script>
        </body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      if (method === 'GET' && pathname.startsWith('/review/')) {
        const id = pathname.split('/').pop();
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Review ${id}</title>
          <style>body{font-family:system-ui;padding:20px} label{display:block;margin:6px 0}</style>
        </head><body>
          ${header_nav()}
          <p><a href="/review">← 承認キュー</a></p>
          <h1>レビュー（stub） - <span id="loc"></span></h1>
          <p style="color:#555">対象: レビュアー/承認者。できること: チェックリスト保存、状態更新（承認/差戻し）。</p>
          <pre id="payload" style="background:#f7f7f7;padding:8px;border:1px solid #eee">loading...</pre>
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
          <p>
            <button id="approve">承認（approved）</button>
            <button id="needs_fix">差戻し（needs_fix）</button>
          </p>
          <script>
            async function loadItem(){
              try{
                const j = await (await fetch('/api/change-requests/${id}')).json();
                if(!j.ok){ document.getElementById('payload').textContent = 'not found'; return; }
                const item = j.item;
                document.getElementById('loc').textContent = item.location_id || '';
                document.getElementById('payload').textContent = JSON.stringify(item.changes||{}, null, 2);
                // prefill checks
                try{
                  const ch = item.checks||{}; const f = document.getElementById('checks');
                  for(const k of Object.keys(ch)){
                    const el = f.querySelector('input[name="'+k+'"]'); if(el) el.checked = Boolean(ch[k]);
                  }
                }catch{}
                // show owner signoff
                document.getElementById('owner').textContent = 'オーナー確認: ' + (item.owner_signoff ? '済' : '未');
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
                const r = await fetch('/api/change-requests/${id}/status', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ status: st })});
                const j = await r.json();
                document.getElementById('msg').textContent = j.ok? ('状態を '+st+' に更新しました') : '更新に失敗しました';
              }catch{ document.getElementById('msg').textContent='更新エラー'; }
            }
            document.getElementById('approve').onclick = ()=> setStatus('approved');
            document.getElementById('needs_fix').onclick = ()=> setStatus('needs_fix');
            loadItem(); loadAuto();
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

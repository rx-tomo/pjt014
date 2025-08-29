import http from 'node:http';
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
import { create_change_request, list_change_requests } from './change_requests_store.js';

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
    <h1>pjt014 Dev Dashboard</h1>
    <p>ローカル環境の確認用ダッシュボードです。</p>
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
        return html(res, 200, page);
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
          const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
          const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (base && key && email) {
            const url = `${base}/rest/v1/oauth_tokens_secure?email=eq.${encodeURIComponent(email)}&select=created_at,expires_at&order=created_at.desc&limit=1`;
            const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
            if (r.ok) {
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

      // API: change requests (in-memory)
      if (method === 'GET' && pathname === '/api/change-requests') {
        return json(res, 200, { ok: true, items: list_change_requests() });
      }
      if (method === 'POST' && pathname === '/api/change-requests') {
        try {
          const body = await read_json();
          const rec = create_change_request({
            location_id: body?.location_id || null,
            changes: {
              phone: body?.phone ?? null,
              hours: body?.hours ?? null,
              url: body?.url ?? null,
              description: body?.description ?? null,
              photo_url: body?.photo_url ?? null,
            },
          });
          return json(res, 201, { ok: true, id: rec.id });
        } catch (e) {
          return json(res, 400, { ok: false, error: 'invalid_json' });
        }
      }

      if (method === 'GET' && pathname === '/jobs') {
        return html(
          res,
          200,
          '<!doctype html><html><head><meta charset="utf-8"><title>Jobs</title></head><body><h1>Jobs UI (placeholder)</h1></body></html>'
        );
      }

      if (method === 'GET' && pathname === '/locations') {
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Locations</title>
          <style>body{font-family:system-ui;padding:20px;} ul{padding-left:0;} li{margin:6px 0; list-style:none;} a{color:#06c;}</style>
        </head><body>
        <h1>ロケーション一覧（stub）</h1>
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
        return html(res, 200, page);
      }

      if (method === 'GET' && pathname.startsWith('/locations/')) {
        const id = pathname.split('/').pop();
        const loc = get_location(id || '');
        if (!loc) return html(res, 404, '<!doctype html><html><body><h1>Not Found</h1></body></html>');
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>${loc.name}</title>
          <style>body{font-family:system-ui;padding:20px;} dt{font-weight:bold;margin-top:8px}</style>
        </head><body>
        <p><a href="/locations">← 一覧へ</a></p>
        <h1>${loc.name}</h1>
        <dl>
          <dt>電話</dt><dd>${loc.phone||''}</dd>
          <dt>住所</dt><dd>${loc.address||''}</dd>
          <dt>営業時間</dt><dd>${loc.hours||''}</dd>
          <dt>URL</dt><dd><a href="${loc.url||'#'}" target="_blank" rel="noreferrer">${loc.url||''}</a></dd>
        </dl>
        <p style="margin-top:16px"><a href="/owner/${loc.id}">変更依頼を出す（オーナーポータル）</a></p>
        </body></html>`;
        return html(res, 200, page);
      }

      if (method === 'GET' && pathname === '/owner') {
        // 選択画面（複数ロケーションを持つオーナー向け）
        const items = get_locations(); // TODO: 認可後は所属ロケーションに限定
        const li = items.map(it=>`<li><a href="/owner/${it.id}">${it.name}</a> - ${it.address||''}</li>`).join('');
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Owner Portal - Select</title>
          <style>body{font-family:system-ui;padding:20px;} li{margin:6px 0}</style>
        </head><body>
          <h1>オーナーポータル：ロケーション選択</h1>
          <p>編集したいロケーションを選択してください。</p>
          <ul>${li}</ul>
        </body></html>`;
        return html(res, 200, page);
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
          <p><a href="/owner">← ロケーション選択へ</a></p>
          <h1>オーナーポータル（最小） - ${loc.name}</h1>
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
                <label>説明<textarea name="description" rows="3"></textarea></label>
                <label>写真URL<input name="photo_url" /></label>
                <button type="submit">送信</button>
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
              const j = await (await fetch('/api/change-requests')).json();
              (j.items||[]).forEach(r=>{ const tr=document.createElement('tr');
                tr.innerHTML = '<td>'+r.id+'</td><td>'+(r.payload?.location_id||'')+'</td><td>'+r.status+'</td><td>'+r.created_at+'</td>';
                tb.appendChild(tr);
              });
            }
            document.getElementById('req').onsubmit = async (e)=>{
              e.preventDefault(); const f = new FormData(e.target); const obj = Object.fromEntries(f.entries());
              const r = await fetch('/api/change-requests', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(obj)});
              const j = await r.json(); const m = document.getElementById('msg');
              if(j.ok){ m.textContent='送信しました: '+j.id; loadRequests(); } else { m.textContent='送信失敗'; }
            };
            loadStatus(); loadRequests();
          </script>
        </body></html>`;
        return html(res, 200, page);
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

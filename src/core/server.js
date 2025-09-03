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
import { createChangeRequestWrite, patchStatusWrite, patchChecksWrite } from './persistence_writer.js';
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

  // NOTE: read_data is defined within the request handler scope below.

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

  // Branded top navigation with quick links and health bar
  function header_nav() {
    const dev = DEV_ENABLED;
    const roleSwitch = dev
      ? '<span id="__role_switch" style="float:right; color:#555">Role: '
        + '<a data-role="owner" href="/__dev/impersonate?role=owner">Owner</a> | '
        + '<a data-role="reviewer" href="/__dev/impersonate?role=reviewer">Reviewer</a> | '
        + '<a data-role="admin" href="/__dev/impersonate?role=admin">Admin</a>'
        + '<span id="__role_current"></span>'
        + '</span>'
      : '';
    const roleHighlightScript = dev
      ? '<script>(function(){try{var m=document.cookie.match(/(?:^|;)[\s]*role=([^;]+)/);var r=m?decodeURIComponent(m[1]):"";var w=document.getElementById("__role_switch");if(w){var as=w.querySelectorAll("a[data-role]");for(var i=0;i<as.length;i++){if(as[i].getAttribute("data-role")===(r||"")){as[i].style.fontWeight="700";as[i].style.color="#c30";}}var cur=document.getElementById("__role_current");if(cur){cur.textContent=r?" ("+r+")":"";cur.style.color="#c30";}}catch(e){}})();</script>'
      : '';
    const healthScript = '<script>(function(){try{var hb=document.getElementById("__health_bar");if(!hb) return;fetch("/api/health").then(function(x){return x.json()}).then(function(j){if(j&&j.ok){var rt=j.runtime||{};hb.textContent=(rt.supabase_configured?"DB:on":"DB:off")+" | Outbox:"+(rt.outbox_len||0);} else { hb.textContent="health: n/a"; }}).catch(function(){ hb.textContent="health: n/a"; });}catch(e){}})();</script>';
    const brand = '<a href="/" style="text-decoration:none;color:#122;letter-spacing:0.2px"><b>GBP Ops</b> <span style="color:#456">by pjt014</span></a>';
    const links = [
      ['/', 'Home'],
      ['/locations', 'Locations'],
      ['/owner', 'Owner'],
      ['/review', 'Review'],
      ['/jobs', 'Jobs'],
      ['/oauth/status', 'OAuth']
    ].map(function(x){return '<a href="'+x[0]+'" style="margin-right:12px;color:#06c;text-decoration:none">'+x[1]+'</a>'}).join('');
    return `
      <nav style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 16px;padding:10px 12px;border:1px solid #e6e9ee;border-radius:10px;background:linear-gradient(180deg,#fff,#f8fbff)">
        <div style="display:flex;align-items:center;gap:18px">
          <div style="font-size:15px">${brand}</div>
          <div style="font-size:14px">${links}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span id="__health_bar" style="color:#555"></span>
          ${roleSwitch}
        </div>
      </nav>${roleHighlightScript}${healthScript}
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
          let next = String(url.searchParams.get('next') || '').trim();
          // allow only same-origin paths
          if (!next || !/^\//.test(next)) next = (req.headers.referer || '/');
          res.statusCode = 302; res.setHeader('location', next); return res.end();
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

      // Robust body reader: supports JSON and URL-encoded forms
      async function read_data() {
        const tStart = Date.now();
        return await new Promise((resolve, reject) => {
          const chunks = [];
          const onError = (e) => {
            const ms = Date.now() - tStart;
            console.warn(`[http] ${method} ${pathname} read_data error after ${ms}ms: ${e && e.message ? e.message : e}`);
            reject(e || new Error('request_error'));
          };
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            const ms = Date.now() - tStart;
            try {
              const rawBuf = Buffer.concat(chunks);
              const raw = rawBuf.toString('utf8') || '';
              const ctype = (req.headers['content-type'] || '').toString().toLowerCase();
              if (ctype.includes('application/json')) {
                console.log(`[http] ${method} ${pathname} read_data json ${rawBuf.length}B ${ms}ms`);
                resolve(JSON.parse(raw || '{}'));
                return;
              }
              if (ctype.includes('application/x-www-form-urlencoded')) {
                console.log(`[http] ${method} ${pathname} read_data form ${rawBuf.length}B ${ms}ms`);
                const params = new URLSearchParams(raw);
                const obj = {};
                for (const [k, v] of params.entries()) obj[k] = v;
                resolve(obj);
                return;
              }
              // Fallbacks
              try {
                const j = JSON.parse(raw || '{}');
                console.log(`[http] ${method} ${pathname} read_data fallback-json ${rawBuf.length}B ${ms}ms`);
                resolve(j);
              } catch {
                try {
                  const params = new URLSearchParams(raw);
                  const obj = {};
                  for (const [k, v] of params.entries()) obj[k] = v;
                  console.log(`[http] ${method} ${pathname} read_data fallback-form ${rawBuf.length}B ${ms}ms`);
                  resolve(obj);
                } catch (e2) {
                  reject(e2);
                }
              }
            } catch (e) {
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
    <title>GBP運用基盤 — ダッシュボード</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;background:#fcfdff;color:#0b1324}
      .ok{color:#0a0}
      .err{color:#a00}
      code{background:#f4f4f4;padding:2px 4px;border-radius:4px}
      a.button{display:inline-block;padding:8px 12px;border:1px solid #333;border-radius:6px;text-decoration:none}
      .hero{display:grid;grid-template-columns:1.2fr 1fr;gap:18px;align-items:center;border:1px solid #e6e9ee;border-radius:14px;background:linear-gradient(180deg,#ffffff,#f5f9ff);padding:20px}
      .hero h1{font-size:26px;margin:0 0 6px}
      .hero p.lead{margin:0 0 12px;color:#3b4a69}
      .cta a{display:inline-block;margin-right:10px;padding:10px 14px;border-radius:8px;text-decoration:none}
      .cta .primary{background:#0b6bcb;color:#fff;border:1px solid #0958a7}
      .cta .secondary{background:#fff;color:#0b6bcb;border:1px solid #0b6bcb}
      .features{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
      .feature{border:1px solid #e6e9ee;border-radius:10px;padding:12px;background:#fff}
      .muted{color:#56607a}
    </style>
  </head>
  <body>
    ${header_nav()}
    <section class="hero">
      <div>
        <h1>複数拠点のGBPを、安全かつ一貫して運用</h1>
        <p class="lead">変更申請→承認→反映→監査を、権限/RLSと監査ログで統制。通知・レート制御・E2Eにより安定運用を実現します。</p>
        <div class="cta">
          <a class="primary" href="/owner">オーナーポータルを試す</a>
          <a class="secondary" href="/review">レビュー/承認を確認</a>
        </div>
        <div class="features">
          <div class="feature">
            <b>統制</b>
            <div class="muted">申請→承認→同期のワークフローで差分管理</div>
          </div>
          <div class="feature">
            <b>安全</b>
            <div class="muted">トークン暗号化とRLS、Cookie/CORSの本番運用</div>
          </div>
          <div class="feature">
            <b>監査</b>
            <div class="muted">誰が・いつ・何を変更したか可視化</div>
          </div>
        </div>
      </div>
      <div>
        <div style="border:1px dashed #c7d4ea;border-radius:12px;padding:12px;background:#fff">
          <b>開発モードのヒント</b>
          <ul class="muted" style="margin:6px 0 0 18px;padding:0">
            <li>右上で Role を切替 (Owner/Reviewer)</li>
            <li>ヘッダのヘルス: DB/on | Outbox/N を確認</li>
            <li>まずは Owner で依頼→ Reviewer で承認</li>
          </ul>
        </div>
      </div>
    </section>
    <h2 style="margin-top:18px">プロダクトの価値</h2>
    <div class="features">
      <div class="feature"><b>一貫性</b><div class="muted">差分とupdate_maskで限定更新</div></div>
      <div class="feature"><b>自動化</b><div class="muted">Outbox/再試行・将来のジョブ常駐</div></div>
      <div class="feature"><b>可観測性</b><div class="muted">E2E・監査・ヘルスで安定性を担保</div></div>
    </div>
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
    <h2>ダッシュボード</h2>
    <div id="auth" style="margin-bottom:12px;">
      <div id="status">loading...</div>
      <div id="token"></div>
    </div>
    <p>
      <a class="button" id="oauth-btn" href="/api/gbp/oauth?provider=google">GoogleでOAuth開始</a>
      <a class="button" id="logout-btn" href="/api/gbp/logout" style="display:none">ログアウト</a>
      <button class="button" id="refresh-btn" style="display:none">アクセストークン更新</button>
    </p>
    <h2>クイックアクション（ロール別）</h2>
    <div id="qa" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
      <div class="card" id="qa-owner" style="border:1px solid #ddd;border-radius:8px;padding:12px;display:none">
        <h3>Owner</h3>
        <ul>
          <li><a href="/owner">ロケーションを選ぶ</a></li>
          <li><a href="/locations">ロケーション一覧を見る</a></li>
        </ul>
      </div>
      <div class="card" id="qa-reviewer" style="border:1px solid #ddd;border-radius:8px;padding:12px;display:none">
        <h3>Reviewer</h3>
        <ul>
          <li><a href="/review">承認キューを開く</a></li>
          <li><a href="/locations">ロケーション一覧を見る</a></li>
        </ul>
      </div>
      <div class="card" id="qa-admin" style="border:1px solid #ddd;border-radius:8px;padding:12px;display:none">
        <h3>Admin</h3>
        <ul>
          <li><a href="/jobs">ジョブUI</a></li>
          <li><a href="/oauth/status">OAuthステータス</a></li>
        </ul>
      </div>
    </div>
    ${DEV_ENABLED ? `<div style="margin-top:12px"><button id="seed" class="button">デモデータ投入（Owner向け）</button> <span id="seed_msg"></span></div>` : ''}
    <h2 style="margin-top:18px">最近の操作</h2>
    <div id="recent" class="card" style="border:1px solid #ddd;border-radius:8px;padding:12px;color:#555">loading...</div>
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
      // Set up role-based quick actions
      (function(){ try{
        var m=document.cookie.match(/(?:^|;)[\s]*role=([^;]+)/); var r=m?decodeURIComponent(m[1]):'';
        function show(id){ var el=document.getElementById(id); if(el) el.style.display='block'; }
        if(!r){ show('qa-owner'); show('qa-reviewer'); show('qa-admin'); } // 未設定なら全部
        if(r==='owner') show('qa-owner'); if(r==='reviewer') show('qa-reviewer'); if(r==='admin') show('qa-admin');
      }catch(e){}})();
      // Seed button
      (function(){ try{
        var btn=document.getElementById('seed'); if(!btn) return; var msg=document.getElementById('seed_msg');
        btn.onclick = async function(){ btn.disabled=true; msg.textContent='…'; try{ var res=await fetch('/__dev/seed?count=3'); var j=await res.json(); msg.textContent = j.ok? ('投入: '+(j.count||0)+'件'): '失敗'; }catch(e){ msg.textContent='失敗'; } finally{ btn.disabled=false; } };
      }catch(e){}})();
      // Recent activity
      (function(){ try{
        function esc(s){
          return String(s==null?'':s).replace(/[&<>"']/g, function(c){
            switch(c){ case '&': return '&amp;'; case '<': return '&lt;'; case '>': return '&gt;'; case '"': return '&quot;'; case '\'': return '&#39;'; default: return c; }
          });
        }
        fetch('/api/recent-activity').then(function(r){return r.json()}).then(function(j){ var el=document.getElementById('recent'); if(!j||!j.ok){ el.textContent='取得に失敗しました'; return; } var arr=j.items||[]; if(!arr.length){ el.textContent='最近の操作はまだありません'; return; } el.innerHTML = '<ul style="margin:0;padding-left:18px">'+arr.map(function(a){ var id=a.entity_id||''; var href=id?('/review/'+id):'#'; return '<li><code>'+esc(a.created_at||'')+'</code> '+esc(a.action||'')+' <a href="'+href+'">'+esc(id)+'</a></li>'; }).join('')+'</ul>'; }).catch(function(){ var el=document.getElementById('recent'); el.textContent='取得に失敗しました'; });
      }catch(e){}})();
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

      // Dev: seed demo change requests
      if (DEV_ENABLED && method === 'GET' && pathname === '/__dev/seed') {
        try {
          const url = new URL(req.url || '', 'http://x');
          const n = Math.min(10, Math.max(1, Number(url.searchParams.get('count') || 3)));
          const cookies = req.headers.cookie || '';
          const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
          const role = (parsed.role || '').toString();
          let email = null;
          try {
            const secret = process.env.APP_SECRET || 'dev_secret';
            const sidSigned = parsed.sid;
            if (sidSigned) {
              const sid = verify_value(sidSigned, secret);
              const session = sid ? get_session(sid) : null;
              email = session?.user?.email || null;
            }
          } catch {}
          if (!email && role === 'owner') email = process.env.DEV_OWNER_EMAIL || 'owner1@example.com';
          const locIds = email ? get_owned_location_ids(email) : ['loc1'];
          const locId = locIds[0] || 'loc1';
          let created = 0;
          for (let i=0;i<n;i++) {
            try {
              const desc = 'デモ説明 ' + Math.random().toString(36).slice(2,8);
              const num = Math.floor(1000+Math.random()*9000);
              createChangeRequestWrite({
                location_id: locId,
                changes: { description: desc, phone: '03-'+num+'-'+num },
                owner_signoff: true,
              }, email || 'demo@example.com');
              created++;
            } catch {}
          }
          return json(res, 200, { ok: true, count: created, location_id: locId });
        } catch { return json(res, 500, { ok: false }); }
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
      // API: recent activity (audits)
      if (method === 'GET' && pathname === '/api/recent-activity') {
        if (supabaseEnabled()) {
          try {
            const r = await sbFetch('/rest/v1/audit_logs?order=created_at.desc&limit=10', { method: 'GET' }, 800);
            if (r.ok) { const arr = await r.json(); return json(res, 200, { ok: true, items: Array.isArray(arr)? arr: [] }); }
          } catch {}
        }
        const items = AUDIT.slice(-10).reverse();
        return json(res, 200, { ok: true, items });
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
        // de-duplication/merge
        if (task.type === 'insert_change_request' && task.data && task.data.id) {
          const exists = OUTBOX.find(t => t.type === 'insert_change_request' && t.data && t.data.id === task.data.id);
          if (exists) return; // already scheduled
        }
        if (task.type === 'patch_change_request' && task.id) {
          const exists = OUTBOX.find(t => t.type === 'patch_change_request' && t.id === task.id);
          if (exists) {
            exists.patch = Object.assign({}, exists.patch || {}, task.patch || {});
            outbox_save();
            return;
          }
        }
        if (task.type === 'insert_notification') {
          const sig = JSON.stringify({ target: task.data?.target || null, subject: task.data?.subject || null, ch: task.data?.channel||'change_request' });
          const exists = OUTBOX.find(t => t.type === 'insert_notification' && JSON.stringify({ target: t.data?.target||null, subject: t.data?.subject||null, ch: t.data?.channel||'change_request' }) === sig);
          if (exists) return;
        }
        OUTBOX.push({ ...task, attempts: 0, nextAt: now, status: 'queued', lastError: null });
        outbox_save();
      }
      let OUTBOX_TIMER = globalThis.__pjt014_outbox_timer || null;
      async function processOutboxTick() {
        if (!supabaseEnabled()) return;
        const now = Date.now();
        for (const task of OUTBOX.slice()) {
          if (task.nextAt > now) continue;
          try {
          task.status = task.attempts > 0 ? 'retrying' : 'queued';
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
          task.lastError = e && e.message ? e.message : String(e);
          const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS || 9);
          if (task.attempts >= MAX_ATTEMPTS) {
            task.status = 'failed';
            task.nextAt = Number.MAX_SAFE_INTEGER;
            console.warn('[outbox] give up task', task.type, 'id=', (task.id||task.data?.id||'?'), 'after', task.attempts, 'attempts');
          } else {
            const backoff = Math.min(60000, 1000 * Math.pow(2, Math.min(8, task.attempts - 1)));
            task.nextAt = Date.now() + backoff;
            console.warn('[outbox] retry in', backoff, 'ms', task.lastError);
          }
          outbox_save();
        }
      }
      }
  function ensureOutboxTimer() {
    if (!OUTBOX_TIMER) {
      OUTBOX_TIMER = globalThis.__pjt014_outbox_timer = setInterval(processOutboxTick, 1000);
    }
  }
  ensureOutboxTimer();
  // Initialize writer adapter context
  try {
    const { initWriter } = await import('./persistence_writer.js');
    initWriter({ enqueueOutbox, supabaseEnabled, sbFetch });
  } catch {}
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
              // read-through cache: sync into local store (source of truth for UI)
              try { for (const it of arr) upsert_change_request(it); } catch {}
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
              if (item) {
                // reviewer/admin はOK、オーナーは所属ロケーションのみ
                try {
                  const cookies = req.headers.cookie || '';
                  const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
                  const role = (parsed.role || '').toString();
                  if (!(DEV_ENABLED && (role==='reviewer'||role==='admin'))) {
                    const locId = item.location_id || item.payload?.location_id || null;
                    const email = (function(){
                      try {
                        const secret = process.env.APP_SECRET || 'dev_secret';
                        const sidSigned = parsed.sid;
                        if (sidSigned) { const sid = verify_value(sidSigned, secret); const session = sid ? get_session(sid) : null; return session?.user?.email || null; }
                      } catch {}
                      if (DEV_ENABLED && role==='owner') return process.env.DEV_OWNER_EMAIL || 'owner1@example.com';
                      return null;
                    })();
                    if (!email) return json(res, 401, { ok: false, error: 'unauthorized' });
                    const allowed = new Set(get_owned_location_ids(email));
                    if (!locId || !allowed.has(locId)) return json(res, 403, { ok: false, error: 'forbidden' });
                  }
                } catch {}
                try { upsert_change_request(item); } catch {}
                return json(res, 200, { ok: true, item });
              }
            }
          } catch {}
        }
        const rec = get_change_request(id);
        if (!rec) return json(res, 404, { ok: false, error: 'not_found' });
        // reviewer/admin はOK、オーナーは所属ロケーションのみ
        try {
          const cookies = req.headers.cookie || '';
          const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
          const role = (parsed.role || '').toString();
          if (!(DEV_ENABLED && (role==='reviewer'||role==='admin'))) {
            const locId = rec.payload?.location_id || null;
            let email = null;
            try {
              const secret = process.env.APP_SECRET || 'dev_secret';
              const sidSigned = parsed.sid;
              if (sidSigned) { const sid = verify_value(sidSigned, secret); const session = sid ? get_session(sid) : null; email = session?.user?.email || null; }
            } catch {}
            if (!email && DEV_ENABLED && role==='owner') email = process.env.DEV_OWNER_EMAIL || 'owner1@example.com';
            if (!email) return json(res, 401, { ok: false, error: 'unauthorized' });
            const allowed = new Set(get_owned_location_ids(email));
            if (!locId || !allowed.has(locId)) return json(res, 403, { ok: false, error: 'forbidden' });
          }
        } catch {}
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
          const body = await read_data();
          if (DEV_ENABLED) {
            try { console.log('[create_req_body]', typeof body, JSON.stringify(body)); } catch {}
          }
          if (!body || typeof body.location_id !== 'string' || !body.location_id) {
            return json(res, 400, { ok: false, error: 'invalid_location_id' });
          }
          if (!body || !(body.owner_signoff === true || body.owner_signoff === 'true' || body.owner_signoff === 1 || body.owner_signoff === '1' || body.owner_signoff === 'on')) {
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
            const phoneOk = /^[0-9()+\s-]{7,}$/.test(phone);
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
          if (body.description != null && String(body.description).length > 500) {
            errors.description = 'too_long';
          }
          if (body.photo_url != null && String(body.photo_url).trim() !== '') {
            const pu = String(body.photo_url).trim();
            let ok = true; try { new URL(pu); } catch { ok = false; }
            if (!ok) errors.photo_url = 'invalid_url';
            else if (!/^https:\/\//i.test(pu)) errors.photo_url = 'require_https';
          }
          if (Object.keys(errors).length) return json(res, 400, { ok: false, error: 'validation_error', errors });
          const rec = createChangeRequestWrite({
            location_id: body?.location_id || null,
            changes: {
              phone: body?.phone ?? null,
              hours: body?.hours ?? null,
              url: body?.url ?? null,
              description: body?.description ?? null,
              photo_url: body?.photo_url ?? null,
            },
            owner_signoff: Boolean(body?.owner_signoff || false),
          }, email);
          try { console.log('[create_request]', rec.id, 'loc=', rec.payload?.location_id, 'by', email); } catch {}
          // Audit: 作成
          record_audit({ entity: 'change_request', entity_id: rec.id, action: 'created', actor_email: email, meta: { location_id: body.location_id } });
          return json(res, 201, { ok: true, id: rec.id });
        } catch (e) {
          try { console.warn('[create_req_error]', e && e.message ? e.message : e); } catch {}
          return json(res, 400, { ok: false, error: 'invalid_json' });
        }
      }
      // Dev diagnostics: memory/outbox snapshot
      if (DEV_ENABLED && method === 'GET' && pathname === '/__dev/diag') {
        try {
          const url = new URL(req.url || '', 'http://x');
          const loc = url.searchParams.get('locId') || '';
          const all = list_change_requests();
          const filtered = loc ? all.filter(r => (r.payload?.location_id||null) === loc) : all;
          const outbox = (globalThis.__pjt014_outbox || []).slice();
          return json(res, 200, {
            ok: true,
            store_count: all.length,
            store_loc_count: filtered.length,
            outbox_len: outbox.length,
            sample: filtered.slice(-5),
          });
        } catch (e) {
          return json(res, 500, { ok: false, error: String(e&&e.message||e) });
        }
      }
      // Helper: reviewer-only guard (dev impersonation). In production, service role enforces at API boundary.
      function devRequireReviewer() {
        if (!DEV_ENABLED) return true;
        try {
          const cookies = req.headers.cookie || '';
          const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
          const role = (parsed.role || '').toString();
          return role === 'reviewer' || role === 'admin';
        } catch { return false; }
      }

      if (method === 'POST' && pathname.startsWith('/api/change-requests/') && pathname.endsWith('/status')) {
        if (!devRequireReviewer()) return json(res, 403, { ok: false, error: 'forbidden' });
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
          const w = await patchStatusWrite(id, st, reason);
          if (!w.ok && w.notFound) return json(res, 404, { ok: false, error: 'not_found' });
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

      // Sync state endpoint
      if (method === 'GET' && pathname.startsWith('/api/change-requests/') && pathname.endsWith('/sync')) {
        const id = pathname.split('/')[3];
        if (!id) return json(res, 400, { ok: false, error: 'bad_request' });
        try {
          const tasks = (globalThis.__pjt014_outbox || []).filter(t => (t.data?.id===id) || (t.id===id));
          let state = 'synced';
          let attempts = 0;
          let nextAt = null;
          let lastError = null;
          for (const t of tasks) {
            attempts = Math.max(attempts, Number(t.attempts||0));
            nextAt = Math.max(nextAt||0, Number(t.nextAt||0)) || null;
            if (t.status === 'failed') { state = 'failed'; lastError = t.lastError || lastError; break; }
            state = 'pending';
            lastError = t.lastError || lastError;
          }
          return json(res, 200, { ok: true, state, attempts, nextAt, lastError });
        } catch { return json(res, 200, { ok: true, state: 'synced' }); }
      }

      // Resync endpoint: re-enqueue for persistence
      if (method === 'POST' && pathname.startsWith('/api/change-requests/') && pathname.endsWith('/resync')) {
        if (!supabaseEnabled()) return json(res, 400, { ok: false, error: 'supabase_not_configured' });
        const id = pathname.split('/')[3];
        const rec = get_change_request(id || '');
        if (!rec) return json(res, 404, { ok: false, error: 'not_found' });
        // AuthZ: reviewer/admin か、オーナーの所属ロケーションのみ
        try {
          const cookies = req.headers.cookie || '';
          const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
          const role = (parsed.role || '').toString();
          if (!(DEV_ENABLED && (role==='reviewer'||role==='admin'))) {
            const locId = rec.payload?.location_id || null;
            let email = null;
            try {
              const secret = process.env.APP_SECRET || 'dev_secret';
              const sidSigned = parsed.sid;
              if (sidSigned) { const sid = verify_value(sidSigned, secret); const session = sid ? get_session(sid) : null; email = session?.user?.email || null; }
            } catch {}
            if (!email && DEV_ENABLED && role==='owner') email = process.env.DEV_OWNER_EMAIL || 'owner1@example.com';
            const allowed = email ? new Set(get_owned_location_ids(email)) : new Set();
            if (!email) return json(res, 401, { ok: false, error: 'unauthorized' });
            if (!locId || !allowed.has(locId)) return json(res, 403, { ok: false, error: 'forbidden' });
          }
        } catch {}
        enqueueOutbox({ type: 'insert_change_request', data: {
          id: rec.id,
          location_id: rec.payload?.location_id || null,
          changes: rec.payload?.changes || {},
          status: rec.status,
          owner_signoff: Boolean(rec.payload?.owner_signoff || false),
          created_by_email: rec.created_by_email || null,
        }});
        enqueueOutbox({ type: 'patch_change_request', id: rec.id, patch: {
          status: rec.status,
          review_note: rec.review_note || null,
          checks: rec.checks || {},
          changes: rec.payload?.changes || {},
        }});
        return json(res, 200, { ok: true, enqueued: true });
      }
      if (method === 'POST' && pathname.startsWith('/api/change-requests/') && pathname.endsWith('/checks')) {
        if (!devRequireReviewer()) return json(res, 403, { ok: false, error: 'forbidden' });
        try {
          const id = pathname.split('/')[3];
          const body = await read_json();
          const w = await patchChecksWrite(id, body || {});
          if (!w.ok && w.notFound) return json(res, 404, { ok: false, error: 'not_found' });
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
          // reviewer/admin はOK、オーナーは所属ロケーションのみ
          try {
            const cookies = req.headers.cookie || '';
            const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
            const role = (parsed.role || '').toString();
            if (!(DEV_ENABLED && (role==='reviewer'||role==='admin'))) {
              const locId = rec.payload?.location_id || null;
              let email = null;
              try {
                const secret = process.env.APP_SECRET || 'dev_secret';
                const sidSigned = parsed.sid;
                if (sidSigned) { const sid = verify_value(sidSigned, secret); const session = sid ? get_session(sid) : null; email = session?.user?.email || null; }
              } catch {}
              if (!email && DEV_ENABLED && role==='owner') email = process.env.DEV_OWNER_EMAIL || 'owner1@example.com';
              if (!email) return json(res, 401, { ok: false, error: 'unauthorized' });
              const allowed = new Set(get_owned_location_ids(email));
              if (!locId || !allowed.has(locId)) return json(res, 403, { ok: false, error: 'forbidden' });
            }
          } catch {}
          changes = rec?.payload?.changes || {};
        } else if (supabaseEnabled()) {
          try {
            const r = await sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`, { method: 'GET' }, 600);
            if (r.ok) {
              const arr = await r.json();
              const item = Array.isArray(arr) && arr[0] ? arr[0] : null;
              if (item) {
                // reviewer/admin はOK、オーナーは所属ロケーションのみ
                try {
                  const cookies = req.headers.cookie || '';
                  const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
                  const role = (parsed.role || '').toString();
                  if (!(DEV_ENABLED && (role==='reviewer'||role==='admin'))) {
                    const locId = item.location_id || item.payload?.location_id || null;
                    let email = null;
                    try {
                      const secret = process.env.APP_SECRET || 'dev_secret';
                      const sidSigned = parsed.sid;
                      if (sidSigned) { const sid = verify_value(sidSigned, secret); const session = sid ? get_session(sid) : null; email = session?.user?.email || null; }
                    } catch {}
                    if (!email && DEV_ENABLED && role==='owner') email = process.env.DEV_OWNER_EMAIL || 'owner1@example.com';
                    if (!email) return json(res, 401, { ok: false, error: 'unauthorized' });
                    const allowed = new Set(get_owned_location_ids(email));
                    if (!locId || !allowed.has(locId)) return json(res, 403, { ok: false, error: 'forbidden' });
                  }
                } catch {}
                changes = item?.changes || {};
              }
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
        // change_request の監査はオーナーも参照可だが、自ロケーションに限る（レビュアー/管理者は全件）
        if (e === 'change_request' && eid) {
          try {
            const cookies = req.headers.cookie || '';
            const parsed = Object.fromEntries((cookies||'').split(';').map(s=>s.trim().split('=').map(decodeURIComponent)).filter(a=>a.length===2));
            const role = (parsed.role || '').toString();
            const isReviewer = DEV_ENABLED && (role==='reviewer'||role==='admin');
            if (!isReviewer) {
              // authorise by location ownership
              let locId = null;
              const rec = get_change_request(eid);
              if (rec) locId = rec.payload?.location_id || null;
              if (!locId && supabaseEnabled()) {
                try {
                  const r = await sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(eid)}&select=location_id`, { method: 'GET' }, 600);
                  if (r.ok) { const arr = await r.json(); const item = Array.isArray(arr)&&arr[0]?arr[0]:null; locId = item?.location_id || null; }
                } catch {}
              }
              let email = null;
              try {
                const secret = process.env.APP_SECRET || 'dev_secret';
                const sidSigned = parsed.sid;
                if (sidSigned) { const sid = verify_value(sidSigned, secret); const session = sid ? get_session(sid) : null; email = session?.user?.email || null; }
              } catch {}
              if (!email && DEV_ENABLED && role==='owner') email = process.env.DEV_OWNER_EMAIL || 'owner1@example.com';
              if (!email) return json(res, 401, { ok: false, error: 'unauthorized' });
              const allowed = new Set(get_owned_location_ids(email));
              if (!locId || !allowed.has(locId)) return json(res, 403, { ok: false, error: 'forbidden' });
            }
          } catch {}
        }
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
        <div id="loc_help" class="muted"></div>
        <script>
          fetch('/api/locations').then(r=>r.json()).then(j=>{
            const ul = document.getElementById('list');
            const arr = j.items||[];
            if (!arr.length){ document.getElementById('loc_help').textContent='表示できるロケーションがありません。権限が必要な場合は管理者に連絡してください。'; return; }
            arr.forEach(it=>{
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
        const googleConfiguredOwner = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        const ownerStatusInit = 'OAuth: ' + (googleConfiguredOwner ? 'configured' : 'not configured') + (email ? ' | signed in as <b>'+(email||'')+'</b>' : '');
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
        const offlineBanner = (function(){ try { const hasDb = supabaseEnabled(); const q=(globalThis.__pjt014_outbox||[]).length; if(!hasDb) return '<div style="background:#fff7cc;border:1px solid #e6c200;padding:8px;border-radius:6px;margin:8px 0">オフラインモード: 変更は一時保存され、後で送信されます（キュー '+q+' 件）</div>'; if(q>0) return '<div style="background:#f6fbff;border:1px solid #9ad;padding:8px;border-radius:6px;margin:8px 0">送信待ち: '+q+' 件</div>'; }catch(e){} return ''; })();
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Owner Portal - Select</title>
          <style>body{font-family:system-ui;padding:20px;} li{margin:6px 0} .muted{color:#666}</style>
        </head><body>
          ${header_nav()}
          ${offlineBanner}
          <h1>オーナーポータル：ロケーション選択</h1>
          <p style="color:#555">対象: オーナー。できること: 編集対象のロケーションを選択。</p>
          <div style="background:#f9f9f9;border:1px solid #eee;padding:8px;border-radius:6px;margin:8px 0">
            <b>使い方</b>：変更したいロケーションを選び、次の画面で編集内容を入力して送信します。
          </div>
          <p>編集したいロケーションを選択してください。</p>
          ${items.length? '' : '<div class="muted" style="margin:8px 0">表示できるロケーションがありません。ログインしているアカウントの割当がない可能性があります。開発中は右上のRoleメニューでOwnerに切替えてください。</div>'}
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
          ${(function(){ try { const hasDb = supabaseEnabled(); const q=(globalThis.__pjt014_outbox||[]).length; if(!hasDb) return '<div style="background:#fff7cc;border:1px solid #e6c200;padding:8px;border-radius:6px;margin:8px 0">オフラインモード: 変更は一時保存され、後で送信されます（キュー '+q+' 件）</div>'; if(q>0) return '<div style="background:#f6fbff;border:1px solid #9ad;padding:8px;border-radius:6px;margin:8px 0">送信待ち: '+q+' 件</div>'; }catch(e){} return ''; })()}
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
              <div id="owner_status">${Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) ? 'OAuth: configured' : 'OAuth: not configured'}</div>
              <ul id="kpi"><li>Profile completeness: stub</li><li>Token: see Dashboard</li></ul>
            </div>
            <div class="card">
          <h2>変更依頼フォーム（限定項目）</h2>
          <form id="req" method="post" action="/api/change-requests">
            <input type="hidden" name="location_id" value="${loc.id}" />
            <label>電話<input name="phone" value="${loc.phone||''}" placeholder="例: 03-1234-5678" /></label>
            <div id="err_phone" class="err" style="color:#900"></div>
            <label>営業時間<input name="hours" value="${loc.hours||''}" placeholder="例: 9:00-18:00 (月-金)" /></label>
            <label>URL<input name="url" value="${loc.url||''}" placeholder="https://example.com" /></label>
            <div id="err_url" class="err" style="color:#900"></div>
            <label>説明<textarea name="description" rows="3" id="desc" placeholder="例: 当院は○○に特化し、△△の方針で運営しています。"></textarea></label>
            <div id="err_description" class="err" style="color:#900"></div>
            <div id="warn" style="color:#900"></div>
            <label>写真URL<input name="photo_url" placeholder="https://.../photo.jpg" /></label>
            <div id="err_photo_url" class="err" style="color:#900"></div>
            <label><input type="checkbox" id="owner_signoff" name="owner_signoff" value="1"> オーナーによる内容確認（必須）</label>
            <div id="form_err" class="err"></div>
            <button id="submit_btn" type="submit">送信</button>
            <span id="msg"></span>
          </form>
            </div>
          </div>
          <div class="card" style="margin-top:16px">
            <div id="last_reason" style="margin:8px 0;color:#900"></div>
            <h2>依頼一覧（最新順, stub保存）</h2>
            <table>
              <thead><tr><th>ID</th><th>Location</th><th>Status</th><th>Sync</th><th>Reason</th><th>Created</th></tr></thead>
              <tbody id="reqs"></tbody>
            </table>
          </div>
          <script>
            function fmt(ts){ try{ const d=new Date(ts); if(!isNaN(d)) return d.toLocaleString(); }catch(e){} return ts||''; }
            async function loadStatus(){
              try{ const j = await (await fetch('/api/dashboard')).json();
                const el = document.getElementById('owner_status');
                const authed = j?.session?.authenticated; const email = j?.session?.email;
                el.innerHTML = 'OAuth: '+(j?.config?.google_configured?'configured':'not configured') + (authed? ' | signed in as <b>'+email+'</b>':'' );
                el.className = authed? 'ok':'err';
              }catch(e){ var el=document.getElementById('owner_status'); if(el) el.textContent='status error'; }
            }
            async function loadRequests(){
              const tb = document.getElementById('reqs'); tb.innerHTML='';
              try{
                const r = await fetch('/api/change-requests?location_id=${loc.id}');
                const j = await r.json();
                const arr = j.items||[];
                if(!arr.length){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="5" style="color:#555">依頼はまだありません。右上のフォームから変更依頼を作成してください。</td>'; tb.appendChild(tr); document.getElementById('last_reason').textContent=''; return; }
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
                    function esc(s){
                      return String(s==null?'':s).replace(/[&<>"']/g, function(c){
                        switch(c){ case '&': return '&amp;'; case '<': return '&lt;'; case '>': return '&gt;'; case '"': return '&quot;'; case "'": return '&#39;'; default: return c; }
                      });
                    }
                    el.innerHTML = (isNew? '<b style="background:#ff0;color:#900;padding:0 6px;margin-right:6px">新着</b>' : '') + '最新の差戻し理由: ' + esc(nf.review_note||'') + ' <span class="muted">(' + fmt(created) + ')</span>' + (isNew? ' <button id="mark_seen" style="margin-left:6px">既読にする</button>' : '');
                    const btn = document.getElementById('mark_seen'); if(btn) btn.onclick = ()=>{ localStorage.setItem(key, created||''); el.innerHTML = '最新の差戻し理由: ' + (nf.review_note||'') + ' <span class="muted">(' + fmt(created) + ')</span>'; };
                  } else {
                    el.textContent = '';
                  }
                }catch(e){ document.getElementById('last_reason').textContent=''; }
                arr.forEach(r=>{ const tr=document.createElement('tr');
                  const reason = (r.review_note||'');
                  const st = (r.status||'');
                  const reasonCell = reason ? ('<span style="color:#900">'+reason.replace(/</g,'&lt;')+'</span>') : '';
                  tr.innerHTML = '<td>'+r.id+'</td><td>'+(r.payload?.location_id||r.location_id||'')+'</td><td>'+st+'</td><td id="sync_'+r.id+'">loading...</td><td>'+reasonCell+'</td><td>'+fmt(r.created_at||'')+'</td>';
                  tb.appendChild(tr);
                  try{
                    fetch('/api/change-requests/'+encodeURIComponent(r.id)+'/sync').then(x=>x.json()).then(function(j){
                      var el=document.getElementById('sync_'+r.id); if(!el) return; var s=j&&j.state||'synced';
                      if(s==='pending'){ el.innerHTML='<span style="color:#c60">pending</span>'; }
                      else if(s==='failed'){ el.innerHTML='<span style="color:#900">failed</span> <button data-id="'+r.id+'" class="rs">再送</button>'; }
                      else { el.innerHTML='<span style="color:#090">synced</span>'; }
                    }).catch(function(){ var el=document.getElementById('sync_'+r.id); if(el) el.textContent='n/a'; });
                  }catch(e){ var el=document.getElementById('sync_'+r.id); if(el) el.textContent='n/a'; }
                });
                // 再送ボタン（イベント委譲）
                tb.addEventListener('click', async function(ev){ var t=ev.target; if(t && t.classList && t.classList.contains('rs')){ var id=t.getAttribute('data-id'); t.disabled=true; try{ var r=await fetch('/api/change-requests/'+encodeURIComponent(id)+'/resync', { method:'POST' }); var j=await r.json(); if(j&&j.ok){ t.textContent='再送済'; } else { t.textContent='失敗'; } }catch(e){ t.textContent='失敗'; } }});
              }catch(e){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="5" style="color:#900">一覧の取得に失敗しました</td>'; tb.appendChild(tr); }
            }
            async function liveCheck(){
              const desc = document.getElementById('desc').value||'';
              try{
                const r = await fetch('/api/compliance-check', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ changes: { description: desc } })});
                const j = await r.json();
                const el = document.getElementById('warn');
                const hits = (j.results && j.results.description) ? j.results.description : [];
                el.innerHTML = hits.length? ('自動チェック: '+hits.map(h=>h.label+':\"'+h.match+'\"').join(', ')) : '';
              }catch(e){ /* noop */ }
            }
            function updateSubmit(){
              try{
                var cb=document.getElementById('owner_signoff');
                var btn=document.getElementById('submit_btn');
                if(!cb||!btn) return;
                var checked = !!cb.checked;
                if (checked) { btn.disabled = false; btn.removeAttribute('disabled'); }
                else { btn.disabled = true; }
              }catch(e){}
            }
            var os=document.getElementById('owner_signoff'); if (os){ os.addEventListener('change', updateSubmit); os.addEventListener('input', updateSubmit); os.addEventListener('click', updateSubmit); }
            function validUrl(u){ try{ const x=new URL(u); return /^https:/.test(x.href); }catch(e){return false;} }
            function validPhone(p){ return /^[0-9()+\s-]{7,}$/.test(String(p||'')); }
            function clearFieldErrors(){ ['phone','url','description','photo_url'].forEach(function(k){ var el=document.getElementById('err_'+k); if(el) el.textContent=''; }); }
            document.getElementById('req').onsubmit = async (e)=>{
              e.preventDefault(); const f = new FormData(e.target); const obj = Object.fromEntries(f.entries());
              const errEl = document.getElementById('form_err'); const m = document.getElementById('msg');
              m.textContent=''; errEl.textContent=''; clearFieldErrors();
              if (!document.getElementById('owner_signoff').checked){ errEl.textContent='オーナー確認への同意が必要です'; return; }
              if (obj.url && !validUrl(String(obj.url||''))){ var eurl=document.getElementById('err_url'); if(eurl) eurl.textContent='URLは https:// で始まる必要があります'; else errEl.textContent='URLは https:// で始まる必要があります'; return; }
              if (obj.phone && !validPhone(String(obj.phone||''))){ var eph=document.getElementById('err_phone'); if(eph) eph.textContent='電話番号の形式が正しくありません'; else errEl.textContent='電話番号の形式が正しくありません'; return; }
              if (obj.description && String(obj.description||'').length > 500){ var ed=document.getElementById('err_description'); if(ed) ed.textContent='説明は500文字以内で入力してください'; else errEl.textContent='説明は500文字以内で入力してください'; return; }
              obj.owner_signoff = true;
              try{
                const r = await fetch('/api/change-requests', { method:'POST', headers:{'content-type':'application/json'}, credentials:'same-origin', body: JSON.stringify(obj)});
                const j = await r.json();
                if(j.ok){ m.innerHTML='送信しました: '+j.id+' <a href="/__dev/impersonate?role=reviewer&next=%2Freview">レビューキューを開く（レビュアーに切替）</a>'; (e.target).reset(); updateSubmit(); loadRequests(); } else {
                  if (j.error==='validation_error'){
                    var errs=j.errors||{}; var any=false;
                    if (errs.url){ var el=document.getElementById('err_url'); if(el) el.textContent=(errs.url==='invalid_url'?'URLの形式が正しくありません':'URLは https:// で始まる必要があります'); any=true; }
                    if (errs.phone){ var elp=document.getElementById('err_phone'); if(elp) elp.textContent='電話番号の形式が正しくありません'; any=true; }
                    if (errs.description){ var eld=document.getElementById('err_description'); if(eld) eld.textContent='説明は500文字以内で入力してください'; any=true; }
                    if (!any){ errEl.textContent='入力に誤りがあります'; }
                  } else if (j.error==='invalid_owner_signoff'){
                    errEl.textContent='オーナー確認への同意が必要です';
                  } else {
                    errEl.textContent='送信に失敗しました（'+(j.error||'不明')+'）';
                  }
                }
              }catch(e){ errEl.textContent='送信エラー'; }
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
            res.statusCode = 302; res.setHeader('location', '/__dev/impersonate?role=reviewer&next=%2Freview'); return res.end();
          }
        } catch {}
        const offlineBanner = (function(){ try { const hasDb = supabaseEnabled(); const q=(globalThis.__pjt014_outbox||[]).length; if(!hasDb) return '<div style="background:#fff7cc;border:1px solid #e6c200;padding:8px;border-radius:6px;margin:8px 0">オフラインモード: 変更は一時保存され、後で送信されます（キュー '+q+' 件）</div>'; if(q>0) return '<div style="background:#f6fbff;border:1px solid #9ad;padding:8px;border-radius:6px;margin:8px 0">送信待ち: '+q+' 件</div>'; }catch(e){} return ''; })();
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Review Queue</title>
          <style>body{font-family:system-ui;padding:20px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px} select{margin-left:8px} .muted{color:#666}</style>
        </head><body>
          ${header_nav()}
          ${offlineBanner}
          <h1>承認キュー</h1>
          <p style="color:#555">対象: オペレーター/承認者。できること: 依頼のレビュー/承認/差戻し。</p>
          <div style="background:#f9f9f9;border:1px solid #eee;padding:8px;border-radius:6px;margin:8px 0">
            <b>使い方</b>：一覧からIDをクリックして詳細へ。詳細画面で自動チェックとチェックリストを確認し、承認/差戻しを行います。
          </div>
          <span id="seed_help" style="display:none">${DEV_ENABLED ? '<a href="/__dev/seed?count=3">デモデータ投入</a>' : ''}</span>
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
            function fmt(ts){ try{ const d=new Date(ts); if(!isNaN(d)) return d.toLocaleString(); }catch(e){} return ts||''; }
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
                if(!arr.length){ const tr=document.createElement('tr'); var sh=document.getElementById('seed_help'); var extra=sh?(' ・'+sh.innerHTML):''; tr.innerHTML='<td colspan="4" class="muted">該当する依頼はありません。上のステータスで絞り込みを変更してください。'+extra+'</td>'; tb.appendChild(tr); return; }
                arr.forEach(r=>{
                  const tr = document.createElement('tr');
                  const id = r.id; const loc = (r.location_id||r.payload?.location_id||'');
                  const st = (r.status||''); const created = fmt(r.created_at||'');
                  tr.innerHTML = '<td><a href="/review/'+id+'">'+id+'</a></td><td>'+loc+'</td><td>'+st+'</td><td>'+created+'</td>';
                  tb.appendChild(tr);
                });
              }catch(e){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="4" style="color:#900">一覧の取得に失敗しました</td>'; tb.appendChild(tr); }
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
            const next = encodeURIComponent(pathname);
            res.statusCode = 302; res.setHeader('location', '/__dev/impersonate?role=reviewer&next='+next); return res.end();
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
          <div id="sync_state" style="margin:6px 0;color:#555">Sync: loading...</div>
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
          <h2>差分（before / after）</h2>
          <div id="diff">loading...</div>
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
            <button id="resync" style="display:none">再送（同期やり直し）</button>
          </p>
          <script>
            // Surface client-side errors to the page for easier diagnosis in E2E
            (function(){
              try{
                window.addEventListener('error', function(e){ try{ var el=document.getElementById('err'); if(el){ el.textContent = 'JS error: ' + (e && e.message ? e.message : e); } }catch(_){} });
                window.addEventListener('unhandledrejection', function(e){ try{ var el=document.getElementById('err'); var msg = (e && e.reason && (e.reason.message || e.reason)) || e; if(el){ el.textContent = 'JS rejection: ' + msg; } }catch(_){} });
              }catch(_){ }
            })();
            // Fallback: if diff stays "loading..." for too long, show a readable failure
            (function(){
              try{
                var started = Date.now();
                var idInt = setInterval(function(){
                  var el = document.getElementById('diff');
                  if(!el) { clearInterval(idInt); return; }
                  var t = (el.textContent||'').trim();
                  if (/^loading\.\.\.$/i.test(t) && Date.now() - started > 5000) {
                    el.textContent = '差分の取得に失敗（タイムアウト）';
                    clearInterval(idInt);
                    return;
                  }
                  if (!/^loading\.\.\.$/i.test(t)) {
                    clearInterval(idInt);
                  }
                }, 250);
              }catch(e){}
            })();
            async function loadItem(){
              try{
                const res = await fetch('/api/change-requests/${id}', { credentials: 'same-origin' });
                let j=null; let parseErr=null; try{ j=await res.json(); }catch(e){ parseErr=e; }
                if(!res.ok || !j || j.ok===false){
                  document.getElementById('payload').textContent = 'not found';
                  document.getElementById('cur_status').textContent = 'Status: not_found';
                  document.getElementById('err').innerHTML = '取得に失敗しました (HTTP '+res.status+(parseErr?' parse error':'')+'). <a href="/review">承認キューに戻る</a>';
                  return;
                }
                const item = j.item;
                document.getElementById('loc').textContent = item.location_id || '';
                document.getElementById('payload').textContent = JSON.stringify(item.changes||{}, null, 2);
                document.getElementById('cur_status').textContent = 'Status: ' + (item.status||'');
                // sync state
                try{
                  const s = await (await fetch('/api/change-requests/${id}/sync')).json();
                  var el=document.getElementById('sync_state'); var btn=document.getElementById('resync');
                  var st=(s&&s.state)||'synced';
                  if(st==='pending'){ el.textContent='Sync: pending'; btn.style.display='inline-block'; }
                  else if(st==='failed'){ el.textContent='Sync: failed'; btn.style.display='inline-block'; }
                  else { el.textContent='Sync: synced'; btn.style.display='none'; }
                }catch(e){ var el=document.getElementById('sync_state'); if(el) el.textContent='Sync: n/a'; }
                // Diff: fetch base location and render differences (fallback to after-only)
                let base = {};
                try{
                  const baseRes = await fetch('/api/locations/'+encodeURIComponent(item.location_id||''), { credentials: 'same-origin' });
                  const baseJson = await baseRes.json();
                  base = (baseJson && baseJson.item) ? baseJson.item : {};
                }catch(e){ /* use empty base */ }
                const after = item.changes || {};
                const fields = [
                  ['phone','電話'], ['hours','営業時間'], ['url','URL'], ['description','説明'], ['photo_url','写真URL']
                ];
                function esc(s){
                  s = String(s==null?'':s);
                  s = s.replace(/&/g,'&amp;');
                  s = s.replace(/</g,'&lt;');
                  s = s.replace(/>/g,'&gt;');
                  s = s.replace(/\"/g,'&quot;');
                  s = s.replace(/'/g,'&#39;');
                  return s;
                }
                let rows='';
                for (const [key,label] of fields){
                  const before = base && (base[key]!=null? base[key]: '');
                  const aft = after && (after[key]!=null? after[key]: before);
                  const changed = String(before||'') !== String(aft||'');
                  rows += '<tr>'+
                    '<td>'+esc(label)+'</td>'+
                    '<td>'+esc(before||'')+'</td>'+
                    '<td'+(changed?' style="background:#fff4f4"':'')+'>'+esc(aft||'')+'</td>'+
                  '</tr>';
                }
                document.getElementById('diff').innerHTML = '<table style="width:100%;border-collapse:collapse"><thead><tr><th>項目</th><th>Before</th><th>After</th></tr></thead><tbody>'+rows+'</tbody></table>';
                // Auto-transition: move submitted -> in_review on open
                try{
                  if ((item.status||'') === 'submitted') {
                    await setStatus('in_review');
                    document.getElementById('cur_status').textContent = 'Status: in_review';
                  }
                }catch(e){}
                // prefill checks
                try{
                  const ch = item.checks||{}; const f = document.getElementById('checks');
                  for(const k of Object.keys(ch)){
                    const el = f.querySelector('input[name="'+k+'"]'); if(el) el.checked = Boolean(ch[k]);
                  }
                }catch(e){}
                // show owner signoff
                document.getElementById('owner').textContent = 'オーナー確認: ' + (item.owner_signoff ? '済' : '未');
                // toggle start review button
                try{
                  const btn = document.getElementById('start_review');
                  const st = (item.status||'');
                  const hide = (st==='in_review' || st==='approved' || st==='needs_fix' || st==='synced');
                  btn.style.display = hide ? 'none' : 'inline-block';
                }catch(e){}
              }catch(e){ document.getElementById('payload').textContent='取得に失敗しました'; }
            }
            async function loadAuto(){
              try{
                const j = await (await fetch('/api/change-requests/${id}/compliance', { credentials: 'same-origin' })).json();
                const el = document.getElementById('auto');
                if(!j.ok){ el.textContent='自動チェックの取得に失敗しました'; return; }
                const res = j.results||{};
                const rows = [];
                if(res.description && res.description.length){
                  rows.push('<b>説明</b>: '+res.description.map(h=>h.label+':"'+h.match+'"').join(', '));
                }
                el.innerHTML = rows.length? rows.map(r=>'<div style="color:#900">'+r+'</div>').join('') : '<div style="color:#090">自動チェック: 問題なし</div>';
              }catch(e){ document.getElementById('auto').textContent='自動チェックエラー'; }
            }
            async function loadAudit(){
              try{
                const j = await (await fetch('/api/audits?entity=change_request&id=${id}')).json();
                const el = document.getElementById('audit');
                if(!j.ok){ el.textContent='取得に失敗しました'; return; }
                const arr = j.items||[];
                if(!arr.length){ el.textContent='記録なし'; return; }
                function esc(s){ s=String(s==null?'':s); s=s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;'); return s; }
                el.innerHTML = '<ul style="margin:0;padding-left:18px">'+arr.map(function(a){ return '<li><code>'+esc(a.created_at||'')+'</code> '+esc(a.action||'')+' by '+esc(a.actor_email||'-')+'</li>'; }).join('')+'</ul>';
              }catch(e){ document.getElementById('audit').textContent='監査取得エラー'; }
            }
            document.getElementById('checks').onsubmit = async (e)=>{
              e.preventDefault(); const f=new FormData(e.target); const obj={}; for(const [k,v] of f.entries()){ obj[k]=true; }
              try{
                const r = await fetch('/api/change-requests/${id}/checks', { method:'POST', headers:{'content-type':'application/json'}, credentials:'same-origin', body: JSON.stringify(obj)});
                const j = await r.json();
                document.getElementById('msg').textContent = j.ok? '保存しました' : '保存に失敗しました';
              }catch(e){ document.getElementById('msg').textContent='保存エラー'; }
            };
            async function setStatus(st){
              try{
                const payload = { status: st };
                if (st === 'needs_fix') {
                  const reason = (document.getElementById('reason').value || '').trim();
                  if (!reason || reason.length < 3) { document.getElementById('msg').textContent='差戻し理由を入力してください'; return; }
                  payload.reason = reason;
                }
                const r = await fetch('/api/change-requests/${id}/status', { method:'POST', headers:{'content-type':'application/json'}, credentials:'same-origin', body: JSON.stringify(payload)});
                let j=null; let parseErr=null; try{ j=await r.json(); }catch(e){ parseErr=e; }
                if (r.ok && j && j.ok) {
                  document.getElementById('msg').textContent = '状態を '+st+' に更新しました';
                  document.getElementById('cur_status').textContent = 'Status: '+st;
                } else {
                  document.getElementById('msg').textContent = '更新に失敗しました (HTTP '+r.status+(parseErr?' parse error':'')+')';
                }
              }catch(e){ document.getElementById('msg').textContent='更新エラー'; }
            }
            document.getElementById('approve').onclick = ()=> setStatus('approved');
            document.getElementById('needs_fix').onclick = ()=> setStatus('needs_fix');
            document.getElementById('start_review').onclick = ()=> setStatus('in_review');
            document.getElementById('resync').onclick = async ()=>{ try{ const r=await fetch('/api/change-requests/${id}/resync', { method:'POST' }); const j=await r.json(); document.getElementById('msg').textContent = j&&j.ok? '再送しました' : '再送に失敗しました'; }catch(e){ document.getElementById('msg').textContent='再送エラー'; } };
            // Defer initial loads until window load to avoid race/parse issues
            (function(){ try{
              if (document.readyState === 'complete') { setTimeout(function(){ loadItem(); loadAuto(); loadAudit(); }, 0); }
              else { window.addEventListener('load', function(){ loadItem(); loadAuto(); loadAudit(); }, { once: true }); }
            }catch(e){ try{ loadItem(); loadAuto(); loadAudit(); }catch(_){} } })();
          </script>
        </body></html>`;
        return html(res, 200, page + dev_reload_script());
      }

      // API: health (must be above fallback)
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

      json(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      console.error(err);
      try {
        if ((pathname||'').startsWith('/api/')) return json(res, 500, { ok: false, error: 'internal_error' });
        return html(res, 500, '<!doctype html><html><body><h1>Internal Error</h1><p>一時的なエラーが発生しました。<a href="/">トップへ戻る</a></p></body></html>');
      } catch {
        return json(res, 500, { ok: false, error: 'internal_error' });
      }
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
  // Security hints for production
  try {
    if (process.env.NODE_ENV === 'production') {
      const allowEnv = (process.env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
      if (!allowEnv.length) {
        console.warn('[security] ALLOWED_ORIGINS is not set in production. CORS will be wide-open (*)');
      }
      const v = String(process.env.COOKIE_SECURE || '').toLowerCase();
      const secure = (v==='1'||v==='true'||v==='yes') || (!v && process.env.NODE_ENV==='production');
      if (!secure) console.warn('[security] COOKIE_SECURE is not enabled; set COOKIE_SECURE=1 under HTTPS');
    }
  } catch {}
  server.on('error', (err) => {
    console.error('[server] listen error:', err && err.message ? err.message : err);
    console.error('[server] hint: try another PORT or set HOST=127.0.0.1');
    process.exitCode = 1;
  });
  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    const addr = server.address();
    const actualPort = (addr && typeof addr === 'object') ? addr.port : DEFAULT_PORT;
    const host = DEFAULT_HOST === '0.0.0.0' ? 'localhost' : DEFAULT_HOST;
    console.log(`[server] listening on http://${host}:${actualPort}`);
    try {
      const portFile = process.env.PORT_FILE;
      if (portFile) {
        fs.writeFileSync(portFile, String(actualPort), 'utf8');
      }
    } catch (e) {
      // best-effort
    }
  });
}

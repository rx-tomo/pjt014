// PersistenceAdapter (read-through). Writes remain orchestrated by server/outbox.
import { upsert_change_request, list_change_requests as listLocal, get_change_request as getLocal } from './change_requests_store.js';

function supabaseConfigured() {
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
    const res = await fetch(base + pathname, Object.assign({}, init, { headers, signal: controller.signal }));
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function listChangeRequestsAdapter(filters = {}) {
  const { location_id = null, status = null } = filters || {};
  if (supabaseConfigured()) {
    const params = new URLSearchParams();
    if (location_id) params.set('location_id', `eq.${encodeURIComponent(location_id)}`);
    if (status) params.set('status', `eq.${encodeURIComponent(String(status))}`);
    const qs = params.toString();
    const r = await sbFetch('/rest/v1/owner_change_requests' + (qs ? `?${qs}` : ''), { method: 'GET' }, 1000);
    const arr = r.ok ? await r.json() : [];
    try { if (Array.isArray(arr)) for (const it of arr) upsert_change_request(it); } catch {}
    return Array.isArray(arr) ? arr : [];
  }
  let items = listLocal();
  if (location_id) items = items.filter(r => (r.payload?.location_id || null) === location_id);
  if (status) items = items.filter(r => (r.status || '') === status);
  // shape normalization for compatibility
  return items.map(rec => ({
    id: rec.id,
    location_id: rec.payload?.location_id || null,
    changes: rec.payload?.changes || {},
    status: rec.status,
    created_at: rec.created_at,
    owner_signoff: Boolean(rec.payload?.owner_signoff || false),
    checks: rec.checks || {},
    review_note: rec.review_note || null,
    created_by_email: rec.created_by_email || null,
  }));
}

export async function getChangeRequestAdapter(id) {
  if (!id) return null;
  if (supabaseConfigured()) {
    const r = await sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`, { method: 'GET' }, 800);
    if (r.ok) {
      const arr = await r.json();
      const item = Array.isArray(arr) && arr[0] ? arr[0] : null;
      if (item) { try { upsert_change_request(item); } catch {} return item; }
    }
  }
  const rec = getLocal(id);
  if (!rec) return null;
  return {
    id: rec.id,
    location_id: rec.payload?.location_id || null,
    changes: rec.payload?.changes || {},
    status: rec.status,
    created_at: rec.created_at,
    owner_signoff: Boolean(rec.payload?.owner_signoff || false),
    checks: rec.checks || {},
    review_note: rec.review_note || null,
    created_by_email: rec.created_by_email || null,
  };
}


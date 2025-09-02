import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { persist_dir, load_json, save_json_atomic } from './persist.js';

const store = new Map();
const STATE_FILE = path.join(persist_dir(), 'change_requests.json');

function save_state() {
  const arr = Array.from(store.values());
  save_json_atomic(STATE_FILE, arr);
}

// bootstrap from disk if exists
try {
  const arr = load_json(STATE_FILE, []);
  if (Array.isArray(arr)) {
    for (const rec of arr) {
      if (rec && rec.id) store.set(rec.id, rec);
    }
  }
} catch {}

export function create_change_request(payload) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const rec = {
    id,
    status: 'submitted',
    created_at: now,
    updated_at: now,
    payload: payload || {},
    checks: {},
    created_by_email: null,
  };
  store.set(id, rec);
  save_state();
  return rec;
}

export function list_change_requests() {
  return Array.from(store.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function get_change_request(id) {
  return store.get(id) || null;
}

export function set_status(id, status) {
  const rec = store.get(id);
  if (!rec) return null;
  rec.status = status;
  rec.updated_at = new Date().toISOString();
  save_state();
  return rec;
}

export function set_status_and_reason(id, status, reason) {
  const rec = store.get(id);
  if (!rec) return null;
  rec.status = status;
  if (typeof reason === 'string') {
    rec.review_note = reason;
  }
  rec.updated_at = new Date().toISOString();
  save_state();
  return rec;
}

export function set_checks(id, checks) {
  const rec = store.get(id);
  if (!rec) return null;
  rec.checks = checks || {};
  rec.updated_at = new Date().toISOString();
  save_state();
  return rec;
}

// Upsert from external (e.g., Supabase) shape
export function upsert_change_request(row) {
  try {
    if (!row || !row.id) return null;
    const id = row.id;
    const exists = store.get(id) || {};
    const rec = {
      id,
      status: row.status || exists.status || 'submitted',
      created_at: row.created_at || exists.created_at || new Date().toISOString(),
      updated_at: row.updated_at || exists.updated_at || row.created_at || new Date().toISOString(),
      payload: {
        location_id: row.location_id || exists.payload?.location_id || null,
        changes: row.changes || exists.payload?.changes || {},
        owner_signoff: typeof row.owner_signoff === 'boolean' ? row.owner_signoff : (exists.payload?.owner_signoff || false),
      },
      checks: row.checks || exists.checks || {},
      review_note: row.review_note || exists.review_note || null,
      created_by_email: row.created_by_email || exists.created_by_email || null,
    };
    store.set(id, rec);
    save_state();
    return rec;
  } catch {
    return null;
  }
}

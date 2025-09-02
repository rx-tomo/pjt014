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

import { randomUUID } from 'node:crypto';

const store = new Map();

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
  };
  store.set(id, rec);
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
  return rec;
}

export function set_checks(id, checks) {
  const rec = store.get(id);
  if (!rec) return null;
  rec.checks = checks || {};
  rec.updated_at = new Date().toISOString();
  return rec;
}

const store = new Map();

function ttl_ms(ttlSeconds) {
  return Date.now() + ttlSeconds * 1000;
}

export function create_session(data, ttlSeconds = 3600) {
  const sid = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  store.set(sid, { data, exp: ttl_ms(ttlSeconds) });
  return sid;
}

export function get_session(sid) {
  const it = store.get(sid);
  if (!it) return null;
  if (Date.now() > it.exp) {
    store.delete(sid);
    return null;
  }
  return it.data;
}

export function destroy_session(sid) {
  store.delete(sid);
}


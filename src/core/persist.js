import fs from 'node:fs';
import path from 'node:path';

export function persist_dir() {
  const dir = process.env.PERSIST_DIR || path.join('tmp', 'state');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

export function load_json(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save_json_atomic(file, data) {
  try {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp.' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}


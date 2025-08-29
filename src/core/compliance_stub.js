// Simple compliance checker: loads NG rules from config with safe fallback
import fs from 'node:fs';
import path from 'node:path';

let COMPILED_RULES = null;

function load_rules() {
  // Attempt to load JSON rules from config/compliance_rules.json
  try {
    const p = path.resolve('config/compliance_rules.json');
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(raw)) {
        return raw.map((r) => ({
          key: String(r.key || ''),
          label: String(r.label || r.key || ''),
          patterns: Array.isArray(r.patterns)
            ? r.patterns
                .map((pat) => {
                  try {
                    if (typeof pat === 'string') return new RegExp(pat, 'gi');
                    if (pat && typeof pat.pattern === 'string') return new RegExp(pat.pattern, pat.flags || 'gi');
                  } catch {}
                  return null;
                })
                .filter(Boolean)
            : [],
        }));
      }
    }
  } catch {}
  // Fallback defaults
  return [
    { key: 'overclaim', label: '過大表現', patterns: [/絶対/gi, /完全に治る/gi, /No\.?1/gi, /最高/gi, /最安/gi] },
    { key: 'privacy', label: '個人情報', patterns: [/氏名/gi, /電話番号/gi, /住所/gi] },
    { key: 'before_after', label: 'ビフォーアフター', patterns: [/ビフォー/gi, /アフター/gi, /before after/gi] },
  ];
}

function rules() {
  if (!COMPILED_RULES) COMPILED_RULES = load_rules();
  return COMPILED_RULES;
}

export function check_text(text) {
  if (!text) return [];
  const hits = [];
  for (const rule of rules()) {
    for (const re of rule.patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        hits.push({ key: rule.key, label: rule.label, match: m[0], index: m.index });
      }
    }
  }
  return hits;
}

export function check_changes(changes) {
  const out = {};
  if (changes?.description) out.description = check_text(String(changes.description));
  return out;
}

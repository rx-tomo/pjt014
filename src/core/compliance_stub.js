// Simple compliance checker (stub): searches for risky phrases in text fields

const RULES = [
  { key: 'overclaim', label: '過大表現', patterns: [/絶対/gi, /完全に治る/gi, /No\.?1/gi, /最高/gi, /最安/gi] },
  { key: 'privacy', label: '個人情報', patterns: [/氏名/gi, /電話番号/gi, /住所/gi] },
  { key: 'before_after', label: 'ビフォーアフター', patterns: [/ビフォー/gi, /アフター/gi, /before after/gi] },
];

export function check_text(text) {
  if (!text) return [];
  const hits = [];
  for (const rule of RULES) {
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


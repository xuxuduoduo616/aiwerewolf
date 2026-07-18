#!/usr/bin/env node
// scripts/sanitize-speech-corpus.mjs
//
// Deterministic corpus sanitizer for the ai-speech-roster-name-fix card (H1).
//
// The AIWolf-scraped pools in src/data/*_speeches.json contain out-of-roster
// entities: raw `Agent[XX]` references and known AIWolf personal names (the
// shared list lives in src/diagnostics/aiwolf-entities.json). This script
// rewrites every pool in place:
//
//   - entries with no foreign entity          → kept unchanged
//   - entries with 1–2 distinct entities      → every entity occurrence is
//     replaced with a seat-neutral placeholder in the entry's own language
//     (en "that player" / zh "那位玩家" / ja "あの人"; a second distinct
//     entity gets "the other player" / "另一位玩家" / "もう一人"), so the
//     sentence stays coherent. A foreign name is NEVER mapped onto a real
//     playerId or seat number.
//   - dropped entries (sanitization would gut them):
//       self-intro   — the speaker introduces themself by a foreign name
//                      ("I'm Midori", "私はサクラ", "サクラです", "我是…")
//       many-refs    — 3+ distinct entities (placeholders become ambiguous)
//       gutted       — non-entity content shorter than 10 meaningful chars
//       residual     — safety net: entity patterns still match after
//                      replacement (never expected; guards regex drift)
//
// Plain Node, zero dependencies, deterministic and idempotent: re-running on
// sanitized pools is a no-op. Verify with:
//   node scripts/speech-corpus-name-audit.mjs   (must exit 0 afterwards)
//
// Also rewrites src/data/library_summary.json to the post-sanitization entry
// count of each pool.
//
// Usage: node scripts/sanitize-speech-corpus.mjs

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(REPO_ROOT, 'src/data');
const ENTITIES_PATH = join(REPO_ROOT, 'src/diagnostics/aiwolf-entities.json');
const SUMMARY_PATH = join(DATA_DIR, 'library_summary.json');

const { latinNames, katakanaNames } = JSON.parse(readFileSync(ENTITIES_PATH, 'utf8'));

// Same boundary rules as src/diagnostics/nameDetector.ts and
// scripts/speech-corpus-name-audit.mjs. The katakana matcher additionally
// absorbs a trailing honorific so 「サクラさん」 sanitizes to 「あの人」, not
// 「あの人さん」.
const AGENT_RE = /Agent\s*\[\s*\d+\s*\]/g;
const latinRes = latinNames.map((name) => ({
  name,
  re: new RegExp(`(?<![A-Za-z])${name}(?![a-z])`, 'g'),
}));
const katakanaRes = katakanaNames.map((name) => ({
  name,
  re: new RegExp(`(?<![ァ-ヶー])${name}(?:さん|くん|ちゃん|君|氏)?(?![ァ-ヶー])`, 'g'),
}));

// Audit-exact patterns (no honorific absorption) for the post-replacement
// residual safety check.
const auditRes = [
  { name: 'Agent', re: AGENT_RE },
  ...latinNames.map((name) => ({ name, re: new RegExp(`(?<![A-Za-z])${name}(?![a-z])`, 'g') })),
  ...katakanaNames.map((name) => ({ name, re: new RegExp(`(?<![ァ-ヶー])${name}(?![ァ-ヶー])`, 'g') })),
];

const PLACEHOLDERS = {
  en: ['that player', 'the other player'],
  zh: ['那位玩家', '另一位玩家'],
  ja: ['あの人', 'もう一人'],
};

/** All entity matches with positions, longest-first per position, no overlaps. */
const collectMatches = (text) => {
  const raw = [];
  for (const m of text.matchAll(AGENT_RE)) {
    raw.push({ start: m.index, end: m.index + m[0].length, key: m[0].replace(/\s+/g, '') });
  }
  for (const { name, re } of [...latinRes, ...katakanaRes]) {
    for (const m of text.matchAll(re)) {
      raw.push({ start: m.index, end: m.index + m[0].length, key: name });
    }
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const matches = [];
  let lastEnd = -1;
  for (const m of raw) {
    if (m.start >= lastEnd) {
      matches.push(m);
      lastEnd = m.end;
    }
  }
  return matches;
};

/** Entry text with all entity matches removed (for language/gut checks). */
const stripMatches = (text, matches) => {
  let out = '';
  let pos = 0;
  for (const m of matches) {
    out += text.slice(pos, m.start);
    pos = m.end;
  }
  return out + text.slice(pos);
};

/** Language of the non-entity part of the text (decides placeholder wording). */
const detectLang = (text, matches) => {
  const stripped = stripMatches(text, matches);
  if (/[ぁ-ゟ゠-ヿ]/.test(stripped)) return 'ja';
  const cjk = (stripped.match(/[一-鿿㐀-䶿]/g) || []).length;
  const counted = stripped.replace(/\s+/g, '').length;
  if (counted > 0 && cjk / counted > 0.3) return 'zh';
  return 'en';
};

const SELF_INTRO_PREFIX =
  /(?:\b(?:i am|i'm|my name is|call me)|(?:私|僕|俺|わたし|あたし)は|我是|我叫)\s*$/i;
const SELF_INTRO_SUFFIX = /^(?:です|だよ|と申します)/;

const isSelfIntro = (text, matches) =>
  matches.some(
    (m) =>
      SELF_INTRO_PREFIX.test(text.slice(Math.max(0, m.start - 16), m.start)) ||
      SELF_INTRO_SUFFIX.test(text.slice(m.end)),
  );

const AT_SENTENCE_START = /(?:^|[.!?！？。]["')\]]?\s*)$/;

const sanitizeText = (text, matches, lang) => {
  const distinct = [...new Set(matches.map((m) => m.key))];
  let out = '';
  let pos = 0;
  for (const m of matches) {
    out += text.slice(pos, m.start);
    let ph = PLACEHOLDERS[lang][distinct.indexOf(m.key)];
    if (lang === 'en' && AT_SENTENCE_START.test(out)) {
      ph = ph[0].toUpperCase() + ph.slice(1);
    }
    out += ph;
    pos = m.end;
  }
  return out + text.slice(pos);
};

const pools = readdirSync(DATA_DIR).filter((f) => f.endsWith('_speeches.json')).sort();

const summary = {};
const rows = [];

for (const file of pools) {
  const entries = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
  const kept = [];
  const stats = { clean: 0, sanitized: 0, selfIntro: 0, manyRefs: 0, gutted: 0, residual: 0 };

  for (const entry of entries) {
    const text = entry.text || '';
    const matches = collectMatches(text);

    if (matches.length === 0) {
      kept.push(entry);
      stats.clean += 1;
      continue;
    }
    if (isSelfIntro(text, matches)) {
      stats.selfIntro += 1;
      continue;
    }
    const distinct = new Set(matches.map((m) => m.key));
    if (distinct.size > 2) {
      stats.manyRefs += 1;
      continue;
    }
    const residualContent = stripMatches(text, matches).replace(/[\s\p{P}\p{S}]+/gu, '');
    if (residualContent.length < 10) {
      stats.gutted += 1;
      continue;
    }

    const sanitized = sanitizeText(text, matches, detectLang(text, matches));
    if (auditRes.some(({ re }) => { re.lastIndex = 0; return re.test(sanitized); })) {
      stats.residual += 1;
      continue;
    }
    kept.push({ ...entry, text: sanitized });
    stats.sanitized += 1;
  }

  writeFileSync(join(DATA_DIR, file), JSON.stringify(kept, null, 2), 'utf8');
  const roleKey = file.replace('_speeches.json', '').toUpperCase();
  summary[roleKey] = kept.length;
  rows.push({ file, before: entries.length, after: kept.length, ...stats });
}

// library_summary.json: post-sanitization entry count per pool, same key order
// as the previous file (VILLAGER, WEREWOLF, SEER, POSSESSED, BODYGUARD, MEDIUM).
const KEY_ORDER = ['VILLAGER', 'WEREWOLF', 'SEER', 'POSSESSED', 'BODYGUARD', 'MEDIUM'];
const ordered = {};
for (const key of KEY_ORDER) if (key in summary) ordered[key] = summary[key];
for (const key of Object.keys(summary)) if (!(key in ordered)) ordered[key] = summary[key];
writeFileSync(SUMMARY_PATH, JSON.stringify(ordered, null, 2), 'utf8');

console.log('Speech-corpus sanitization (H1) — per-pool results');
console.log('pool                        before   after   clean  sanitized  self-intro  many-refs  gutted  residual');
for (const r of rows) {
  console.log(
    `${r.file.padEnd(26)} ${String(r.before).padStart(7)} ${String(r.after).padStart(7)} ` +
    `${String(r.clean).padStart(7)} ${String(r.sanitized).padStart(10)} ${String(r.selfIntro).padStart(11)} ` +
    `${String(r.manyRefs).padStart(10)} ${String(r.gutted).padStart(7)} ${String(r.residual).padStart(9)}`,
  );
}
const dropped = rows.reduce((n, r) => n + r.before - r.after, 0);
console.log(`TOTAL entries: ${rows.reduce((n, r) => n + r.before, 0)} → ${rows.reduce((n, r) => n + r.after, 0)} (dropped ${dropped})`);
console.log('Verify with: node scripts/speech-corpus-name-audit.mjs');

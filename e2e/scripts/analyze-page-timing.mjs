#!/usr/bin/env node
/**
 * Summarize E2E_PAGE_TIMING=1 jsonl: per-test page dwell + cut opportunities.
 * Usage: node scripts/analyze-page-timing.mjs [path/to/page-timing.jsonl]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const input =
  process.argv[2] || path.resolve(__dirname, '..', 'playwright-report', 'page-timing.jsonl');

const SLOW_PAGE_MS = 8_000;
const SETUPISH =
  /prepare|admin\/login|\/login$|settings\/project_storages|work_packages\/\d+\/files|oauth|authorize|grant/i;

function pageKind(host, p) {
  if (host.includes('nextcloud')) {
    if (/\/login/.test(p)) return 'NC login';
    if (/settings\/user\/openproject/.test(p)) return 'NC personal OP settings';
    if (/settings\/admin\/openproject/.test(p)) return 'NC admin OP settings';
    if (/settings\/apps/.test(p)) return 'NC apps';
    if (/apps\/dashboard/.test(p)) return 'NC dashboard';
    if (/apps\/files/.test(p)) return 'NC files';
    if (/apps\/spreed|\/call\//.test(p)) return 'NC Talk';
    if (/apps\/text|viewer/.test(p)) return 'NC Text/viewer';
    return `NC ${p}`;
  }
  if (host.includes('openproject')) {
    if (/\/login/.test(p)) return 'OP login';
    if (/oauth\/authorize|oauth_clients/.test(p)) return 'OP OAuth authorize';
    if (/work_packages\/\d+\/files/.test(p)) return 'OP WP Files tab';
    if (/work_packages/.test(p)) return 'OP work package';
    if (/project_storages|storages/.test(p)) return 'OP storage settings';
    if (/projects\//.test(p)) return 'OP project';
    return `OP ${p}`;
  }
  if (host.includes('keycloak')) return 'Keycloak';
  return `${host}${p}`;
}

function mergeSegments(segments) {
  const map = new Map();
  for (const s of segments) {
    const kind = pageKind(s.host, s.path);
    const prev = map.get(kind) || { kind, ms: 0, visits: 0, urls: new Set() };
    prev.ms += s.ms;
    prev.visits += 1;
    prev.urls.add(s.url);
    map.set(kind, prev);
  }
  return [...map.values()]
    .map((x) => ({ ...x, urls: [...x.urls] }))
    .sort((a, b) => b.ms - a.ms);
}

function cutHint(kind, ms, testTitle) {
  if (ms < SLOW_PAGE_MS) return null;
  const hints = [];
  if (/OP login|NC login/.test(kind)) {
    hints.push(
      'Likely setup hop (prepareIntegrationUser / clearCookies). Prefer API ensure* and skip UI login when already connected.',
    );
  }
  if (/OP storage settings|OP WP Files tab/.test(kind)) {
    hints.push(
      'Storage/Files OAuth bootstrap — skip for ecosystem-only specs; use waitForNextcloudStorageHealthy + ensureOauth2AmpfWebDavAccess APIs.',
    );
  }
  if (/NC personal OP settings/.test(kind) && /Universal Search|Header|Dashboard|Widget|Smart|Personal Settings/.test(testTitle)) {
    hints.push(
      'Personal settings visited in setup and again in Squash steps — collapse to one session or API-toggle prefs if available.',
    );
  }
  if (/OP OAuth authorize|Keycloak/.test(kind)) {
    hints.push('OAuth consent cannot be fully API-replaced; cache connection and short-circuit when Disconnect already visible.');
  }
  if (ms >= 20_000) {
    hints.push('Very long dwell — check fixed sleeps / waitForResponse timeouts and whether navigation can start earlier (Promise.all click+wait).');
  }
  if (hints.length === 0) {
    hints.push('Review waits on this page; consider navigating to the next step as soon as the required control is visible.');
  }
  return hints.join(' ');
}

if (!fs.existsSync(input)) {
  console.error('Missing', input);
  process.exit(1);
}

const lines = fs.readFileSync(input, 'utf8').trim().split('\n').filter(Boolean);
const tests = lines.map((l) => JSON.parse(l));

const summary = tests.map((t) => {
  const byPage = mergeSegments(t.segments || []);
  const slow = byPage
    .filter((p) => p.ms >= SLOW_PAGE_MS)
    .map((p) => ({
      ...p,
      sec: +(p.ms / 1000).toFixed(1),
      cut: cutHint(p.kind, p.ms, t.title),
    }));
  return {
    title: t.title,
    file: path.relative(path.resolve(__dirname, '..'), t.file),
    status: t.status,
    durationSec: +(t.durationMs / 1000).toFixed(1),
    byPage: byPage.map((p) => ({ kind: p.kind, sec: +(p.ms / 1000).toFixed(1), visits: p.visits })),
    slow,
  };
});

const outPath = path.resolve(path.dirname(input), 'page-timing-summary.json');
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), thresholdMs: SLOW_PAGE_MS, tests: summary }, null, 2));

console.log(`Tests: ${summary.length}`);
console.log(`Wrote ${outPath}\n`);
for (const t of summary.sort((a, b) => b.durationSec - a.durationSec)) {
  console.log(`\n=== ${t.status} ${t.durationSec}s — ${t.title}`);
  console.log(`    ${t.file}`);
  for (const p of t.byPage.slice(0, 12)) {
    const flag = p.sec >= SLOW_PAGE_MS / 1000 ? ' SLOW' : '';
    console.log(`    ${String(p.sec).padStart(6)}s x${p.visits}  ${p.kind}${flag}`);
  }
  for (const s of t.slow) {
    console.log(`    CUT? ${s.kind} (${s.sec}s): ${s.cut}`);
  }
}

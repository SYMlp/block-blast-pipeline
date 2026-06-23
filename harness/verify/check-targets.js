// Harness — verification layer. Closes the human↔parameter loop: reads each
// variant's intent.targets (the human-feel bands it CLAIMS to hit) and checks
// them against the proxies the headless sim actually MEASURED (last-run.json).
//
// Semantics: this is the FIRST of a two-stage pipeline (headless gate → human
// A/B). A variant whose every proxy lands inside its declared double-cliff band
// is PROMOTED (worth a real-player test); one with any proxy out of band is
// REJECTED (its hypothesis is refuted before burning a human A/B slot — the
// same idea as Block Blast's ~97% A/B failure rate, made automatic and cheap).
//
// A REJECT is a SUCCESSFUL gate outcome, not a build error — so this exits 0 by
// default and just reports. Two ways to make it fail a build:
//   --strict             exit 1 if ANYTHING is rejected (used by the agent loop:
//                        "don't promote a candidate that failed its own gate").
//   --check-expectations exit 1 only when an actual verdict ≠ the variant's
//                        declared intent.expect. This is the CI guard: a variant
//                        designed to PROMOTE that now REJECTs (or vice-versa) is
//                        a regression. relaxed declares expect:REJECT, so the
//                        deliberate counter-example does NOT redden CI — only a
//                        genuine verdict drift does.
// Variants with no intent block are skipped (not yet migrated to 3-layer DSL).
// Run: node harness/verify/check-targets.js [variant_id] [--strict|--check-expectations]

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const VARIANTS_DIR = join(ROOT, 'config', 'variants');
const LAST_RUN = join(ROOT, 'harness', 'sim', 'last-run.json');

// intent.targets proxy name -> field on a sim variant-result object.
const PROXY_FIELD = {
  rescueRate: 'rescueRate',
  clearRate: 'clearRate',
  rewardEntropy: 'rewardEntropy',
  stepsP90: 'stepsP90',
  stepsMedian: 'stepsMedian',
  avgEndOccupancy: 'avgEndOccupancy',
  avgScore: 'avgScore',
  avgSteps: 'avgSteps',
  avgLines: 'avgLines',
};

function inBand(value, [lo, hi]) {
  if (lo != null && value < lo) return false;
  if (hi != null && value > hi) return false;
  return true;
}

function fmtBand([lo, hi]) {
  return `[${lo == null ? '−∞' : lo}, ${hi == null ? '+∞' : hi}]`;
}

function main() {
  const strict = process.argv.includes('--strict');
  const checkExpectations = process.argv.includes('--check-expectations');
  const only = process.argv.slice(2).find((a) => !a.startsWith('--')) || null;

  let run;
  try {
    run = JSON.parse(readFileSync(LAST_RUN, 'utf8'));
  } catch {
    console.error(`No ${LAST_RUN}. Run \`npm run sim\` first.`);
    process.exit(2);
  }
  const measuredById = Object.fromEntries(run.variants.map((v) => [v.id, v]));
  const files = readdirSync(VARIANTS_DIR).filter((f) => f.endsWith('.json'));

  const pad = (s, n) => String(s).padEnd(n);
  let promoted = 0;
  let rejected = 0;
  let skipped = 0;
  let noData = 0;
  const mismatches = [];

  for (const file of files) {
    const cfg = JSON.parse(readFileSync(join(VARIANTS_DIR, file), 'utf8'));
    if (only && cfg.variant_id !== only) continue;
    if (!cfg.intent || !cfg.intent.targets) { skipped++; continue; }
    const measured = measuredById[cfg.variant_id];
    if (!measured) {
      console.error(`  [no sim data] ${cfg.variant_id} — run the sim for it first.`);
      noData++;
      continue;
    }

    let variantFails = 0;
    const rows = [];
    for (const t of cfg.intent.targets) {
      const field = PROXY_FIELD[t.proxy];
      const val = field != null ? measured[field] : undefined;
      const ok = val != null && inBand(val, t.band);
      if (!ok) variantFails++;
      rows.push({ t, val, ok });
    }
    const verdict = variantFails === 0 ? 'PROMOTE' : 'REJECT';
    if (variantFails === 0) promoted++; else rejected++;

    const expect = cfg.intent.expect || null;
    const drift = expect && expect !== verdict;
    if (drift) mismatches.push({ id: cfg.variant_id, expect, verdict });

    const expectTag = expect ? `  [expect ${expect}${drift ? ' ✗ DRIFT' : ' ✓'}]` : '';
    console.log(`\n● ${cfg.variant_id} → ${verdict}${variantFails ? ` (${variantFails} target(s) out of band)` : ''}${expectTag}`);
    console.log(`  假设: ${cfg.intent.hypothesis}`);
    console.log('  ' + pad('proxy', 16) + pad('measured', 11) + pad('band', 15) + pad('verdict', 8) + 'represents');
    console.log('  ' + '-'.repeat(98));
    for (const { t, val, ok } of rows) {
      console.log(
        '  ' + pad(t.proxy, 16) + pad(typeof val === 'number' ? val.toFixed(3) : String(val), 11) +
        pad(fmtBand(t.band), 15) + pad(ok ? 'PASS' : '✗ FAIL', 8) + t.represents
      );
    }
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log(`门禁裁决: ${promoted} 放行至真人 A/B  ·  ${rejected} 被淘汰` +
    (skipped ? `  ·  ${skipped} 未迁三层(跳过)` : '') + (noData ? `  ·  ${noData} 缺 sim 数据` : ''));
  if (noData > 0) process.exit(2);
  if (checkExpectations && mismatches.length > 0) {
    console.error(`\n--check-expectations: ${mismatches.length} verdict regression(s) → CI blocked.`);
    for (const m of mismatches) console.error(`  ${m.id}: expected ${m.expect}, measured ${m.verdict}`);
    process.exit(1);
  }
  if (strict && rejected > 0) {
    console.error(`--strict: ${rejected} variant(s) rejected → CI blocked.`);
    process.exit(1);
  }
  process.exit(0);
}

main();

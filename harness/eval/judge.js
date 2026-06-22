// Harness Layer 3 — LLM-as-Judge skeleton (bonus layer).
// Feeds rubric.md + a variant's config + its sim metrics to `claude -p` and
// parses back the JSON verdict. This is a SKELETON: the prompt assembly and
// claude invocation are real, but it is not wired into CI and is expected to
// be run manually. Gate threshold: min_score >= 7.
//
// Auth note: we shell out to the `claude` CLI, NOT the Anthropic SDK — the user
// has no API key and runs Claude Code under an OAuth subscription login. A
// stale machine-level ANTHROPIC_API_KEY (no credit) would otherwise hijack the
// CLI and fail with "Credit balance is too low", so we pop it from the
// subprocess env to force the OAuth path. (See user global rules.)

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function claudeEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force OAuth subscription, not the dead key
  return env;
}

function buildPrompt(variantConfig, simMetrics) {
  const rubric = readFileSync(join(__dirname, 'rubric.md'), 'utf8');
  return [
    'You are a code-review judge in an automated harness. Score the variant below',
    'strictly per the rubric. Return ONLY the JSON object from the output contract.',
    '',
    '=== RUBRIC ===',
    rubric,
    '',
    '=== VARIANT CONFIG ===',
    JSON.stringify(variantConfig, null, 2),
    '',
    '=== SIM METRICS (vs control baseline) ===',
    JSON.stringify(simMetrics, null, 2),
  ].join('\n');
}

export function judgeVariant(variantConfig, simMetrics, { model = 'sonnet' } = {}) {
  const prompt = buildPrompt(variantConfig, simMetrics);
  // prompt via stdin avoids shell escaping/injection of the rubric text.
  const proc = spawnSync(
    'claude',
    ['-p', '--output-format', 'text', '--model', model],
    { input: prompt, env: claudeEnv(), encoding: 'utf8', shell: process.platform === 'win32' }
  );
  if (proc.status !== 0) {
    throw new Error(`claude CLI failed (exit ${proc.status}): ${proc.stdout || proc.stderr}`);
  }
  const match = proc.stdout.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`no JSON verdict in judge output:\n${proc.stdout}`);
  return JSON.parse(match[0]);
}

// CLI: node harness/eval/judge.js <variant-id>  (manual use, not in CI)
if (process.argv[1] && process.argv[1].endsWith('judge.js')) {
  const id = process.argv[2] || 'compact';
  const config = JSON.parse(readFileSync(join(__dirname, '..', '..', 'config', 'variants', `${id}.json`), 'utf8'));
  // In a full run these metrics come from headless-sim; placeholder here.
  const metrics = { note: 'run headless-sim and pass its output here' };
  const verdict = judgeVariant(config, metrics);
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.min_score >= 7 ? 0 : 1);
}

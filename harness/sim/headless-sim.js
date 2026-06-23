// Harness Layer 2 — headless integration sim. A deterministic greedy agent
// plays N full games per variant in Node (no DOM). Purpose: a regression gate
// (0 crashes, every step under one frame's budget) plus a measured BEHAVIOR
// FINGERPRINT per variant, so config-driven differences are observed, not
// asserted. The agent is intentionally simple — a fuzzer/probe for engine
// robustness, not a player-skill model.
//
// The fingerprint is the raw material the DSL's verification layer reads to
// check whether a variant's parameter change actually moved the human-feel
// PROXY it claimed to. Computable proxies (deterministic, no real player):
//   avgScore/avgSteps/avgLines — output magnitude
//   clearRate        — clears per step      → "整理成秩序" 的节拍密度
//   avgEndOccupancy  — board fill at game over → 死得"公平"(满)还是被卡死(空)
//   stepsMedian/P90  — session length spread → 可中断性 / 节奏
//   avgMaxCombo      — peak combo (WEAK proxy: greedy agent rarely chains)
// Arousal-type feels (爽快/紧张) are NOT here — they need real players.
// Run: node harness/sim/headless-sim.js [--games 200] [--variant id]

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { GameEngine, makeRng } from '../../engine/GameEngine.js';
import { clearLines, cloneBoard, canPlace, place } from '../../engine/board.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VARIANTS_DIR = join(__dirname, '..', '..', 'config', 'variants');
// Discover variants from disk so AI-generated ones are auto-included (no
// hardcoded list to keep in sync with the generator).
const ALL_VARIANTS = readdirSync(VARIANTS_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

function loadConfig(id) {
  return JSON.parse(readFileSync(join(VARIANTS_DIR, `${id}.json`), 'utf8'));
}

function parseArgs(argv) {
  const args = { games: 200, variant: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--games') args.games = parseInt(argv[++i], 10);
    else if (argv[i] === '--variant') args.variant = argv[++i];
  }
  return args;
}

// Greedy policy: for the current tray, simulate every legal placement on a
// board copy, count how many lines it would clear, and pick the max. Ties
// broken by lowest resulting occupancy (keep the board open). Deterministic.
function chooseMove(engine) {
  const moves = engine.legalMoves();
  if (moves.length === 0) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const piece = engine.tray[m.trayIndex];
    const board = cloneBoard(engine.board);
    place(board, piece.shape, m.row, m.col, piece.color);
    const { lineCount } = clearLines(board);
    let filled = 0;
    for (const row of board) for (const v of row) if (v !== -1) filled++;
    // Reward line clears heavily, then prefer leaving fewer occupied cells.
    const heuristic = lineCount * 1000 - filled;
    if (heuristic > bestScore) { bestScore = heuristic; best = m; }
  }
  return best;
}

function playOneGame(config, seed, maxSteps = 5000) {
  const eng = new GameEngine(config, { rng: makeRng(seed) });
  let crashed = false;
  let maxStepMs = 0;
  let clearEvents = 0; // placements that cleared >=1 line (for clearRate)
  let maxCombo = 0;
  const clearHist = {}; // lineCount -> occurrences (reward-surprise distribution)
  try {
    while (!eng.gameOver && eng.steps < maxSteps) {
      const t0 = performance.now();
      const move = chooseMove(eng);
      if (!move) break;
      const res = eng.applyMove(move.trayIndex, move.row, move.col);
      const dt = performance.now() - t0;
      if (dt > maxStepMs) maxStepMs = dt;
      if (res && res.lineCount > 0) {
        clearEvents++;
        clearHist[res.lineCount] = (clearHist[res.lineCount] || 0) + 1;
      }
      if (res && res.combo > maxCombo) maxCombo = res.combo;
    }
  } catch (err) {
    crashed = true;
    console.error(`  [CRASH] variant=${config.variant_id} seed=${seed}: ${err.message}`);
  }
  // endOccupancy: how full the board was when the game ended. High = died
  // "fairly" (board genuinely filled up); low = died with room. (Empirically a
  // WEAK proxy here — the greedy agent flattens it across variants.)
  return {
    score: eng.score, steps: eng.steps, lines: eng.linesCleared, crashed, maxStepMs,
    clearEvents, maxCombo, endOccupancy: eng.occupancy(),
    refillCount: eng.refillCount, refillRescues: eng.refillRescues, clearHist,
  };
}

// p-th percentile of an already-sorted ascending array.
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function runVariant(id, games) {
  const config = loadConfig(id);
  let crashes = 0;
  let totalScore = 0;
  let totalSteps = 0;
  let totalLines = 0;
  let worstStepMs = 0;
  let totalClearEvents = 0;
  let totalEndOcc = 0;
  let totalMaxCombo = 0;
  let totalRefillCount = 0;
  let totalRefillRescues = 0;
  const histAll = {};
  const stepsArr = [];
  for (let g = 0; g < games; g++) {
    // seed = g+1 so runs are reproducible and each game differs.
    const r = playOneGame(config, g + 1);
    if (r.crashed) crashes++;
    totalScore += r.score;
    totalSteps += r.steps;
    totalLines += r.lines;
    if (r.maxStepMs > worstStepMs) worstStepMs = r.maxStepMs;
    totalClearEvents += r.clearEvents;
    totalEndOcc += r.endOccupancy;
    totalMaxCombo += r.maxCombo;
    totalRefillCount += r.refillCount;
    totalRefillRescues += r.refillRescues;
    for (const k in r.clearHist) histAll[k] = (histAll[k] || 0) + r.clearHist[k];
    stepsArr.push(r.steps);
  }
  stepsArr.sort((a, b) => a - b);
  // reward-surprise entropy: Shannon entropy (bits) over the distribution of
  // clear sizes. Always-1-line => 0 bits (predictable = boring); varied clear
  // sizes => higher bits (more "better-than-expected" dopamine surprise).
  const histCounts = Object.values(histAll);
  const histTotal = histCounts.reduce((a, b) => a + b, 0);
  let rewardEntropy = 0;
  if (histTotal > 0) {
    for (const c of histCounts) { const p = c / histTotal; rewardEntropy -= p * Math.log2(p); }
  }
  return {
    id,
    games,
    crashes,
    avgScore: totalScore / games,
    avgSteps: totalSteps / games,
    avgLines: totalLines / games,
    // behavior fingerprint — verification-layer proxy candidates
    clearRate: totalSteps > 0 ? totalClearEvents / totalSteps : 0,
    rescueRate: totalRefillCount > 0 ? totalRefillRescues / totalRefillCount : 0,
    rewardEntropy,
    avgEndOccupancy: totalEndOcc / games,
    avgMaxCombo: totalMaxCombo / games,
    stepsMedian: percentile(stepsArr, 0.5),
    stepsP90: percentile(stepsArr, 0.9),
    worstStepMs,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const variants = args.variant ? [args.variant] : ALL_VARIANTS;
  console.log(`\nHeadless sim — greedy agent, ${args.games} games/variant\n`);
  const results = [];
  let totalCrashes = 0;
  for (const id of variants) {
    const r = runVariant(id, args.games);
    results.push(r);
    totalCrashes += r.crashes;
  }

  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, n) => v.toFixed(n);

  // Table 1 — gate metrics (output magnitude + per-step cost).
  console.log(pad('variant', 12) + pad('games', 7) + pad('crashes', 9) + pad('avgScore', 11) + pad('avgSteps', 11) + pad('avgLines', 11) + 'maxStep(ms)');
  console.log('-'.repeat(72));
  for (const r of results) {
    console.log(
      pad(r.id, 12) + pad(r.games, 7) + pad(r.crashes, 9) +
      pad(num(r.avgScore, 1), 11) + pad(num(r.avgSteps, 1), 11) +
      pad(num(r.avgLines, 1), 11) + num(r.worstStepMs, 2)
    );
  }
  console.log('-'.repeat(72));

  // Table 2 — behavior fingerprint (the DSL verification layer's proxy menu).
  // v1 anchors: clearRate (boredom/order), rescue% (fairness), rewEnt
  // (surprise), stepMed/P90 (frustration/interruptibility). endOcc kept for
  // honesty — it's the proxy the data culled (flat across variants).
  console.log('\nBehavior fingerprint (verification-layer proxies; v1 anchors first):');
  console.log(pad('variant', 12) + pad('clearRate', 11) + pad('rescue%', 10) + pad('rewEnt', 9) + pad('stepMed', 9) + pad('stepP90', 9) + 'endOcc');
  console.log('-'.repeat(68));
  for (const r of results) {
    console.log(
      pad(r.id, 12) + pad(num(r.clearRate, 3), 11) + pad(num(r.rescueRate, 3), 10) +
      pad(num(r.rewardEntropy, 2), 9) + pad(r.stepsMedian, 9) + pad(r.stepsP90, 9) +
      num(r.avgEndOccupancy, 3)
    );
  }
  console.log('-'.repeat(68));

  const FRAME_MS = 16; // one frame at 60fps — the per-step budget.
  const worstAll = results.reduce((m, r) => Math.max(m, r.worstStepMs), 0);
  const tooSlow = results.filter((r) => r.worstStepMs >= FRAME_MS);
  if (totalCrashes > 0) {
    console.error(`\nGATE FAILED: ${totalCrashes} crash(es) across all variants.`);
    process.exit(1);
  }
  // Persist the run as a structured artifact — the observability panel and the
  // DSL verification layer read this JSON rather than scraping stdout. No
  // timestamp on purpose: the sim is deterministic, so the file is stable
  // across identical runs (clean git diffs).
  const summary = {
    generatedBy: 'headless-sim',
    gamesPerVariant: args.games,
    frameBudgetMs: FRAME_MS,
    gate: { crashes: totalCrashes, worstStepMs: worstAll, passed: totalCrashes === 0 && tooSlow.length === 0 },
    variants: results,
  };
  writeFileSync(join(__dirname, 'last-run.json'), JSON.stringify(summary, null, 2) + '\n');

  if (tooSlow.length > 0) {
    console.error(`\nGATE FAILED: ${tooSlow.length} variant(s) exceeded the ${FRAME_MS}ms/step budget: ` +
      tooSlow.map((r) => `${r.id}(${r.worstStepMs.toFixed(2)}ms)`).join(', '));
    process.exit(1);
  }
  console.log(`\nGATE PASSED: 0 crashes, worst step ${worstAll.toFixed(2)}ms < ${FRAME_MS}ms across ${variants.length} variant(s). → harness/sim/last-run.json`);
}

main();

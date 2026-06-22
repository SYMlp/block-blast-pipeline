// Harness Layer 2 — headless integration sim. A deterministic greedy agent
// plays N full games per variant in Node (no DOM). This is the minimal version
// of Hungry Studio's "Block AI Robot": same idea (an automated player pre-screens
// a variant before it ships), simpler policy (greedy ~60% aligned vs their deep
// model ~80%). Run: node harness/sim/headless-sim.js [--games 200] [--variant id]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { GameEngine, makeRng } from '../../engine/GameEngine.js';
import { clearLines, cloneBoard, canPlace, place } from '../../engine/board.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VARIANTS_DIR = join(__dirname, '..', '..', 'config', 'variants');
const ALL_VARIANTS = ['control', 'compact', 'relaxed', 'hard-mode'];

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
  try {
    while (!eng.gameOver && eng.steps < maxSteps) {
      const t0 = performance.now();
      const move = chooseMove(eng);
      if (!move) break;
      eng.applyMove(move.trayIndex, move.row, move.col);
      const dt = performance.now() - t0;
      if (dt > maxStepMs) maxStepMs = dt;
    }
  } catch (err) {
    crashed = true;
    console.error(`  [CRASH] variant=${config.variant_id} seed=${seed}: ${err.message}`);
  }
  return { score: eng.score, steps: eng.steps, lines: eng.linesCleared, crashed, maxStepMs };
}

function runVariant(id, games) {
  const config = loadConfig(id);
  let crashes = 0;
  let totalScore = 0;
  let totalSteps = 0;
  let totalLines = 0;
  let worstStepMs = 0;
  for (let g = 0; g < games; g++) {
    // seed = g+1 so runs are reproducible and each game differs.
    const r = playOneGame(config, g + 1);
    if (r.crashed) crashes++;
    totalScore += r.score;
    totalSteps += r.steps;
    totalLines += r.lines;
    if (r.maxStepMs > worstStepMs) worstStepMs = r.maxStepMs;
  }
  return {
    id,
    games,
    crashes,
    avgScore: totalScore / games,
    avgSteps: totalSteps / games,
    avgLines: totalLines / games,
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

  if (totalCrashes > 0) {
    console.error(`\nGATE FAILED: ${totalCrashes} crash(es) across all variants.`);
    process.exit(1);
  }
  console.log(`\nGATE PASSED: 0 crashes across ${variants.length} variant(s).`);
}

main();

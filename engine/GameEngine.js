// GameEngine — headless game core. Zero DOM. All parameters from config.
// Drives board + pieces + scorer; the renderer reads its state, the harness
// drives it step by step. Randomness is injected so sims are reproducible.

import { createBoard, canPlace, canPlaceAnywhere, place, clearLines, occupancy, prefillDensity } from './board.js';
import { buildPool, ddaPool, newPiece, COLORS } from './pieces.js';
import { placementScore, clearScore } from './scorer.js';

// Mulberry32 — tiny deterministic PRNG. Same seed => same game.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GameEngine {
  constructor(config, { seed = 1, rng = null } = {}) {
    this.config = config;
    this.width = config.board.width;
    this.height = config.board.height;
    this.previewCount = config.spawn.preview_count ?? 3;
    this.colorCount = COLORS.length;
    this.pool = buildPool(config.spawn);
    this.density = config.spawn.density ?? 0;
    this.difficulty = config.difficulty ?? {};
    this.rng = rng || makeRng(seed);
    this.reset();
  }

  reset() {
    this.board = createBoard(this.width, this.height);
    // density: pre-fill the opening board to a target occupancy. Higher density
    // = more crowded start = harder. prefillDensity guards against completing a
    // line (no instant clear) and against an unplayable opening.
    prefillDensity(this.board, this.density, this.rng);
    this.score = 0;
    this.combo = 0;
    this.gameOver = false;
    this.steps = 0;
    this.linesCleared = 0;
    this.tray = [];
    this.refillTray();
  }

  // Solvability guarantee: keep redrawing until at least one tray piece fits.
  // Mirrors Block Blast's anti-deadlock rule; without it the headless sim
  // would log spurious dead games and poison the metrics.
  refillTray() {
    // DDA: bias the draw pool by current occupancy (crowded → small pieces to
    // rescue, sparse → big pieces to challenge). dda_enabled=false uses the
    // static pool. Pool is recomputed each refill so it tracks the live board.
    const pool = ddaPool(this.pool, occupancy(this.board), this.difficulty);
    const draw = () => Array.from({ length: this.previewCount }, () => newPiece(pool, this.colorCount, this.rng));
    let tray = draw();
    for (let attempt = 0; attempt < 30; attempt++) {
      if (tray.some((p) => canPlaceAnywhere(this.board, p.shape))) break;
      tray = draw();
    }
    this.tray = tray;
  }

  canPlace(piece, row, col) {
    return canPlace(this.board, piece.shape, row, col);
  }

  // Enumerate all legal (trayIndex,row,col) placements. Used by the headless
  // greedy agent and by the "at least one legal move" invariant test.
  legalMoves() {
    const moves = [];
    for (let i = 0; i < this.tray.length; i++) {
      const p = this.tray[i];
      if (!p) continue;
      for (let r = 0; r < this.height; r++) {
        for (let c = 0; c < this.width; c++) {
          if (canPlace(this.board, p.shape, r, c)) moves.push({ trayIndex: i, row: r, col: c });
        }
      }
    }
    return moves;
  }

  // Apply a placement. Returns a result the renderer uses to fire juice.
  // No-op (returns null) if the move is illegal or the game is over.
  applyMove(trayIndex, row, col) {
    if (this.gameOver) return null;
    const piece = this.tray[trayIndex];
    if (!piece || !canPlace(this.board, piece.shape, row, col)) return null;

    place(this.board, piece.shape, row, col, piece.color);
    this.score += placementScore(piece.cellCount, this.config.scoring);
    this.tray[trayIndex] = null;
    this.steps += 1;

    const { lineCount, clearedCells } = clearLines(this.board);
    let gain = 0;
    if (lineCount > 0) {
      this.combo += 1;
      gain = clearScore(lineCount, this.combo, this.config.scoring);
      this.score += gain;
      this.linesCleared += lineCount;
    } else {
      this.combo = 0;
    }

    if (this.tray.every((p) => p === null)) this.refillTray();
    this.checkGameOver();

    return { piece, row, col, lineCount, clearedCells, gain, combo: this.combo };
  }

  checkGameOver() {
    const hasPiece = this.tray.some((p) => p !== null);
    if (hasPiece && !this.tray.some((p) => p && canPlaceAnywhere(this.board, p.shape))) {
      this.gameOver = true;
    }
    return this.gameOver;
  }

  occupancy() {
    return occupancy(this.board);
  }
}

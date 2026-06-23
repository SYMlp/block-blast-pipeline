// GameEngine — headless game core. Zero DOM, zero `cc`. All parameters from
// config; the renderer reads its state, the harness drives it step by step.
// Randomness is injected so sims are reproducible.

import { createBoard, canPlace, canPlaceAnywhere, place, clearLines, occupancy, prefillDensity } from './board';
import { buildPool, ddaPool, newPiece, COLORS } from './pieces';
import { placementScore, clearScore } from './scorer';
import type { Board, Piece, ShapeDef, Rng, GameConfig, DifficultyConfig, MoveResult } from './types';

// Mulberry32 — tiny deterministic PRNG. Same seed => same game.
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EngineOptions {
  seed?: number;
  rng?: Rng | null;
}

export class GameEngine {
  config: GameConfig;
  width: number;
  height: number;
  previewCount: number;
  colorCount: number;
  pool: ShapeDef[];
  density: number;
  difficulty: DifficultyConfig;
  rng: Rng;

  board!: Board;
  score!: number;
  combo!: number;
  gameOver!: boolean;
  steps!: number;
  linesCleared!: number;
  refillCount!: number;
  refillRetries!: number;
  refillRescues!: number;
  tray!: Array<Piece | null>;

  constructor(config: GameConfig, { seed = 1, rng = null }: EngineOptions = {}) {
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

  reset(): void {
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
    // Fairness instrumentation: how often the anti-deadlock safety net had to
    // rescue an unplayable draw. High rescue rate = the RNG would have screwed
    // the player a lot without the net = an "unfair" variant.
    this.refillCount = 0;
    this.refillRetries = 0;
    this.refillRescues = 0;
    this.tray = [];
    this.refillTray();
    // Make the opening-state invariant explicit rather than only implied by
    // prefill guards: if (pathologically) no tray piece fits, flag it now.
    this.checkGameOver();
  }

  // Solvability guarantee: keep redrawing until at least one tray piece fits.
  // Mirrors Block Blast's anti-deadlock rule; without it the headless sim
  // would log spurious dead games and poison the metrics.
  refillTray(): void {
    // DDA: bias the draw pool by current occupancy (crowded → small pieces to
    // rescue, sparse → big pieces to challenge). dda_enabled=false uses the
    // static pool. Pool is recomputed each refill so it tracks the live board.
    const pool = ddaPool(this.pool, occupancy(this.board), this.difficulty);
    const draw = (): Array<Piece | null> =>
      Array.from({ length: this.previewCount }, () => newPiece(pool, this.colorCount, this.rng));
    let tray = draw();
    let retries = 0;
    while (retries < 30 && !tray.some((p) => p && canPlaceAnywhere(this.board, p.shape))) {
      tray = draw();
      retries++;
    }
    this.refillCount++;
    this.refillRetries += retries;
    if (retries > 0) this.refillRescues++;
    this.tray = tray;
  }

  canPlace(piece: Piece, row: number, col: number): boolean {
    return canPlace(this.board, piece.shape, row, col);
  }

  // Enumerate all legal (trayIndex,row,col) placements. Used by the headless
  // greedy agent and by the "at least one legal move" invariant test.
  legalMoves(): Array<{ trayIndex: number; row: number; col: number }> {
    const moves: Array<{ trayIndex: number; row: number; col: number }> = [];
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
  applyMove(trayIndex: number, row: number, col: number): MoveResult | null {
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

  checkGameOver(): boolean {
    const hasPiece = this.tray.some((p) => p !== null);
    if (hasPiece && !this.tray.some((p) => p && canPlaceAnywhere(this.board, p.shape))) {
      this.gameOver = true;
    }
    return this.gameOver;
  }

  occupancy(): number {
    return occupancy(this.board);
  }
}

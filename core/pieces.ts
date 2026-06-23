// Piece data + spawn logic. Pure functions; randomness injected via an `rng`
// callable so the headless sim stays deterministic and reproducible.

import type { ShapeDef, Piece, Rng, SpawnConfig, DifficultyConfig } from './types';

// Each shape is a list of [dr,dc] cell offsets, tagged with `n` = cell count
// so a config's shape_set can filter by size.
export const ALL_SHAPES: ShapeDef[] = [
  { s: [[0, 0]], n: 1 },
  { s: [[0, 0], [0, 1]], n: 2 },
  { s: [[0, 0], [1, 0]], n: 2 },
  { s: [[0, 0], [0, 1], [0, 2]], n: 3 },
  { s: [[0, 0], [1, 0], [2, 0]], n: 3 },
  { s: [[0, 0], [1, 0], [1, 1]], n: 3 },
  { s: [[0, 1], [1, 0], [1, 1]], n: 3 },
  { s: [[0, 0], [0, 1], [1, 0]], n: 3 },
  { s: [[0, 0], [0, 1], [1, 1]], n: 3 },
  { s: [[0, 0], [0, 1], [0, 2], [0, 3]], n: 4 },
  { s: [[0, 0], [1, 0], [2, 0], [3, 0]], n: 4 },
  { s: [[0, 0], [0, 1], [1, 0], [1, 1]], n: 4 },
  { s: [[0, 0], [1, 0], [2, 0], [2, 1]], n: 4 },
  { s: [[0, 1], [1, 1], [2, 0], [2, 1]], n: 4 },
  { s: [[0, 0], [0, 1], [1, 1], [2, 1]], n: 4 },
  { s: [[0, 0], [0, 1], [1, 0], [2, 0]], n: 4 },
  { s: [[0, 0], [1, 0], [1, 1], [2, 1]], n: 4 },
  { s: [[0, 1], [1, 0], [1, 1], [2, 0]], n: 4 },
  { s: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], n: 5 },
  { s: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], n: 5 },
  { s: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], n: 9 },
];

export const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa', '#f783ac', '#3bc9db'];

// Build a weighted draw pool from a config's spawn settings. Big pieces (n>=4)
// get extra weight scaled by big_piece_weight_mult.
export function buildPool(spawn: SpawnConfig): ShapeDef[] {
  const set = spawn.shape_set;
  const mult = spawn.big_piece_weight_mult ?? 1.0;
  let allowed: ShapeDef[];
  if (set === 'minimal') {
    allowed = ALL_SHAPES.filter((x) => x.n <= 4 && x.n !== 9);
  } else if (set === 'extended') {
    allowed = ALL_SHAPES.slice();
  } else {
    // standard: everything except the 3x3 mega block
    allowed = ALL_SHAPES.filter((x) => x.n !== 9);
  }
  const pool: ShapeDef[] = [];
  for (const sh of allowed) {
    const weight = sh.n >= 4 ? Math.max(1, Math.round(2 * mult)) : 2;
    for (let i = 0; i < weight; i++) pool.push(sh);
  }
  return pool;
}

// DDA: re-weight the draw pool by current board occupancy.
// - occupancy > high  → board is crowded → favor SMALL pieces (rescue).
// - occupancy < low   → board is sparse  → favor BIG pieces (challenge).
// - in between (or dda disabled) → the static base pool is used unchanged.
export function ddaPool(basePool: ShapeDef[], occupancy: number, difficulty: DifficultyConfig | undefined): ShapeDef[] {
  if (!difficulty || difficulty.dda_enabled === false) return basePool;
  const high = difficulty.dda_high_occupancy ?? 0.75;
  const low = difficulty.dda_low_occupancy ?? 0.35;

  let smallMult = 1;
  let bigMult = 1;
  if (occupancy > high) {
    smallMult = 3; bigMult = 0; // crowded: only small pieces — pure rescue
  } else if (occupancy < low) {
    smallMult = 0.5; bigMult = 3; // sparse: push big pieces — challenge
  } else {
    return basePool; // neutral band: no adjustment
  }

  const out: ShapeDef[] = [];
  for (const sh of basePool) {
    const isBig = sh.n >= 4;
    const reps = Math.round((isBig ? bigMult : smallMult) * 1);
    for (let i = 0; i < reps; i++) out.push(sh);
  }
  // Never return an empty pool (e.g. bigMult=0 on a pool of only big pieces).
  return out.length > 0 ? out : basePool;
}

// Materialize one piece from the pool. `rng` returns [0,1).
export function newPiece(pool: ShapeDef[], colorCount: number, rng: Rng): Piece {
  const sh = pool[Math.floor(rng() * pool.length)];
  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of sh.s) {
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  return {
    shape: sh.s,
    color: Math.floor(rng() * colorCount),
    rows: maxR + 1,
    cols: maxC + 1,
    cellCount: sh.n,
  };
}

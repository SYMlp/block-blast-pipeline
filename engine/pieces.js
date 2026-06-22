// Piece data + spawn logic. Pure functions; randomness is injected via an
// `rng` callable so the headless sim can be deterministic and reproducible.

// Each shape is a list of [dr,dc] cell offsets, tagged with `n` = cell count
// so a config's shape_set can filter by size.
export const ALL_SHAPES = [
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
export function buildPool(spawn) {
  const set = spawn.shape_set;
  const mult = spawn.big_piece_weight_mult ?? 1.0;
  let allowed;
  if (set === 'minimal') {
    allowed = ALL_SHAPES.filter((x) => x.n <= 4 && x.n !== 9);
  } else if (set === 'extended') {
    allowed = ALL_SHAPES.slice();
  } else {
    // standard: everything except the 3x3 mega block
    allowed = ALL_SHAPES.filter((x) => x.n !== 9);
  }
  const pool = [];
  for (const sh of allowed) {
    const weight = sh.n >= 4 ? Math.max(1, Math.round(2 * mult)) : 2;
    for (let i = 0; i < weight; i++) pool.push(sh);
  }
  return pool;
}

// Materialize one piece from the pool. `rng` returns [0,1).
export function newPiece(pool, colorCount, rng) {
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

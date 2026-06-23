// Board state machine — pure functions, zero DOM, zero `cc`.
// Grid is Cell[height][width]; -1 = empty, >=0 = color index.

import type { Board, Shape, Rng, ClearResult, FullLines } from './types';

export function createBoard(width: number, height: number): Board {
  return Array.from({ length: height }, () => Array<number>(width).fill(-1));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice());
}

// canPlace: every cell of `shape` (offsets [dr,dc]) anchored at (row,col)
// must be in-bounds and empty.
export function canPlace(board: Board, shape: Shape, row: number, col: number): boolean {
  const height = board.length;
  const width = board[0].length;
  for (const [dr, dc] of shape) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || r >= height || c < 0 || c >= width || board[r][c] !== -1) {
      return false;
    }
  }
  return true;
}

export function canPlaceAnywhere(board: Board, shape: Shape): boolean {
  const height = board.length;
  const width = board[0].length;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (canPlace(board, shape, r, c)) return true;
    }
  }
  return false;
}

// place: mutates board in place, writing `color` into each shape cell.
// Caller must have checked canPlace first.
export function place(board: Board, shape: Shape, row: number, col: number, color: number): void {
  for (const [dr, dc] of shape) {
    board[row + dr][col + dc] = color;
  }
}

// Detect full rows and full columns. Block Blast clears both axes at once.
export function findFullLines(board: Board): FullLines {
  const height = board.length;
  const width = board[0].length;
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = 0; r < height; r++) {
    if (board[r].every((v) => v !== -1)) rows.push(r);
  }
  for (let c = 0; c < width; c++) {
    let full = true;
    for (let r = 0; r < height; r++) {
      if (board[r][c] === -1) { full = false; break; }
    }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

// clearLines: mutates board, emptying every cell on a full row/column.
// Returns the set of cleared cell keys (r*width+c) for renderer particle bursts.
export function clearLines(board: Board): ClearResult {
  const width = board[0].length;
  const { rows, cols } = findFullLines(board);
  const lineCount = rows.length + cols.length;
  const cleared = new Set<number>();
  for (const r of rows) {
    for (let c = 0; c < width; c++) cleared.add(r * width + c);
  }
  for (const c of cols) {
    for (let r = 0; r < board.length; r++) cleared.add(r * width + c);
  }
  for (const key of cleared) {
    const r = Math.floor(key / width);
    const c = key % width;
    board[r][c] = -1;
  }
  return { lineCount, clearedCells: cleared };
}

// Pre-fill the board to a target occupancy at reset, so a higher spawn.density
// means a more crowded opening (harder). Guards: never complete a row/column
// (would auto-clear on first move and defeat the point), and never fill a cell
// if doing so would make the board fully blocked. Randomness injected via `rng`.
export function prefillDensity(board: Board, density: number | undefined, rng: Rng): void {
  if (!density || density <= 0) return;
  const height = board.length;
  const width = board[0].length;
  const total = width * height;
  const target = Math.min(Math.floor(total * density), total - 1);
  if (target <= 0) return;

  const rowFilled = Array<number>(height).fill(0);
  const colFilled = Array<number>(width).fill(0);

  const cells: Array<[number, number]> = [];
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) cells.push([r, c]);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = cells[i]; cells[i] = cells[j]; cells[j] = tmp;
  }

  let placed = 0;
  for (const [r, c] of cells) {
    if (placed >= target) break;
    if (board[r][c] !== -1) continue;
    if (rowFilled[r] + 1 >= width) continue; // would complete (or over-fill) a row
    if (colFilled[c] + 1 >= height) continue; // would complete a column
    board[r][c] = Math.floor(rng() * 8); // any color index; -1 stays "empty"
    rowFilled[r]++; colFilled[c]++;
    placed++;
  }
}

export function occupancy(board: Board): number {
  let filled = 0;
  let total = 0;
  for (const row of board) {
    for (const v of row) {
      total++;
      if (v !== -1) filled++;
    }
  }
  return total === 0 ? 0 : filled / total;
}

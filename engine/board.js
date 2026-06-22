// Board state machine — pure functions, zero DOM.
// Grid is number[height][width]; -1 = empty, >=0 = color index.

export function createBoard(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(-1));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

// canPlace: every cell of `shape` (offsets [dr,dc]) anchored at (row,col)
// must be in-bounds and empty.
export function canPlace(board, shape, row, col) {
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

export function canPlaceAnywhere(board, shape) {
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
export function place(board, shape, row, col, color) {
  for (const [dr, dc] of shape) {
    board[row + dr][col + dc] = color;
  }
}

// Detect full rows and full columns. Block Blast clears both axes at once.
export function findFullLines(board) {
  const height = board.length;
  const width = board[0].length;
  const rows = [];
  const cols = [];
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
export function clearLines(board) {
  const width = board[0].length;
  const height = board.length;
  const { rows, cols } = findFullLines(board);
  const lineCount = rows.length + cols.length;
  const cleared = new Set();
  for (const r of rows) {
    for (let c = 0; c < width; c++) cleared.add(r * width + c);
  }
  for (const c of cols) {
    for (let r = 0; r < height; r++) cleared.add(r * width + c);
  }
  for (const key of cleared) {
    const r = Math.floor(key / width);
    const c = key % width;
    board[r][c] = -1;
  }
  return { lineCount, clearedCells: cleared };
}

export function occupancy(board) {
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

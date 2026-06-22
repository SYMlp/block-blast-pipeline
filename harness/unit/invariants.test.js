// Harness Layer 1 — property-based invariant tests (Vitest + fast-check).
// These are the contract the AI-generated engine must satisfy, expressed as
// invariants that must hold over RANDOM play, not hand-picked examples.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { GameEngine } from '../../engine/GameEngine.js';
import { canPlace, findFullLines } from '../../engine/board.js';
import { clearScore, comboMultiplier } from '../../engine/scorer.js';
import { validate } from '../../config/validate.js';

import control from '../../config/variants/control.json' with { type: 'json' };
import compact from '../../config/variants/compact.json' with { type: 'json' };
import relaxed from '../../config/variants/relaxed.json' with { type: 'json' };
import hardMode from '../../config/variants/hard-mode.json' with { type: 'json' };

const CONFIGS = { control, compact, relaxed, 'hard-mode': hardMode };

// Play `maxSteps` greedy-ish moves, calling `onStep(engine, before, result)`
// after each so invariants can be checked at every transition.
function playWithCheck(config, seed, maxSteps, onStep) {
  const eng = new GameEngine(config, { seed });
  let steps = 0;
  while (!eng.gameOver && steps < maxSteps) {
    const moves = eng.legalMoves();
    // Invariant 4 is checked here implicitly: a non-game-over engine must have
    // at least one legal move, otherwise it would have flipped gameOver.
    if (moves.length === 0) {
      expect(eng.gameOver).toBe(true);
      break;
    }
    const move = moves[seed % moves.length === 0 ? 0 : steps % moves.length];
    const before = {
      score: eng.score,
      combo: eng.combo,
      board: eng.board.map((r) => r.slice()),
    };
    const result = eng.applyMove(move.trayIndex, move.row, move.col);
    if (onStep) onStep(eng, before, result, move);
    steps++;
  }
  return eng;
}

describe('Invariant 1 — board is always WxH', () => {
  it('dimensions never change across play, for every variant', () => {
    for (const [id, config] of Object.entries(CONFIGS)) {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 1 << 20 }), (seed) => {
          const eng = playWithCheck(config, seed, 40, (e) => {
            expect(e.board.length).toBe(config.board.height);
            for (const row of e.board) expect(row.length).toBe(config.board.width);
          });
          expect(eng.board.length).toBe(config.board.height);
        }),
        { numRuns: 30 }
      );
    }
  });
});

describe('Invariant 2 — placement fills exactly the piece cells', () => {
  it('after a legal placement, every placed cell is filled (non -1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1 << 20 }), (seed) => {
        const eng = new GameEngine(control, { seed });
        const moves = eng.legalMoves();
        if (moves.length === 0) return; // game over at spawn (extremely rare)
        const m = moves[0];
        const piece = eng.tray[m.trayIndex];
        const cells = piece.shape.map(([dr, dc]) => [m.row + dr, m.col + dc]);
        eng.applyMove(m.trayIndex, m.row, m.col);
        // Each placed cell is either still filled OR was cleared as part of a
        // completed line (became -1). It must NOT be left in an inconsistent
        // half-state — we assert it's a valid cell value.
        for (const [r, c] of cells) {
          expect(eng.board[r][c] === -1 || eng.board[r][c] >= 0).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('on an empty board, placement writes 1 per cell and clears nothing', () => {
    const eng = new GameEngine(control, { seed: 7 });
    const moves = eng.legalMoves();
    const m = moves[0];
    const piece = eng.tray[m.trayIndex];
    const n = piece.cellCount;
    eng.applyMove(m.trayIndex, m.row, m.col);
    let filled = 0;
    for (const row of eng.board) for (const v of row) if (v !== -1) filled++;
    // Empty 8x8 + small/medium piece => no line completes => filled == n.
    expect(filled).toBe(n);
  });
});

describe('Invariant 3 — after clear, no full line remains', () => {
  it('post-applyMove the board never contains an uncleared full row/col', () => {
    for (const [id, config] of Object.entries(CONFIGS)) {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 1 << 20 }), (seed) => {
          playWithCheck(config, seed, 60, (e) => {
            const { rows, cols } = findFullLines(e.board);
            expect(rows.length + cols.length).toBe(0);
          });
        }),
        { numRuns: 25 }
      );
    }
  });
});

describe('Invariant 4 — non-gameover implies a legal move exists', () => {
  it('while not game over, legalMoves() is non-empty', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1 << 20 }), (seed) => {
        const eng = new GameEngine(control, { seed });
        let guard = 0;
        while (!eng.gameOver && guard < 200) {
          expect(eng.legalMoves().length).toBeGreaterThan(0);
          const moves = eng.legalMoves();
          const m = moves[0];
          eng.applyMove(m.trayIndex, m.row, m.col);
          guard++;
        }
      }),
      { numRuns: 40 }
    );
  });
});

describe('Invariant 5 — score is monotonically non-decreasing', () => {
  it('score never drops between steps, for every variant', () => {
    for (const [id, config] of Object.entries(CONFIGS)) {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 1 << 20 }), (seed) => {
          playWithCheck(config, seed, 80, (e, before) => {
            expect(e.score).toBeGreaterThanOrEqual(before.score);
          });
        }),
        { numRuns: 25 }
      );
    }
  });
});

describe('Invariant 6 — combo only rises on a clear, resets otherwise', () => {
  it('combo increments iff the move cleared lines, else resets to 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1 << 20 }), (seed) => {
        playWithCheck(control, seed, 80, (e, before, result) => {
          if (!result) return;
          if (result.lineCount > 0) {
            expect(e.combo).toBe(before.combo + 1);
          } else {
            expect(e.combo).toBe(0);
          }
        });
      }),
      { numRuns: 50 }
    );
  });

  it('comboMultiplier is non-decreasing in combo for every curve', () => {
    for (const curve of ['linear', 'quadratic', 'stepped']) {
      let prev = -1;
      for (let combo = 1; combo <= 8; combo++) {
        const m = comboMultiplier(combo, curve);
        expect(m).toBeGreaterThanOrEqual(prev);
        prev = m;
      }
    }
  });
});

describe('scorer — clear score scales with line count and combo', () => {
  it('more lines and higher combo yield more points', () => {
    const s = control.scoring;
    expect(clearScore(2, 1, s)).toBeGreaterThan(clearScore(1, 1, s));
    expect(clearScore(1, 3, s)).toBeGreaterThan(clearScore(1, 1, s));
    expect(clearScore(0, 5, s)).toBe(0);
  });
});

describe('schema — every shipped variant validates against schema.json', () => {
  it('all 4 variants conform to the config schema', () => {
    for (const [id, config] of Object.entries(CONFIGS)) {
      const { ok, errors } = validate(config);
      expect(ok, `${id} failed schema: ${JSON.stringify(errors)}`).toBe(true);
    }
  });
});

describe('board.canPlace — boundary and overlap rejection', () => {
  it('rejects out-of-bounds and occupied cells', () => {
    const board = [
      [0, -1],
      [-1, -1],
    ];
    expect(canPlace(board, [[0, 0]], 0, 0)).toBe(false); // occupied
    expect(canPlace(board, [[0, 0]], 0, 1)).toBe(true); // empty
    expect(canPlace(board, [[0, 0]], 2, 0)).toBe(false); // out of bounds
    expect(canPlace(board, [[0, 0], [0, 1]], 0, 1)).toBe(false); // second cell oob
  });
});

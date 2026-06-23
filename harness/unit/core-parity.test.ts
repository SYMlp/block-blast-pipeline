// Migration guard — proves the TS logic core (core/) is byte-for-byte
// behaviorally identical to the original JS engine (engine/). Same seed, same
// greedy move sequence => identical board / score / combo / gameOver at EVERY
// step. If the TS port drifted anywhere, a trajectory diverges and this fails.
//
// This is the contract that lets us retire engine/ once the Cocos build ships:
// the thing the Cocos renderer wraps is provably the same game.

import { describe, it, expect } from 'vitest';

// Old JS engine (v1 — still powers the live no-build browser demo).
// @ts-ignore — v1 JS engine ships no .d.ts; this cross-boundary import is the
// whole point of the parity guard and goes away when engine/ is retired.
import { GameEngine as JsEngine } from '../../engine/GameEngine.js';
// New TS core (v2 — drops into Cocos assets/scripts/core/).
import { GameEngine as TsEngine } from '../../core/GameEngine';
import type { GameConfig } from '../../core/types';

import control from '../../config/variants/control.json' with { type: 'json' };
import compact from '../../config/variants/compact.json' with { type: 'json' };
import relaxed from '../../config/variants/relaxed.json' with { type: 'json' };
import hardMode from '../../config/variants/hard-mode.json' with { type: 'json' };

const CONFIGS: Record<string, GameConfig> = {
  control: control as GameConfig,
  compact: compact as GameConfig,
  relaxed: relaxed as GameConfig,
  'hard-mode': hardMode as GameConfig,
};

interface Snapshot {
  score: number;
  combo: number;
  gameOver: boolean;
  steps: number;
  board: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function snapshot(eng: any): Snapshot {
  return {
    score: eng.score,
    combo: eng.combo,
    gameOver: eng.gameOver,
    steps: eng.steps,
    board: JSON.stringify(eng.board),
  };
}

// Deterministic greedy-ish play: pick a legal move by a seed-derived index so
// both engines walk the exact same decision path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trajectory(EngineClass: any, config: GameConfig, seed: number, maxSteps: number): Snapshot[] {
  const eng = new EngineClass(config, { seed });
  const trace: Snapshot[] = [snapshot(eng)];
  let steps = 0;
  while (!eng.gameOver && steps < maxSteps) {
    const moves = eng.legalMoves();
    if (moves.length === 0) break;
    const m = moves[(seed + steps) % moves.length];
    eng.applyMove(m.trayIndex, m.row, m.col);
    trace.push(snapshot(eng));
    steps++;
  }
  return trace;
}

describe('TS core ⇄ JS engine parity', () => {
  it('produces identical trajectories for every variant across many seeds', () => {
    for (const [id, config] of Object.entries(CONFIGS)) {
      for (let seed = 1; seed <= 50; seed++) {
        const js = trajectory(JsEngine, config, seed, 120);
        const ts = trajectory(TsEngine, config, seed, 120);
        expect(ts.length, `${id} seed ${seed}: trajectory length differs`).toBe(js.length);
        for (let i = 0; i < js.length; i++) {
          expect(ts[i], `${id} seed ${seed} step ${i}: state diverged`).toEqual(js[i]);
        }
      }
    }
  });
});

describe('TS core — self-determinism', () => {
  it('same seed yields identical games (no hidden non-determinism)', () => {
    for (const [, config] of Object.entries(CONFIGS)) {
      const a = trajectory(TsEngine, config, 12345, 120);
      const b = trajectory(TsEngine, config, 12345, 120);
      expect(a).toEqual(b);
    }
  });
});

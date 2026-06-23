// Scoring + combo. Pure functions, all curve constants from config.scoring.

import type { ScoringConfig, ComboCurve } from './types';

// Placement points: one per cell placed (scaled by config).
export function placementScore(cellCount: number, scoring: ScoringConfig): number {
  return cellCount * (scoring.placement_per_cell ?? 1);
}

// Combo multiplier per config.scoring.combo_curve.
// `combo` is the current consecutive-clear streak (>=1 when a clear happened).
export function comboMultiplier(combo: number, curve: ComboCurve | undefined): number {
  if (combo < 1) return 0;
  switch (curve) {
    case 'quadratic':
      return combo * combo;
    case 'stepped':
      // Braindoku-style step table, clamped at index 5.
      return [1, 1, 2, 3, 5, 10][Math.min(combo, 5)];
    case 'linear':
    default:
      return combo;
  }
}

// Clear score: base is the 1010!-style累进 quadratic over lineCount,
// then scaled by the combo multiplier.
export function clearScore(lineCount: number, combo: number, scoring: ScoringConfig): number {
  if (lineCount <= 0) return 0;
  const factor = scoring.clear_base_factor ?? 5;
  let base = 0;
  for (let i = 1; i <= lineCount; i++) {
    base += (factor * i * (i + 1)) / 2;
  }
  const mult = comboMultiplier(combo, scoring.combo_curve);
  return Math.round(base * mult);
}

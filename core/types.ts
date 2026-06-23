// Shared types for the pure logic core. Engine-agnostic: nothing here imports
// `cc`, so the whole core compiles & runs headless under Node/Vitest and drops
// unchanged into a Cocos `assets/scripts/core/` folder.

/** A board cell: -1 = empty, >=0 = color index. */
export type Cell = number;

/** Grid indexed [row][col]. */
export type Board = Cell[][];

/** A single shape cell offset [dr, dc] from the piece anchor. */
export type Offset = [number, number];

/** A shape is a list of cell offsets. */
export type Shape = Offset[];

/** Shape definition in the master table: offsets + cached cell count. */
export interface ShapeDef {
  s: Shape;
  n: number;
}

/** A materialized piece sitting in the tray. */
export interface Piece {
  shape: Shape;
  color: number;
  rows: number;
  cols: number;
  cellCount: number;
}

/** Injectable PRNG: returns a float in [0, 1). */
export type Rng = () => number;

export interface BoardConfig {
  width: number;
  height: number;
}

export interface SpawnConfig {
  shape_set: 'minimal' | 'standard' | 'extended';
  preview_count?: number;
  big_piece_weight_mult?: number;
  /** Opening-board target occupancy [0,1); higher = more crowded start. */
  density?: number;
}

export interface DifficultyConfig {
  dda_enabled?: boolean;
  dda_high_occupancy?: number;
  dda_low_occupancy?: number;
}

export type ComboCurve = 'linear' | 'quadratic' | 'stepped';

export interface ScoringConfig {
  placement_per_cell?: number;
  clear_base_factor?: number;
  combo_curve?: ComboCurve;
}

/** The full machine-readable game config a variant resolves to. */
export interface GameConfig {
  board: BoardConfig;
  spawn: SpawnConfig;
  difficulty?: DifficultyConfig;
  scoring: ScoringConfig;
}

/** Result of a single placement, consumed by the renderer to fire juice. */
export interface MoveResult {
  piece: Piece;
  row: number;
  col: number;
  lineCount: number;
  clearedCells: Set<number>;
  gain: number;
  combo: number;
}

export interface ClearResult {
  lineCount: number;
  clearedCells: Set<number>;
}

export interface FullLines {
  rows: number[];
  cols: number[];
}

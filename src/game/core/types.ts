/**
 * Pure type definitions for Over the Rainbow.
 * No Phaser or DOM dependencies.
 */

export const BOARD_SIZE = 3 as const;
export type BoardSize = typeof BOARD_SIZE;

/** Empty cell or tile level 1..8. */
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Non-empty tile level. */
export type TileLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const TILE_LEVELS: readonly TileLevel[] = [1, 2, 3, 4, 5, 6, 7, 8];

/** 3x3 board: board[row][col], row 0 = top, col 0 = left. */
export type Board = readonly (readonly Cell[])[];

export type Direction = "up" | "down" | "left" | "right";

export const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];

/** Coordinate on the board. */
export interface CellPosition {
  readonly row: number;
  readonly col: number;
}

/** Movement trace for a single tile during a move (before spawn). */
export interface MoveTrace {
  readonly from: CellPosition;
  readonly to: CellPosition;
  /** True if this tile was consumed into a merge at the destination. */
  readonly mergedInto: boolean;
}

/** Result of applying a move (before spawning). */
export interface MoveResult {
  readonly board: Board;
  readonly scoreDelta: number;
  readonly changed: boolean;
  readonly merged: CellPosition[];
  readonly rainbowMerged: CellPosition[];
  readonly traces: MoveTrace[];
}

/** Result of a full move step: slide + optional spawn. */
export interface StepResult {
  readonly board: Board;
  readonly scoreDelta: number;
  readonly changed: boolean;
  readonly spawnedAt: { row: number; col: number } | null;
  readonly merged: CellPosition[];
  readonly rainbowMerged: CellPosition[];
  readonly traces: MoveTrace[];
}

/** Spawn weight: only level 1 with 100% for now. */
export type SpawnLevel = 1;

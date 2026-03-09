/**
 * Spawn exactly one tile in a random empty cell.
 * Spawn level 1 with 100% probability.
 */

import type { Board, Cell } from "./types";
import type { SpawnLevel } from "./types";
import { getEmptyCellPositions } from "./board";
import { copyBoard } from "./board";

/** Pick one random empty position. randomIndex must be in [0, emptyCount). */
export function pickEmptyPosition(
  board: Board,
  randomIndex: number
): { row: number; col: number } | null {
  const empty = getEmptyCellPositions(board);
  if (empty.length === 0) return null;
  const i = randomIndex % empty.length;
  return empty[i];
}

/** Spawn a tile at the given position. Returns new board or null if cell not empty. */
export function spawnAt(
  board: Board,
  row: number,
  col: number,
  level: SpawnLevel
): Board | null {
  if (board[row][col] !== 0) return null;
  const next = copyBoard(board);
  next[row][col] = level;
  return next;
}

/**
 * Spawn exactly one tile (level 1) in a random empty cell.
 * randomIndex in [0, emptyCount) selects which empty cell.
 * Returns { board, spawnedAt } or { board: same, spawnedAt: null } if no empty cells.
 */
export function spawnOne(
  board: Board,
  randomIndex: number
): { board: Board; spawnedAt: { row: number; col: number } | null } {
  const pos = pickEmptyPosition(board, randomIndex);
  if (pos === null) return { board, spawnedAt: null };
  const next = spawnAt(board, pos.row, pos.col, 1);
  if (!next) return { board, spawnedAt: null };
  return { board: next, spawnedAt: pos };
}

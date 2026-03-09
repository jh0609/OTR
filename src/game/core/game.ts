/**
 * Win detection, game-over detection, and full step (move + optional spawn).
 */

import type { Board, Direction, StepResult } from "./types";
import { DIRECTIONS } from "./types";
import { getEmptyCount } from "./board";
import { applyMove } from "./move";
import { spawnOne } from "./spawn";

export type { StepResult };

/** Player has created a level-8 tile (win condition). Game can continue. */
export function hasWon(board: Board): boolean {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (board[r][c] === 8) return true;
    }
  }
  return false;
}

/** No empty cells and no merge possible in any direction. */
export function isGameOver(board: Board): boolean {
  if (getEmptyCount(board) > 0) return false;
  for (const dir of DIRECTIONS) {
    const result = applyMove(board, dir);
    if (result.changed) return false;
  }
  return true;
}

/**
 * Perform one player step: move in direction, then spawn one tile if board changed.
 * randomIndex is used to pick which empty cell gets the new tile (0..emptyCount-1).
 */
export function step(
  board: Board,
  direction: Direction,
  randomIndex: number
): StepResult {
  const moveResult = applyMove(board, direction);
  if (!moveResult.changed) {
    return {
      board,
      scoreDelta: 0,
      changed: false,
      spawnedAt: null,
      merged: [],
      traces: [],
    };
  }
  const spawnResult = spawnOne(moveResult.board, randomIndex);
  return {
    board: spawnResult.board,
    scoreDelta: moveResult.scoreDelta,
    changed: true,
    spawnedAt: spawnResult.spawnedAt,
    merged: moveResult.merged,
    traces: moveResult.traces,
  };
}

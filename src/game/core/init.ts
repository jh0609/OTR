/**
 * Initial game state: empty board with 2 tiles (level 1).
 * randomIndex1 in [0, 9), randomIndex2 in [0, 8) for the remaining empty.
 */

import type { Board } from "./types";
import { createEmptyBoard } from "./board";
import { spawnOne } from "./spawn";

export function initGame(randomIndex1: number, randomIndex2: number): Board {
  const empty = createEmptyBoard();
  const first = spawnOne(empty, randomIndex1);
  if (!first.spawnedAt) return empty;
  const second = spawnOne(first.board, randomIndex2);
  return second.spawnedAt ? second.board : first.board;
}

import type { Board } from "./types";
import { LEN, freezeBoard, toUint8 } from "./board";

export type SpawnPlacement = {
  readonly index: number;
  readonly value: 1;
  readonly rngValue: number;
  readonly emptyCountBefore: number;
};

export type SpawnRandomResult = {
  readonly board: Board;
  readonly spawn: SpawnPlacement | null;
};

/** Every board with a single new level-1 tile in each empty cell (for expectation / enumeration). */
export function spawnAll(board: Board): Board[] {
  const out: Board[] = [];
  for (let i = 0; i < LEN; i++) {
    if (board[i] !== 0) continue;
    const u = toUint8(board);
    u[i] = 1;
    out.push(freezeBoard(u));
  }
  return out;
}

/** Uniform random spawn of level 1 into a random empty cell. No-op if full. */
export function spawnRandom(board: Board, rng: () => number): Board {
  return spawnRandomDetailed(board, rng).board;
}

/** Uniform random spawn with spawn metadata for debugging / logging. */
export function spawnRandomDetailed(board: Board, rng: () => number): SpawnRandomResult {
  const empties: number[] = [];
  for (let i = 0; i < LEN; i++) if (board[i] === 0) empties.push(i);
  if (empties.length === 0) {
    return {
      board,
      spawn: null,
    };
  }
  const rngValue = rng();
  const pick = empties[Math.floor(rngValue * empties.length)];
  const u = toUint8(board);
  u[pick] = 1;
  return {
    board: freezeBoard(u),
    spawn: {
      index: pick,
      value: 1,
      rngValue,
      emptyCountBefore: empties.length,
    },
  };
}

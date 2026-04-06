import type { Board } from "./types";
import { LEN, freezeBoard, toUint8 } from "./board";

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
  const empties: number[] = [];
  for (let i = 0; i < LEN; i++) if (board[i] === 0) empties.push(i);
  if (empties.length === 0) return board;
  const pick = empties[Math.floor(rng() * empties.length)];
  const u = toUint8(board);
  u[pick] = 1;
  return freezeBoard(u);
}

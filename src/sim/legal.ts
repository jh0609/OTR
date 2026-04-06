import type { Board, Direction } from "./types";
import { slide } from "./slide";

const ORDER: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];

/** Directions that actually change the board. */
export function legalActions(board: Board): Direction[] {
  const out: Direction[] = [];
  for (const d of ORDER) {
    if (slide(board, d).moved) out.push(d);
  }
  return out;
}

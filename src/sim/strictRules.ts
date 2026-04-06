import type { Board } from "./types";
import { extractTopRow } from "./patterns";

/** Example: top row must be [1,1,2] (112) for strict survival. */
export function successSpawnOnly(board: Board): boolean {
  const [a, b, c] = extractTopRow(board);
  return a === 1 && b === 1 && c === 2;
}

/** Reject boards whose top row matches known dead patterns for the analysis goal. */
export function forbidDeadPatterns(board: Board): boolean {
  const [a, b, c] = extractTopRow(board);
  if (a === 0 && b === 1 && c === 2) return false;
  if (a === 0 && b === 0 && c === 2) return false;
  return true;
}

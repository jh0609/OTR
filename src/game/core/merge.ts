/**
 * Slide and merge logic. One merge per tile per move.
 * Deterministic and testable.
 */

import type { Cell, TileLevel } from "./types";
import { BOARD_SIZE } from "./types";
import { getMergeScore } from "./score";

export interface SlideRowResult {
  row: Cell[];
  score: number;
}

/** Slide a row to the left with merge (each tile merges at most once). */
export function slideRowLeft(row: readonly Cell[]): SlideRowResult {
  const nonZero = row.filter((x): x is TileLevel => x !== 0);
  const result: Cell[] = [];
  let score = 0;
  let i = 0;
  while (i < nonZero.length) {
    const a = nonZero[i];
    const b = nonZero[i + 1];
    if (a < 8 && b !== undefined && a === b) {
      const merged = (a + 1) as TileLevel;
      result.push(merged);
      score += getMergeScore(merged);
      i += 2;
    } else {
      result.push(a);
      i += 1;
    }
  }
  while (result.length < BOARD_SIZE) result.push(0);
  return { row: result, score };
}

/** Slide row to the right: reverse, slide left, reverse. */
export function slideRowRight(row: readonly Cell[]): SlideRowResult {
  const reversed = [...row].reverse();
  const { row: left, score } = slideRowLeft(reversed);
  return { row: left.reverse(), score };
}

export interface SlideColumnResult {
  col: Cell[];
  score: number;
}

/** Slide column upward (toward index 0). */
export function slideColumnUp(col: readonly Cell[]): SlideColumnResult {
  const { row, score } = slideRowLeft(col);
  return { col: row, score };
}

/** Slide column downward. */
export function slideColumnDown(col: readonly Cell[]): SlideColumnResult {
  const { row, score } = slideRowRight(col);
  return { col: row, score };
}

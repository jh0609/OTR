/**
 * Slide and merge logic. One merge per tile per move.
 * Deterministic and testable.
 */

import type { Cell, TileLevel } from "./types";
import { BOARD_SIZE } from "./types";
import { getMergeScore, getRainbowFusionScore } from "./score";

export interface SlideIndexTrace {
  fromIndex: number;
  toIndex: number;
  mergedInto: boolean;
}

export interface SlideRowResult {
  row: Cell[];
  score: number;
  mergedIndices: number[];
  rainbowMergedIndices: number[];
  indexTraces: SlideIndexTrace[];
}

/** Slide a row to the left with merge (each tile merges at most once). */
export function slideRowLeft(row: readonly Cell[]): SlideRowResult {
  const nonZero = row.filter((x): x is TileLevel => x !== 0);
  const result: Cell[] = [];
  let score = 0;
  const mergedIndices: number[] = [];
  const rainbowMergedIndices: number[] = [];
  const indexTraces: SlideIndexTrace[] = [];
  // Track original indices of non-zero tiles
  const indices: number[] = [];
  row.forEach((value, idx) => {
    if (value !== 0) indices.push(idx);
  });
  let i = 0;
  while (i < nonZero.length) {
    const a = nonZero[i];
    const b = nonZero[i + 1];
    if (a < 8 && b !== undefined && a === b) {
      const merged = (a + 1) as TileLevel;
      const targetIndex = result.length;
      result.push(merged);
      mergedIndices.push(targetIndex);
      score += getMergeScore(merged);
      const fromA = indices[i];
      const fromB = indices[i + 1];
      indexTraces.push(
        { fromIndex: fromA, toIndex: targetIndex, mergedInto: true },
        { fromIndex: fromB, toIndex: targetIndex, mergedInto: true }
      );
      i += 2;
    } else if (a === 8 && b !== undefined && b === 8) {
      // Rainbow + Rainbow: both tiles leave the board; fusion score only.
      const targetIndex = result.length;
      rainbowMergedIndices.push(targetIndex);
      score += getRainbowFusionScore();
      const fromA = indices[i];
      const fromB = indices[i + 1];
      indexTraces.push(
        { fromIndex: fromA, toIndex: targetIndex, mergedInto: true },
        { fromIndex: fromB, toIndex: targetIndex, mergedInto: true }
      );
      i += 2;
    } else {
      result.push(a);
      const targetIndex = result.length - 1;
      const from = indices[i];
      indexTraces.push({ fromIndex: from, toIndex: targetIndex, mergedInto: false });
      i += 1;
    }
  }
  while (result.length < BOARD_SIZE) result.push(0);
  return { row: result, score, mergedIndices, rainbowMergedIndices, indexTraces };
}

/** Slide row to the right: reverse, slide left, reverse. */
export function slideRowRight(row: readonly Cell[]): SlideRowResult {
  const reversed = [...row].reverse();
  const { row: left, score, mergedIndices, rainbowMergedIndices, indexTraces } = slideRowLeft(reversed);
  const finalRow = left.reverse();
  const finalMerged: number[] = mergedIndices.map((idx) => BOARD_SIZE - 1 - idx);
  const finalRainbowMerged: number[] = rainbowMergedIndices.map((idx) => BOARD_SIZE - 1 - idx);
  const finalTraces: SlideIndexTrace[] = indexTraces.map((t) => ({
    fromIndex: BOARD_SIZE - 1 - t.fromIndex,
    toIndex: BOARD_SIZE - 1 - t.toIndex,
    mergedInto: t.mergedInto,
  }));
  return {
    row: finalRow,
    score,
    mergedIndices: finalMerged,
    rainbowMergedIndices: finalRainbowMerged,
    indexTraces: finalTraces,
  };
}

export interface SlideColumnResult {
  col: Cell[];
  score: number;
  mergedIndices: number[];
  rainbowMergedIndices: number[];
  indexTraces: SlideIndexTrace[];
}

/** Slide column upward (toward index 0). */
export function slideColumnUp(col: readonly Cell[]): SlideColumnResult {
  const { row, score, mergedIndices, rainbowMergedIndices, indexTraces } = slideRowLeft(col);
  return { col: row, score, mergedIndices, rainbowMergedIndices, indexTraces };
}

/** Slide column downward. */
export function slideColumnDown(col: readonly Cell[]): SlideColumnResult {
  const { row, score, mergedIndices, rainbowMergedIndices, indexTraces } = slideRowRight(col);
  return { col: row, score, mergedIndices, rainbowMergedIndices, indexTraces };
}

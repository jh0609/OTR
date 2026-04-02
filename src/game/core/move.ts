/**
 * Apply a direction to the full board; returns new board, score delta, and changed flag.
 */

import type { Board, Cell, CellPosition, Direction, MoveResult, MoveTrace } from "./types";
import { copyBoard, getRow, getColumn, setRow, setColumn } from "./board";
import {
  slideRowLeft,
  slideRowRight,
  slideColumnUp,
  slideColumnDown,
} from "./merge";

export type { MoveResult };

function boardEquals(a: Board, b: Board): boolean {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

/** Apply one move (slide + merge). Does not spawn. */
export function applyMove(board: Board, direction: Direction): MoveResult {
  let next: Cell[][] = copyBoard(board);
  let totalScore = 0;
  const merged: CellPosition[] = [];
  const rainbowMerged: CellPosition[] = [];
  const traces: MoveTrace[] = [];

  if (direction === "left" || direction === "right") {
    const slide = direction === "left" ? slideRowLeft : slideRowRight;
    for (let r = 0; r < 3; r++) {
      const row = getRow(board, r);
      const { row: newRow, score, mergedIndices, rainbowMergedIndices, indexTraces } = slide(row);
      totalScore += score;
      next = setRow(next as Board, r, newRow);
      for (const c of mergedIndices) {
        merged.push({ row: r, col: c });
      }
      for (const c of rainbowMergedIndices) {
        rainbowMerged.push({ row: r, col: c });
      }
      for (const t of indexTraces) {
        traces.push({
          from: { row: r, col: t.fromIndex },
          to: { row: r, col: t.toIndex },
          mergedInto: t.mergedInto,
        });
      }
    }
  } else {
    const slide = direction === "up" ? slideColumnUp : slideColumnDown;
    for (let c = 0; c < 3; c++) {
      const col = getColumn(board, c);
      const { col: newCol, score, mergedIndices, rainbowMergedIndices, indexTraces } = slide(col);
      totalScore += score;
      next = setColumn(next as Board, c, newCol);
      for (const r of mergedIndices) {
        merged.push({ row: r, col: c });
      }
      for (const r of rainbowMergedIndices) {
        rainbowMerged.push({ row: r, col: c });
      }
      for (const t of indexTraces) {
        traces.push({
          from: { row: t.fromIndex, col: c },
          to: { row: t.toIndex, col: c },
          mergedInto: t.mergedInto,
        });
      }
    }
  }

  const changed = !boardEquals(board, next as Board);
  return {
    board: next as Board,
    scoreDelta: totalScore,
    changed,
    merged,
    rainbowMerged,
    traces,
  };
}

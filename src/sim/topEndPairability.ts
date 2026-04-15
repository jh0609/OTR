import type { Board } from "./types";
import { maxTileLevel } from "./board";
import { secondMaxTile, areAdjacent } from "./boardStats";
import { slide } from "./slide";

export const HL_CONVERSION_BONUS = 1000;

export type TopEndPairability = {
  top2OrthAdj: boolean;
  oneSlideTop2Adj: boolean;
};

function cellsAtLevel(board: Board, level: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] === level) out.push(i);
  }
  return out;
}

function hasMergeAtLeastLevel(before: Board, afterSlide: Board, minLevel: number): boolean {
  const beforeCount = new Array(10).fill(0);
  const afterCount = new Array(10).fill(0);
  for (let i = 0; i < 9; i++) {
    const b = before[i]!;
    const a = afterSlide[i]!;
    if (b >= 1 && b <= 9) beforeCount[b]++;
    if (a >= 1 && a <= 9) afterCount[a]++;
  }
  for (let L = minLevel; L <= 8; L++) {
    if (afterCount[L] <= beforeCount[L] - 2 && afterCount[L + 1] >= beforeCount[L + 1] + 1) {
      return true;
    }
  }
  return false;
}

function top2OrthogonalAdjacent(board: Board): boolean {
  const mx = maxTileLevel(board);
  const sm = secondMaxTile(board);
  const maxCells = cellsAtLevel(board, mx);
  if (maxCells.length === 0 || sm === 0) return false;

  const secondCells = sm === mx ? maxCells : cellsAtLevel(board, sm);
  if (sm === mx) {
    for (let i = 0; i < maxCells.length; i++) {
      for (let j = i + 1; j < maxCells.length; j++) {
        if (areAdjacent(maxCells[i]!, maxCells[j]!)) return true;
      }
    }
    return false;
  }

  for (const a of maxCells) {
    for (const b of secondCells) {
      if (a !== b && areAdjacent(a, b)) return true;
    }
  }
  return false;
}

function oneSlideTop2OrthAdjacent(board: Board): boolean {
  for (const d of ["UP", "DOWN", "LEFT", "RIGHT"] as const) {
    const { next, moved } = slide(board, d);
    if (!moved) continue;
    if (top2OrthogonalAdjacent(next)) return true;
  }
  return false;
}

export function getTopEndPairability(board: Board): TopEndPairability {
  return {
    top2OrthAdj: top2OrthogonalAdjacent(board),
    oneSlideTop2Adj: oneSlideTop2OrthAdjacent(board),
  };
}

export function isHighLevelPairable(board: Board): boolean {
  const p = getTopEndPairability(board);
  return p.top2OrthAdj || p.oneSlideTop2Adj;
}

export function createsHighLevelMerge(before: Board, afterSlide: Board): boolean {
  if (hasMergeAtLeastLevel(before, afterSlide, 6)) return true;
  const maxBefore = maxTileLevel(before);
  const maxAfter = maxTileLevel(afterSlide);
  return maxAfter > maxBefore && maxAfter >= 6;
}

export function hlConversionBonus(before: Board, afterSlide: Board): number {
  if (isHighLevelPairable(before) && createsHighLevelMerge(before, afterSlide)) {
    return HL_CONVERSION_BONUS;
  }
  return 0;
}

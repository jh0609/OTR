/**
 * Scoring: points for merging into a given level.
 * Merge creates level N => +2^(N-1) for N in 2..8.
 */

import type { TileLevel } from "./types";

const MERGE_SCORE: Record<TileLevel, number> = {
  1: 0,
  2: 2,
  3: 4,
  4: 8,
  5: 16,
  6: 32,
  7: 64,
  8: 128,
};

export function getMergeScore(level: TileLevel): number {
  return MERGE_SCORE[level];
}

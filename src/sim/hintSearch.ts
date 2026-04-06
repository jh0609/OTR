/**
 * UI 힌트 버튼용: 현재 보드에서 4방향 기대값을 beam expectimax로 근사하고 최선 방향 1개 반환.
 *
 * 사용 예:
 * ```ts
 * import { getHint } from "./sim";
 * const hint = getHint(board, { depthLate: 10, beamWidthLate: 12, tuning: myTuning });
 * console.log(hint.bestDirection, hint.scores);
 * ```
 */
import type { Board, Direction } from "./types";
import { maxTileLevel } from "./board";
import { slide } from "./slide";
import { spawnAll } from "./spawn";
import { legalActions } from "./legal";
import { scoreBoardV3 } from "./scoringV3";
import {
  lateGameSlidePenalty,
  mergePotentialAtLevel,
  endgame7To8Potential,
} from "./boardStats";
import type { EndgameTuning, EndgameTuningConfig } from "./endgameTuning";
import { mergeEndgameTuning } from "./endgameTuning";

const ORDER_TIE: Direction[] = ["DOWN", "UP", "LEFT", "RIGHT"];

export type HintSearchConfig = {
  lateThreshold?: number;
  depthEarly?: number;
  depthLate?: number;
  beamWidthEarly?: number;
  beamWidthLate?: number;
  tuning?: EndgameTuningConfig;
  /** true이면 `HintResult.debug` 채움 */
  includeDebug?: boolean;
};

export type HintDebug = {
  expandedNodes: number;
  cacheHits: number;
  rootActionCount: number;
};

export type HintResult = {
  bestDirection: Direction;
  scores: Record<Direction, number | null>;
  searchedDepth: number;
  beamWidth: number;
  debug?: HintDebug;
};

function beamScoreValue(board: Board, t: EndgameTuning): number {
  let s = scoreBoardV3(board, t);
  if (maxTileLevel(board) >= 7) {
    s += 0.05 * mergePotentialAtLevel(board, 7);
    s += 0.02 * endgame7To8Potential(board, t);
  }
  return s;
}

function pruneSpawnOutcomes(outs: Board[], beamW: number, t: EndgameTuning): Board[] {
  if (outs.length <= beamW) return outs;
  const scored = outs.map((b) => ({ b, sc: beamScoreValue(b, t) }));
  scored.sort((a, b) => b.sc - a.sc);
  return scored.slice(0, beamW).map((x) => x.b);
}

/**
 * 후반(또는 설정) 기준 stochastic beam expectimax로
 * 네 방향 각각의 기대값을 구하고 최선 방향 1개를 반환.
 */
export function getHint(board: Board, config?: HintSearchConfig): HintResult {
  const t = mergeEndgameTuning(config?.tuning);
  const lateThreshold = config?.lateThreshold ?? 7;
  const mx = maxTileLevel(board);
  const isLate = mx >= lateThreshold;
  const searchedDepth = isLate ? (config?.depthLate ?? 10) : (config?.depthEarly ?? 4);
  const beamWidth = isLate ? (config?.beamWidthLate ?? 12) : (config?.beamWidthEarly ?? 6);

  const cache = new Map<string, number>();
  let expandedNodes = 0;
  let cacheHits = 0;

  function cacheKey(b: Board, d: number): string {
    return `${d}:${b.join(",")}`;
  }

  function cachedSearch(b: Board, d: number): number {
    const k = cacheKey(b, d);
    const hit = cache.get(k);
    if (hit !== undefined) {
      cacheHits++;
      return hit;
    }
    expandedNodes++;
    const v = searchInner(b, d);
    cache.set(k, v);
    return v;
  }

  function searchInner(b: Board, d: number): number {
    if (d <= 0) {
      return scoreBoardV3(b, t);
    }
    const acts = legalActions(b);
    if (acts.length === 0) {
      return scoreBoardV3(b, t);
    }
    let best = -Infinity;
    for (const dir of ORDER_TIE) {
      if (!acts.includes(dir)) continue;
      const q = evaluateActionValue(b, dir, d);
      if (q !== null) best = Math.max(best, q);
    }
    return best === -Infinity ? scoreBoardV3(b, t) : best;
  }

  function evaluateActionValue(b: Board, dir: Direction, d: number): number | null {
    const { next, moved, win } = slide(b, dir);
    if (!moved) return null;
    const pen = lateGameSlidePenalty(b, next, 8, t);
    if (win) {
      return pen + scoreBoardV3(next, t);
    }
    const outs = spawnAll(next);
    if (d <= 0) {
      if (outs.length === 0) return pen + scoreBoardV3(next, t);
      const pruned0 = pruneSpawnOutcomes(outs, beamWidth, t);
      let sum0 = 0;
      for (const s of pruned0) sum0 += scoreBoardV3(s, t);
      return pen + sum0 / pruned0.length;
    }
    if (outs.length === 0) {
      return pen + cachedSearch(next, d - 1);
    }
    const pruned = pruneSpawnOutcomes(outs, beamWidth, t);
    let sum = 0;
    for (const s of pruned) {
      sum += cachedSearch(s, d - 1);
    }
    return pen + sum / pruned.length;
  }

  const acts = legalActions(board);
  const scores: Record<Direction, number | null> = {
    UP: null,
    DOWN: null,
    LEFT: null,
    RIGHT: null,
  };

  let rootEvaluated = 0;
  for (const dir of ORDER_TIE) {
    if (!acts.includes(dir)) {
      scores[dir] = null;
      continue;
    }
    const q = evaluateActionValue(board, dir, searchedDepth);
    scores[dir] = q;
    if (q !== null) rootEvaluated++;
  }

  let bestDirection: Direction = acts[0] ?? "DOWN";
  let bestScore = -Infinity;
  for (const dir of ORDER_TIE) {
    const sc = scores[dir];
    if (sc === null) continue;
    if (sc > bestScore) {
      bestScore = sc;
      bestDirection = dir;
    }
  }

  const result: HintResult = {
    bestDirection,
    scores,
    searchedDepth,
    beamWidth,
  };

  if (config?.includeDebug === true) {
    result.debug = {
      expandedNodes,
      cacheHits,
      rootActionCount: rootEvaluated,
    };
  }

  return result;
}

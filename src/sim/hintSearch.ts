/**
 * UI 힌트 버튼용: 4방향 각각에 대해 expectimax 근사(깊이 d)로 기대값을 구하고 최선 방향 1개 반환.
 * 3×3에서는 빈 칸당 스폰을 전부 펼쳐 균등 기대(패망 스폰은 TERMINAL_LOSS, 생존만 재귀) — 스폰 빔 컷 없음.
 */
import type { Board, Direction } from "./types";
import { maxTileLevel } from "./board";
import { slide } from "./slide";
import { spawnAll } from "./spawn";
import { legalActions } from "./legal";
import { isTerminal } from "./terminal";
import { scoreBoardV3 } from "./scoringV3";
import { lateGameSlidePenalty } from "./boardStats";
import type { EndgameTuning, EndgameTuningConfig } from "./endgameTuning";
import { mergeEndgameTuning } from "./endgameTuning";

const ORDER_TIE: Direction[] = ["DOWN", "UP", "LEFT", "RIGHT"];

/** 합법 수가 없는 국면 — 휴리스틱 대신 고정 패널티(기대값에서 회피되도록 충분히 작게). */
const TERMINAL_LOSS = -1e9;

export type HintSearchConfig = {
  lateThreshold?: number;
  depthEarly?: number;
  depthLate?: number;
  /** 결과 `HintResult.beamWidth`에만 반영(스폰은 3×3에서 전부 펼침). */
  beamWidthEarly?: number;
  beamWidthLate?: number;
  tuning?: EndgameTuningConfig;
  /** true이면 `HintResult.debug` 채움 */
  includeDebug?: boolean;
  /**
   * 호출 간 유지할 값 캐시 (`depth:board` 키). 동일 튜닝·깊이·빔 설정으로 연속 호출 시 재사용하면 탐색이 가속됨.
   */
  valueCache?: Map<string, number>;
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
  /** 설정값 기록용(탐색에서는 스폰 전부 사용). */
  beamWidth: number;
  debug?: HintDebug;
};

/**
 * 네 방향 각각의 기대값을 구하고 최선 방향 1개를 반환.
 */
export function getHint(board: Board, config?: HintSearchConfig): HintResult {
  const t = mergeEndgameTuning(config?.tuning);
  const lateThreshold = config?.lateThreshold ?? 7;
  const mx = maxTileLevel(board);
  const isLate = mx >= lateThreshold;
  const searchedDepth = isLate ? (config?.depthLate ?? 10) : (config?.depthEarly ?? 4);
  const beamWidth = isLate ? (config?.beamWidthLate ?? 12) : (config?.beamWidthEarly ?? 6);

  const cache = config?.valueCache ?? new Map<string, number>();
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
    if (isTerminal(b, "standard")) {
      return TERMINAL_LOSS;
    }
    if (d <= 0) {
      return scoreBoardV3(b, t);
    }
    const acts = legalActions(b);
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
      if (outs.length === 0) {
        const v = isTerminal(next, "standard") ? TERMINAL_LOSS : scoreBoardV3(next, t);
        return pen + v;
      }
      let sum0 = 0;
      for (const s of outs) {
        sum0 += isTerminal(s, "standard") ? TERMINAL_LOSS : scoreBoardV3(s, t);
      }
      return pen + sum0 / outs.length;
    }
    if (outs.length === 0) {
      return pen + cachedSearch(next, d - 1);
    }
    let sum = 0;
    for (const s of outs) {
      sum += isTerminal(s, "standard") ? TERMINAL_LOSS : cachedSearch(s, d - 1);
    }
    return pen + sum / outs.length;
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

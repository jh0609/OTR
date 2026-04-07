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
  /** 호출 간 `scoreBoardV3` 메모(보드 키). 연속 힌트에서 겹치는 국면 재사용. */
  leafScoreCache?: Map<string, number>;
  /** 호출 간 `lateGameSlidePenalty(before|after)` 메모. */
  slidePenaltyCache?: Map<string, number>;
  /** 세션 캐시 상한(초과 시 가장 먼저 넣은 항목부터 삭제). */
  maxValueCacheSize?: number;
  maxLeafScoreCacheSize?: number;
  maxSlidePenaltyCacheSize?: number;
};

/** 기본 상한 — 메모리 폭주 방지용 슬라이딩 윈도우에 가깝게 동작. */
export const DEFAULT_HINT_MAX_VALUE_CACHE = 120_000;
export const DEFAULT_HINT_MAX_LEAF_CACHE = 60_000;
export const DEFAULT_HINT_MAX_SLIDE_CACHE = 40_000;

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
function boardKey(b: Board): string {
  return b.join(",");
}

function trimMapToMax(m: Map<string, number>, max: number): void {
  while (m.size > max) {
    const k = m.keys().next().value;
    if (k === undefined) break;
    m.delete(k);
  }
}

export function getHint(board: Board, config?: HintSearchConfig): HintResult {
  const t = mergeEndgameTuning(config?.tuning);
  const lateThreshold = config?.lateThreshold ?? 7;
  const mx = maxTileLevel(board);
  const isLate = mx >= lateThreshold;
  const searchedDepth = isLate ? (config?.depthLate ?? 10) : (config?.depthEarly ?? 4);
  const beamWidth = isLate ? (config?.beamWidthLate ?? 12) : (config?.beamWidthEarly ?? 6);

  const cache = config?.valueCache ?? new Map<string, number>();
  const leafScoreMemo = config?.leafScoreCache ?? new Map<string, number>();
  const slidePenaltyMemo = config?.slidePenaltyCache ?? new Map<string, number>();

  function leafScore(b: Board): number {
    const k = boardKey(b);
    const hit = leafScoreMemo.get(k);
    if (hit !== undefined) return hit;
    const v = scoreBoardV3(b, t);
    leafScoreMemo.set(k, v);
    return v;
  }

  function slidePenalty(before: Board, after: Board): number {
    const k = `${boardKey(before)}|${boardKey(after)}`;
    const hit = slidePenaltyMemo.get(k);
    if (hit !== undefined) return hit;
    const v = lateGameSlidePenalty(before, after, 8, t);
    slidePenaltyMemo.set(k, v);
    return v;
  }

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
      return leafScore(b);
    }
    const acts = legalActions(b);
    let best = -Infinity;
    for (const dir of ORDER_TIE) {
      if (!acts.includes(dir)) continue;
      const q = evaluateActionValue(b, dir, d);
      if (q !== null) best = Math.max(best, q);
    }
    return best === -Infinity ? leafScore(b) : best;
  }

  function evaluateActionValue(b: Board, dir: Direction, d: number): number | null {
    const { next, moved, win } = slide(b, dir);
    if (!moved) return null;
    const pen = slidePenalty(b, next);
    if (win) {
      return pen + leafScore(next);
    }
    const outs = spawnAll(next);
    if (d <= 0) {
      if (outs.length === 0) {
        const v = isTerminal(next, "standard") ? TERMINAL_LOSS : leafScore(next);
        return pen + v;
      }
      let sum0 = 0;
      for (const s of outs) {
        sum0 += isTerminal(s, "standard") ? TERMINAL_LOSS : leafScore(s);
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

  trimMapToMax(cache, config?.maxValueCacheSize ?? DEFAULT_HINT_MAX_VALUE_CACHE);
  trimMapToMax(leafScoreMemo, config?.maxLeafScoreCacheSize ?? DEFAULT_HINT_MAX_LEAF_CACHE);
  trimMapToMax(slidePenaltyMemo, config?.maxSlidePenaltyCacheSize ?? DEFAULT_HINT_MAX_SLIDE_CACHE);

  return result;
}

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
  /** 힌트 계산 시간 예산(ms). 초과 시 best-so-far로 조기 반환. */
  maxMs?: number;
  /** 힌트 계산 노드 예산. 초과 시 best-so-far로 조기 반환. */
  maxExpandedNodes?: number;
  /**
   * 세션 간 root-근처 캐시 보존 힌트.
   * 현재 루트에서 "다음 턴에 관측될 가능성이 높은" value-cache 키를 저장/재사용한다.
   */
  sessionPreferredValueKeys?: Set<string>;
  /** Phase 2 준비: 탐색 노드 그래프 컨텍스트(호출 간 누적). */
  searchContext?: HintSearchContext;
  /** Phase 2: re-root된 root 자식 MAX 노드를 호출 시작 시 선확장할 최대 수. */
  prewarmNodeExpansions?: number;
  /** searchContext 노드 상한. 초과 시 cold node eviction 수행. */
  contextMaxNodes?: number;
};

/** 기본 상한 — 메모리 폭주 방지용 슬라이딩 윈도우에 가깝게 동작. */
export const DEFAULT_HINT_MAX_VALUE_CACHE = 120_000;
export const DEFAULT_HINT_MAX_LEAF_CACHE = 60_000;
export const DEFAULT_HINT_MAX_SLIDE_CACHE = 40_000;

export type HintDebug = {
  expandedNodes: number;
  cacheHits: number;
  rootActionCount: number;
  budgetCutoff: boolean;
  cutoffByTime: boolean;
  cutoffByNodes: boolean;
  prewarmedNodes: number;
  prewarmCandidates: number;
  evictedContextNodes: number;
};

export type HintResult = {
  bestDirection: Direction;
  scores: Record<Direction, number | null>;
  searchedDepth: number;
  /** 설정값 기록용(탐색에서는 스폰 전부 사용). */
  beamWidth: number;
  debug?: HintDebug;
};

export type HintNodeType = "MAX" | "CHANCE";

export type HintSearchNode = {
  key: string;
  type: HintNodeType;
  boardKey: string;
  depth: number;
  value: number;
  children: string[];
  visits: number;
  lastUsedTick: number;
  generation: number;
};

export type HintSearchContext = {
  nodes: Map<string, HintSearchNode>;
  tick: number;
  generation: number;
  rootKey?: string;
};

export function createHintSearchContext(): HintSearchContext {
  return {
    nodes: new Map<string, HintSearchNode>(),
    tick: 0,
    generation: 0,
    rootKey: undefined,
  };
}

/**
 * 네 방향 각각의 기대값을 구하고 최선 방향 1개를 반환.
 */
function boardKey(b: Board): string {
  return b.join(",");
}

function hintNodeKey(type: HintNodeType, b: Board, depth: number): string {
  return `${type}:${depth}:${boardKey(b)}`;
}

function parseMaxNodeKey(key: string): { board: Board; depth: number } | null {
  const parts = key.split(":", 3);
  if (parts.length < 3) return null;
  if (parts[0] !== "MAX") return null;
  const depth = Number(parts[1]);
  if (!Number.isFinite(depth)) return null;
  const boardVals = parts[2]!.split(",").map((v) => Number(v));
  if (boardVals.length !== 9 || boardVals.some((v) => !Number.isFinite(v))) return null;
  return { board: boardVals as Board, depth: Math.max(0, Math.floor(depth)) };
}

function parseHintNodeKey(key: string): { type: HintNodeType; depth: number; boardKey: string } | null {
  const i1 = key.indexOf(":");
  const i2 = key.indexOf(":", i1 + 1);
  if (i1 <= 0 || i2 <= i1 + 1) return null;
  const type = key.slice(0, i1);
  if (type !== "MAX" && type !== "CHANCE") return null;
  const depth = Number(key.slice(i1 + 1, i2));
  if (!Number.isFinite(depth)) return null;
  return {
    type,
    depth: Math.max(0, Math.floor(depth)),
    boardKey: key.slice(i2 + 1),
  };
}

export function reRootHintSearchContext(
  ctx: HintSearchContext,
  board: Board,
  preferredDepth?: number
): boolean {
  const bKey = boardKey(board);
  let found: HintSearchNode | undefined;
  if (preferredDepth !== undefined) {
    const direct = ctx.nodes.get(`MAX:${preferredDepth}:${bKey}`);
    if (direct) found = direct;
  }
  if (!found) {
    for (const node of ctx.nodes.values()) {
      if (node.type !== "MAX") continue;
      if (node.boardKey !== bKey) continue;
      if (!found || node.depth > found.depth) found = node;
    }
  }
  if (!found) return false;
  ctx.tick += 1;
  ctx.generation += 1;
  found.lastUsedTick = ctx.tick;
  found.generation = ctx.generation;
  ctx.rootKey = found.key;
  return true;
}

export function evictColdSubtrees(
  ctx: HintSearchContext,
  maxNodes: number,
  pinnedKeys?: ReadonlySet<string>
): number {
  if (ctx.nodes.size <= maxNodes) return 0;
  const pinned = new Set<string>(pinnedKeys ?? []);
  if (ctx.rootKey) pinned.add(ctx.rootKey);

  const entries = Array.from(ctx.nodes.entries());
  entries.sort((a, b) => {
    const na = a[1];
    const nb = b[1];
    if (na.generation !== nb.generation) return na.generation - nb.generation;
    if (na.lastUsedTick !== nb.lastUsedTick) return na.lastUsedTick - nb.lastUsedTick;
    return na.visits - nb.visits;
  });

  let evicted = 0;
  for (const [k] of entries) {
    if (ctx.nodes.size <= maxNodes) break;
    if (pinned.has(k)) continue;
    if (ctx.nodes.delete(k)) evicted++;
  }
  return evicted;
}

function trimMapToMax(
  m: Map<string, number>,
  max: number,
  protectedKeys?: ReadonlySet<string>
): void {
  if (m.size <= max) return;
  if (!protectedKeys || protectedKeys.size === 0) {
    while (m.size > max) {
      const k = m.keys().next().value;
      if (k === undefined) break;
      m.delete(k);
    }
    return;
  }

  // 1) Prefer evicting cold keys first (not touched this call).
  for (const k of Array.from(m.keys())) {
    if (m.size <= max) break;
    if (!protectedKeys.has(k)) m.delete(k);
  }
  // 2) If still over max, evict oldest remaining keys.
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
  const touchedValueKeys = new Set<string>();
  const preferredValueKeysIn = config?.sessionPreferredValueKeys;
  const nextPreferredValueKeys = new Set<string>();

  const touchedLeafKeys = new Set<string>();
  const touchedSlideKeys = new Set<string>();
  const ctx = config?.searchContext;
  const rootChildMaxKeys = new Set<string>();
  if (ctx) {
    if (!reRootHintSearchContext(ctx, board, searchedDepth)) {
      ctx.tick += 1;
      ctx.generation += 1;
    }
  }

  function recordNode(
    type: HintNodeType,
    b: Board,
    depth: number,
    value: number,
    children?: string[]
  ): void {
    if (!ctx) return;
    const key = hintNodeKey(type, b, depth);
    const prev = ctx.nodes.get(key);
    if (prev) {
      prev.value = value;
      if (children) prev.children = children;
      prev.visits += 1;
      prev.lastUsedTick = ctx.tick;
      prev.generation = ctx.generation;
      return;
    }
    ctx.nodes.set(key, {
      key,
      type,
      boardKey: boardKey(b),
      depth,
      value,
      children: children ?? [],
      visits: 1,
      lastUsedTick: ctx.tick,
      generation: ctx.generation,
    });
  }

  function leafScore(b: Board): number {
    const k = boardKey(b);
    const hit = leafScoreMemo.get(k);
    if (hit !== undefined) {
      // LRU touch for session cache.
      leafScoreMemo.delete(k);
      leafScoreMemo.set(k, hit);
      touchedLeafKeys.add(k);
      return hit;
    }
    const v = scoreBoardV3(b, t);
    leafScoreMemo.set(k, v);
    touchedLeafKeys.add(k);
    return v;
  }

  function slidePenalty(before: Board, after: Board): number {
    const k = `${boardKey(before)}|${boardKey(after)}`;
    const hit = slidePenaltyMemo.get(k);
    if (hit !== undefined) {
      // LRU touch for session cache.
      slidePenaltyMemo.delete(k);
      slidePenaltyMemo.set(k, hit);
      touchedSlideKeys.add(k);
      return hit;
    }
    const v = lateGameSlidePenalty(before, after, 8, t);
    slidePenaltyMemo.set(k, v);
    touchedSlideKeys.add(k);
    return v;
  }

  let expandedNodes = 0;
  let cacheHits = 0;
  let budgetCutoff = false;
  let cutoffByTime = false;
  let cutoffByNodes = false;
  let prewarmedNodes = 0;
  let prewarmCandidates = 0;
  let evictedContextNodes = 0;
  const startMs = Date.now();
  const maxMs = config?.maxMs;
  const maxExpandedNodes = config?.maxExpandedNodes;
  function shouldCutoff(): boolean {
    if (maxExpandedNodes !== undefined && expandedNodes >= maxExpandedNodes) {
      budgetCutoff = true;
      cutoffByNodes = true;
      return true;
    }
    if (maxMs !== undefined && Date.now() - startMs >= maxMs) {
      budgetCutoff = true;
      cutoffByTime = true;
      return true;
    }
    return false;
  }

  function cacheKey(b: Board, d: number): string {
    return `${d}:${b.join(",")}`;
  }

  function chanceNodeKey(b: Board, d: number): string {
    return hintNodeKey("CHANCE", b, d);
  }

  function getOrderedDirections(b: Board, d: number, acts: Direction[]): Direction[] {
    if (!ctx) return ORDER_TIE;
    const ranked = ORDER_TIE.map((dir, idx) => {
      if (!acts.includes(dir)) return { dir, idx, score: -Infinity };
      const { next, moved, win } = slide(b, dir);
      if (!moved) return { dir, idx, score: -Infinity };
      if (win) return { dir, idx, score: Number.POSITIVE_INFINITY };
      const ch = ctx.nodes.get(chanceNodeKey(next, d));
      return { dir, idx, score: ch?.value ?? Number.NEGATIVE_INFINITY };
    });
    ranked.sort((a, b) => {
      if (a.score === b.score) return a.idx - b.idx;
      return b.score - a.score;
    });
    return ranked.map((x) => x.dir);
  }

  function cachedSearch(b: Board, d: number): number {
    if (shouldCutoff()) {
      return leafScore(b);
    }
    const k = cacheKey(b, d);
    const hit = cache.get(k);
    if (hit !== undefined) {
      cacheHits++;
      // LRU touch for session cache.
      cache.delete(k);
      cache.set(k, hit);
      touchedValueKeys.add(k);
      recordNode("MAX", b, d, hit);
      return hit;
    }
    expandedNodes++;
    const v = searchInner(b, d);
    cache.set(k, v);
    touchedValueKeys.add(k);
    recordNode("MAX", b, d, v);
    return v;
  }

  function searchInner(b: Board, d: number): number {
    if (shouldCutoff()) {
      return leafScore(b);
    }
    if (isTerminal(b, "standard")) {
      return TERMINAL_LOSS;
    }
    if (d <= 0) {
      return leafScore(b);
    }
    const acts = legalActions(b);
    let best = -Infinity;
    const dirs = getOrderedDirections(b, d, acts);
    for (const dir of dirs) {
      if (shouldCutoff()) break;
      if (!acts.includes(dir)) continue;
      const q = evaluateActionValue(b, dir, d);
      if (q !== null) best = Math.max(best, q);
    }
    return best === -Infinity ? leafScore(b) : best;
  }

  function evaluateActionValue(b: Board, dir: Direction, d: number): number | null {
    if (shouldCutoff()) {
      return leafScore(b);
    }
    const { next, moved, win } = slide(b, dir);
    if (!moved) return null;
    const pen = slidePenalty(b, next);
    if (win) {
      return pen + leafScore(next);
    }
    const outs = spawnAll(next);
    const chanceChildren = outs.map((s) => hintNodeKey("MAX", s, Math.max(0, d - 1)));
    if (d <= 0) {
      if (outs.length === 0) {
        const v = isTerminal(next, "standard") ? TERMINAL_LOSS : leafScore(next);
        return pen + v;
      }
      let sum0 = 0;
      let cnt0 = 0;
      for (const s of outs) {
        if (shouldCutoff()) break;
        sum0 += isTerminal(s, "standard") ? TERMINAL_LOSS : leafScore(s);
        cnt0++;
      }
      if (cnt0 <= 0) return pen + leafScore(next);
      const chanceV = pen + sum0 / cnt0;
      recordNode("CHANCE", next, d, chanceV, chanceChildren);
      return chanceV;
    }
    if (outs.length === 0) {
      const chanceV = pen + cachedSearch(next, d - 1);
      recordNode("CHANCE", next, d, chanceV, chanceChildren);
      return chanceV;
    }
    let sum = 0;
    let cnt = 0;
    for (const s of outs) {
      if (shouldCutoff()) break;
      sum += isTerminal(s, "standard") ? TERMINAL_LOSS : cachedSearch(s, d - 1);
      cnt++;
    }
    if (cnt <= 0) return pen + leafScore(next);
    const chanceV = pen + sum / cnt;
    recordNode("CHANCE", next, d, chanceV, chanceChildren);
    return chanceV;
  }

  function prewarmFromContextRoot(): void {
    if (!ctx?.rootKey) return;
    const root = ctx.nodes.get(ctx.rootKey);
    if (!root) return;
    if (root.children.length === 0) return;
    const budget = Math.max(0, Math.floor(config?.prewarmNodeExpansions ?? 12));
    if (budget <= 0) return;
    const candidates = new Map<string, number>();
    // Hop-1: root -> MAX children (likely next observed boards).
    for (const childKey of root.children) {
      const parsed = parseHintNodeKey(childKey);
      if (!parsed || parsed.type !== "MAX") continue;
      const n = ctx.nodes.get(childKey);
      const score = n?.value ?? 0;
      candidates.set(childKey, Math.max(candidates.get(childKey) ?? Number.NEGATIVE_INFINITY, score));
    }
    // Hop-2: root child MAX -> CHANCE -> MAX children.
    for (const maxKey of root.children) {
      const maxNode = ctx.nodes.get(maxKey);
      if (!maxNode) continue;
      for (const chanceKey of maxNode.children) {
        const chanceNode = ctx.nodes.get(chanceKey);
        if (!chanceNode || chanceNode.type !== "CHANCE") continue;
        for (const nextMaxKey of chanceNode.children) {
          const n = ctx.nodes.get(nextMaxKey);
          const score = (chanceNode.value + (n?.value ?? 0)) * 0.5;
          candidates.set(
            nextMaxKey,
            Math.max(candidates.get(nextMaxKey) ?? Number.NEGATIVE_INFINITY, score)
          );
        }
      }
    }

    const ordered = Array.from(candidates.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    prewarmCandidates = ordered.length;

    for (const childKey of ordered) {
      if (prewarmedNodes >= budget) break;
      if (shouldCutoff()) break;
      const parsed = parseMaxNodeKey(childKey);
      if (!parsed) continue;
      const before = expandedNodes;
      cachedSearch(parsed.board, parsed.depth);
      const delta = expandedNodes - before;
      prewarmedNodes += delta > 0 ? delta : 1;
    }
  }

  prewarmFromContextRoot();

  const acts = legalActions(board);
  const scores: Record<Direction, number | null> = {
    UP: null,
    DOWN: null,
    LEFT: null,
    RIGHT: null,
  };

  let rootEvaluated = 0;
  const rootDirs = getOrderedDirections(board, searchedDepth, acts);
  for (const dir of rootDirs) {
    if (shouldCutoff()) break;
    if (!acts.includes(dir)) {
      scores[dir] = null;
      continue;
    }
    const q = evaluateActionValue(board, dir, searchedDepth);
    scores[dir] = q;
    if (q !== null) rootEvaluated++;
    const { next, moved, win } = slide(board, dir);
    if (moved && !win && searchedDepth > 0) {
      for (const s of spawnAll(next)) {
        rootChildMaxKeys.add(hintNodeKey("MAX", s, searchedDepth - 1));
      }
    }
  }

  // Prepare "likely next-root" keys for next invocation.
  if (searchedDepth > 0) {
    for (const dir of ORDER_TIE) {
      if (!acts.includes(dir)) continue;
      const { next, moved, win } = slide(board, dir);
      if (!moved || win) continue;
      const outs = spawnAll(next);
      const nd = searchedDepth - 1;
      for (const s of outs) {
        nextPreferredValueKeys.add(cacheKey(s, nd));
      }
    }
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
      budgetCutoff,
      cutoffByTime,
      cutoffByNodes,
      prewarmedNodes,
      prewarmCandidates,
      evictedContextNodes,
    };
  }

  trimMapToMax(
    cache,
    config?.maxValueCacheSize ?? DEFAULT_HINT_MAX_VALUE_CACHE,
    new Set<string>([
      ...touchedValueKeys,
      ...(preferredValueKeysIn ?? []),
      ...nextPreferredValueKeys,
    ])
  );
  trimMapToMax(
    leafScoreMemo,
    config?.maxLeafScoreCacheSize ?? DEFAULT_HINT_MAX_LEAF_CACHE,
    touchedLeafKeys
  );
  trimMapToMax(
    slidePenaltyMemo,
    config?.maxSlidePenaltyCacheSize ?? DEFAULT_HINT_MAX_SLIDE_CACHE,
    touchedSlideKeys
  );

  if (config?.sessionPreferredValueKeys) {
    config.sessionPreferredValueKeys.clear();
    for (const k of nextPreferredValueKeys) {
      config.sessionPreferredValueKeys.add(k);
    }
  }

  if (ctx) {
    const rootV = bestScore === -Infinity ? leafScore(board) : bestScore;
    recordNode("MAX", board, searchedDepth, rootV, Array.from(rootChildMaxKeys));
    ctx.rootKey = hintNodeKey("MAX", board, searchedDepth);
    const ctxMaxNodes = Math.max(
      2000,
      Math.floor(config?.contextMaxNodes ?? (config?.maxValueCacheSize ?? DEFAULT_HINT_MAX_VALUE_CACHE))
    );
    evictedContextNodes = evictColdSubtrees(
      ctx,
      ctxMaxNodes,
      new Set<string>([ctx.rootKey, ...rootChildMaxKeys])
    );
  }

  return result;
}

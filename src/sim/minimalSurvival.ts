/**
 * 최소 생존 목표: legal / empty / 인접 동일쌍 / 1스폰 생존 분기 수만 사용.
 * scoreBoardV3·expectimax와 독립.
 */
import type { Board, Direction, Policy, TerminalReason } from "./types";
import { LEN, boardEquals, emptyCount, maxTileLevel } from "./board";
import { legalActions } from "./legal";
import { slide } from "./slide";
import { spawnAll, spawnRandom } from "./spawn";
import type { ClosureAnchorIndex, ClosureCtx, RebuildFollowupPending } from "./closureMode";
import {
  advanceClosureCtx,
  createClosureCtx,
  detectCornerWithMax,
  getClosureModeStatus,
  getTopTwoDistance,
  topTwoTilesMustRemainInsideAnchorBlock,
} from "./closureMode";
import { countMergesAtLevelInSlide, countTilesEqual, immediateMergeCount, secondMaxTile } from "./boardStats";
import type { ClosureDebugCounters, ClosureSearchResult } from "./closureSearch";
import {
  closureDebugCounters,
  compareSpawnRiskWorstFirst,
  closureSearch,
  countViableMoves,
  getClosureDecisionReport,
  getViabilityProfile,
  hasRebuildSuccess,
  recordClosureDecision,
  recordClosureEntry,
  recordClosureRepeatedBoardHit,
  resetClosureDebugCounters,
  snapshotClosureDebugCounters,
} from "./closureSearch";
import {
  adaptiveHlConversionBonus,
  createsHighLevelMerge,
  getMaxTileGap,
  getTopEndPairability,
} from "./topEndPairability";

const DIR_ORDER: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];
export const PRECLOSURE_GAP_IMPROVE_BONUS = 350;
export const PRECLOSURE_GAP_TO_ONE_BONUS = 700;
export const PRECLOSURE_ORTH_CREATE_BONUS = 500;
export const PRECLOSURE_ONESTEP_DROP_PENALTY = 400;
const MINIMAL_HINT_ORDER: Direction[] = ["DOWN", "UP", "LEFT", "RIGHT"];
export const MINIMAL_HINT_LATE_THRESHOLD = 7;
export const MINIMAL_HINT_DEPTH_EARLY = 4;
export const MINIMAL_HINT_DEPTH_LATE = 10;
const REBUILD_MICRO_ROLLOUT_HORIZON = 4;
const EARLY_SEARCH_TIME_BUDGET_MS = 60;
const CRITICAL_SEARCH_TIME_BUDGET_MS = 200;
const POST7_SEARCH_TIME_BUDGET_MS = 1000;
const SEARCH_TRANSPOSITION_TABLE_MAX_SIZE = 100_000;
const SEARCH_TRANSPOSITION_TABLE_EVICT_COUNT = 10_000;
const SEARCH_LOGGING_ENABLED = process.env.CLOSURE_AB_LOG_SEARCH === "1";
const ORACLE_SEARCH_ENABLED = process.env.CLOSURE_AB_ORACLE_SEARCH === "1";
const ORACLE_CRITICAL_SEARCH_HORIZON = 18;
const ORACLE_POST7_SEARCH_HORIZON = 24;
const ORACLE_CRITICAL_EXPANDED_NODE_CAP = 200_000;
const ORACLE_POST7_EXPANDED_NODE_CAP = 400_000;
const SEARCH_SCORE_EPSILON = 1e-6;

/** legal slide가 하나도 없으면 종료(패배) 보드. */
export function isSurvivalTerminal(board: Board): boolean {
  return legalActions(board).length === 0;
}

/** 상하좌우 인접한 동일 레벨(>0) 쌍 개수 (각 무향 간선 1회). */
export function countImmediateMergePairs(board: Board): number {
  let n = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const v = board[i]!;
      if (v === 0) continue;
      if (c < 2) {
        const w = board[i + 1]!;
        if (w !== 0 && v === w) n++;
      }
      if (r < 2) {
        const w = board[i + 3]!;
        if (w !== 0 && v === w) n++;
      }
    }
  }
  return n;
}

/**
 * 각 legal slide 후(승리면 1), spawnAll(level-1) 각 결과에 대해
 * 다음 턴에 slide 가능한 분기 수를 합산.
 */
export function countOneStepSurvivors(board: Board): number {
  let total = 0;
  for (const d of legalActions(board)) {
    const { next, win } = slide(board, d);
    if (win) {
      total += 1;
      continue;
    }
    for (const spawned of spawnAll(next)) {
      if (legalActions(spawned).length > 0) total += 1;
    }
  }
  return total;
}

/**
 * 막판 직전 느낌: 아래 4가지 중 2개 이상이면 true.
 * 종료 보드(합법 수 0)는 "near"가 아니라 이미 dead로 분리.
 */
/** legal>0 인 보드에서만 호출하는 것을 권장(종료 보드는 near-dead 아님). */
export function isNearDeadFromComponents(
  legal: number,
  empty: number,
  mergeNow: number,
  survivalNext: number
): boolean {
  let c = 0;
  if (legal <= 1) c++;
  if (empty <= 1) c++;
  if (mergeNow === 0) c++;
  if (survivalNext <= 1) c++;
  return c >= 2;
}

export function isNearDead(board: Board): boolean {
  if (isSurvivalTerminal(board)) return false;
  const legal = legalActions(board).length;
  const empty = emptyCount(board);
  const mergeNow = countImmediateMergePairs(board);
  const survivalNext = countOneStepSurvivors(board);
  return isNearDeadFromComponents(legal, empty, mergeNow, survivalNext);
}

export function scoreBoardMinimal(board: Board): number {
  const legal = legalActions(board).length;
  const empty = emptyCount(board);
  const mergeNow = countImmediateMergePairs(board);
  const survivalNext = countOneStepSurvivors(board);
  const term = legal === 0 ? 1 : 0;
  const near = legal > 0 && isNearDeadFromComponents(legal, empty, mergeNow, survivalNext) ? 1 : 0;
  return (
    1000 * legal +
    300 * empty +
    400 * mergeNow +
    500 * survivalNext -
    1_000_000 * term -
    10_000 * near
  );
}

export function isPreClosureArmed(board: Board): boolean {
  const pair = getTopEndPairability(board);
  return getMaxTileGap(board) <= 2 && pair.oneSlideTop2Adj && countOneStepSurvivors(board) >= 4;
}

export function preClosureShapingAdjustment(before: Board, afterSlide: Board): number {
  if (!isPreClosureArmed(before)) return 0;

  const beforePair = getTopEndPairability(before);
  const afterPair = getTopEndPairability(afterSlide);
  const beforeGap = getMaxTileGap(before);
  const afterGap = getMaxTileGap(afterSlide);
  const beforeOneStep = countOneStepSurvivors(before);
  const afterOneStep = countOneStepSurvivors(afterSlide);

  let delta = 0;
  if (afterGap < beforeGap) {
    delta += PRECLOSURE_GAP_IMPROVE_BONUS;
  }
  if (beforeGap > 1 && afterGap <= 1) {
    delta += PRECLOSURE_GAP_TO_ONE_BONUS;
  }
  if (!beforePair.top2OrthAdj && afterPair.top2OrthAdj) {
    delta += PRECLOSURE_ORTH_CREATE_BONUS;
  }
  if (afterOneStep < beforeOneStep - 2) {
    delta -= PRECLOSURE_ONESTEP_DROP_PENALTY;
  }
  return delta;
}

function scoreActionWithCurrentHeuristics(before: Board, afterSlide: Board): number {
  return (
    scoreBoardMinimal(afterSlide) +
    adaptiveHlConversionBonus(before, afterSlide) +
    preClosureShapingAdjustment(before, afterSlide)
  );
}

/**
 * hint/expectimax 스타일의 로컬 탐색:
 * - depth=1: Q(a)=즉시 action 점수 + E_spawn[leaf]
 * - depth=2: Q(a)=즉시 action 점수 + E_spawn[max_a' Q1(a')]
 */
export type MinimalHintHybridConfig = {
  /** 고정 depth를 강제하고 싶을 때 사용(미지정 시 early/late 규칙 사용). */
  depth?: number;
  lateThreshold?: number;
  depthEarly?: number;
  depthLate?: number;
};

function maxQMinimalHint(board: Board, depth: number, memo: Map<string, number>): number {
  if (depth <= 0) return scoreBoardMinimal(board);
  const key = `${depth}:${board.join(",")}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  const acts = legalActions(board);
  if (acts.length === 0) return scoreBoardMinimal(board);
  let best = Number.NEGATIVE_INFINITY;
  for (const d of MINIMAL_HINT_ORDER) {
    if (!acts.includes(d)) continue;
    const q = evaluateActionMinimalHint(board, d, depth, memo);
    if (q > best) best = q;
  }
  const out = best === Number.NEGATIVE_INFINITY ? scoreBoardMinimal(board) : best;
  memo.set(key, out);
  return out;
}

export function evaluateActionMinimalHint(
  board: Board,
  action: Direction,
  depth = 2,
  memo: Map<string, number> = new Map()
): number {
  const { next, moved, win } = slide(board, action);
  if (!moved) return Number.NEGATIVE_INFINITY;
  const immediate = scoreActionWithCurrentHeuristics(board, next);
  if (win) return immediate + 1_000_000_000;

  const outcomes = spawnAll(next);
  if (outcomes.length === 0) return immediate + scoreBoardMinimal(next);

  if (depth <= 1) {
    let sum = 0;
    for (const s of outcomes) sum += scoreBoardMinimal(s);
    return immediate + sum / outcomes.length;
  }

  let sum = 0;
  for (const s of outcomes) {
    sum += maxQMinimalHint(s, depth - 1, memo);
  }
  return immediate + sum / outcomes.length;
}

/** greedy: slide 직후 보드에 대해 scoreBoardMinimal 최대인 방향. 승리 수는 즉시 선택. */
export function minimalPolicy(board: Board, actions: Direction[]): Direction {
  let bestScore = Number.NEGATIVE_INFINITY;
  const tied: Direction[] = [];
  for (const d of actions) {
    const { next, win, moved } = slide(board, d);
    if (win) return d;
    if (!moved) continue;
    const s =
      scoreBoardMinimal(next) +
      adaptiveHlConversionBonus(board, next) +
      preClosureShapingAdjustment(board, next);
    if (s > bestScore) {
      bestScore = s;
      tied.length = 0;
      tied.push(d);
    } else if (s === bestScore) {
      tied.push(d);
    }
  }
  for (const d of DIR_ORDER) {
    if (tied.includes(d)) return d;
  }
  return actions[0]!;
}

type CachedSlideResult = {
  next: Board;
  moved: boolean;
  win: boolean;
};

type HighestMergeInfo = {
  level: number;
  count: number;
};

type MergeStateSignals = {
  highestImmediateMergeLevel: number;
  highestImmediateMergeCount: number;
  highestNearTermMergeLevel: number;
  highestNearTermMergeCount: number;
  chainSustainMergeCount: number;
  hasAnyMergeNow: boolean;
  hasAnyNearTermMerge: boolean;
  viableMoveCount: number;
  emptyCount: number;
};

type MoveMergeOpportunitySummary = {
  direction: Direction;
  capturedImmediate77: boolean;
  capturedImmediate66: boolean;
  capturedOnlyChainSustainMerge: boolean;
  missedImmediateHighMerge: boolean;
  spawnCount: number;
  allSpawnsNoMerge: boolean;
  noMergeShare: number;
  worstHighestImmediateMergeLevel: number;
  worstHighestNearTermMergeLevel: number;
  meanChainSustainMergeCount: number;
  meanViableMoveCount: number;
  meanEmptyCount: number;
  baseScore: number;
};

type BestFirstSearchConfig = {
  horizon: number;
  reachabilityDepth: number;
  reachabilityBeamWidth: number;
  useAllSpawns: boolean;
  spawnSampleLimit: number;
  expandedNodeCap: number | null;
  decisionExpandedNodeCap: number | null;
  rootScreeningBudgetFraction: number;
  rootRefineTopK: number;
  maxFrontierSize: number | null;
  maxPerRootFrontierSize: number | null;
  maxPerSpawnLineFrontierSize: number | null;
};

type StateKey = bigint;

type FrontierEntry = {
  priority: number;
  score: number;
  depth: number;
};

type DepthHistogram = Record<number, number>;

type SearchRuntimeBreakdown = {
  canonicalTimeMs: number;
  heapTimeMs: number;
  expandTimeMs: number;
  evalSignalsTimeMs: number;
  viableCountTimeMs: number;
  scoreComputeTimeMs: number;
  transpositionCheckTimeMs: number;
  frontierDedupeTimeMs: number;
};

type SearchNode = {
  board: Board;
  stateKey: StateKey;
  depth: number;
  score: number;
  priority: number;
  signals: MergeStateSignals;
};

type SearchLineSummary = {
  bestScore: number;
  bestDepthReached: number;
  maxDepthReached: number;
  expandedNodes: number;
  cacheHitCount: number;
  cacheMissCount: number;
  duplicatePrunedCount: number;
  noLegalMovePrunedCount: number;
  nodeCapHit: boolean;
  maxFrontierSize: number;
  generatedNodes: number;
  enqueuedNodes: number;
  enqueueDuplicateSkipped: number;
  enqueueDominatedSkipped: number;
  popDuplicateSkipped: number;
  frontierPeakSize: number;
  expandedByDepth: DepthHistogram;
  enqueuedByDepth: DepthHistogram;
  runtimeBreakdown: SearchRuntimeBreakdown;
  searchTimeMs: number;
  bestImmediateMergeLevelSeen: number;
  bestNearTermMergeLevelSeen: number;
  bestChainSustainMergeCountSeen: number;
  finalHighestImmediateMergeLevel: number;
  finalHighestNearTermMergeLevel: number;
  finalChainSustainMergeCount: number;
  finalViableMoveCount: number;
  finalEmptyCount: number;
  finalNoMerge: boolean;
};

type SearchStage = "early" | "critical" | "post7";

type RootReachabilitySummary = {
  targetLevel: number;
  reachableRatio: number | null;
  worstReachableImmediateMergeLevel: number;
  worstReachableNearTermMergeLevel: number;
  reachabilityTimeMs: number;
};

type StageDecisionMetrics = {
  elapsedMs: number;
  searchTimeMs: number;
  reachabilityTimeMs: number;
  searchSummaryCount: number;
  searchSpawnChildCount: number;
  expandedNodes: number;
  cacheHitCount: number;
  cacheMissCount: number;
  duplicatePrunedCount: number;
  noLegalMovePrunedCount: number;
  nodeCapHitCount: number;
  maxFrontierSizePeak: number;
  rootEvaluationCount: number;
  generatedNodes: number;
  enqueuedNodes: number;
  enqueueDuplicateSkipped: number;
  enqueueDominatedSkipped: number;
  popDuplicateSkipped: number;
  frontierPeakSize: number;
  chosenBestDepthReached: number;
};

type MoveSearchSummary = {
  transition: MoveMergeOpportunitySummary;
  config: BestFirstSearchConfig;
  targetLevel: number;
  searchScore: number;
  reachableRatio: number | null;
  worstReachableImmediateMergeLevel: number;
  worstReachableNearTermMergeLevel: number;
  finalNoMergeShare: number;
  meanBestImmediateMergeLevelSeen: number;
  meanBestNearTermMergeLevelSeen: number;
  meanBestChainSustainMergeCountSeen: number;
  meanFinalViableMoveCount: number;
  meanFinalEmptyCount: number;
  bestDepthReached: number;
  maxDepthReached: number;
  expandedNodes: number;
  cacheHitCount: number;
  cacheMissCount: number;
  cacheHitRate: number;
  searchSpawnChildCount: number;
  searchSummaryCount: number;
  duplicatePrunedCount: number;
  noLegalMovePrunedCount: number;
  nodeCapHitCount: number;
  maxFrontierSize: number;
  generatedNodes: number;
  enqueuedNodes: number;
  enqueueDuplicateSkipped: number;
  enqueueDominatedSkipped: number;
  popDuplicateSkipped: number;
  frontierPeakSize: number;
  expandedByDepth: DepthHistogram;
  enqueuedByDepth: DepthHistogram;
  runtimeBreakdown: SearchRuntimeBreakdown;
  topCandidateDepth: number;
  topCandidateScore: number;
  searchTimeMs: number;
  reachabilityTimeMs: number;
};

type SearchPassSummary = {
  summaries: MoveSearchSummary[];
  expandedNodes: number;
  cacheHitCount: number;
  cacheMissCount: number;
  searchTimeMs: number;
  reachabilityTimeMs: number;
  searchSummaryCount: number;
  searchSpawnChildCount: number;
  duplicatePrunedCount: number;
  noLegalMovePrunedCount: number;
  nodeCapHitCount: number;
  maxFrontierSizePeak: number;
  rootEvaluationCount: number;
  generatedNodes: number;
  enqueuedNodes: number;
  enqueueDuplicateSkipped: number;
  enqueueDominatedSkipped: number;
  popDuplicateSkipped: number;
  frontierPeakSize: number;
  expandedByDepth: DepthHistogram;
  enqueuedByDepth: DepthHistogram;
  runtimeBreakdown: SearchRuntimeBreakdown;
};

type ReachabilityOptions = {
  depth: number;
  beamWidth: number;
  useAllSpawns: boolean;
  spawnSampleLimit: number;
};

type CacheEntry = {
  bestScoreSeen: number;
  depthSeen: number;
  lastVisitTs: number;
};

type MinimalPolicyExperimentCounterState = {
  mergeWindowEntryCount: number;
  mergeMoveEvaluatedCount: number;
  mergeChosenMoveCount: number;
  mergeChosenCapturedImmediate77Count: number;
  mergeChosenCapturedImmediate66Count: number;
  mergeChosenCapturedOnlyChainSustainCount: number;
  mergeChosenMissedImmediateHighMergeCount: number;
  mergeChosenAllSpawnsNoMergeCount: number;
  mergeChosenNoMergeShareSum: number;
  mergeChosenWorstImmediateMergeLevelSum: number;
  mergeChosenWorstNearTermMergeLevelSum: number;
  mergeChosenChainSustainMergeCountSum: number;
  mergeChosenMeanViableMoveCountSum: number;
  mergeTotalSpawnChildrenEvaluated: number;
  moveCacheHitCount: number;
  moveCacheMissCount: number;
  spawnCacheHitCount: number;
  spawnCacheMissCount: number;
  stateSignalCacheHitCount: number;
  stateSignalCacheMissCount: number;
  earlySearchDecisionCount: number;
  earlySearchTotalTimeMs: number;
  earlySearchTotalSearchTimeMs: number;
  earlySearchTotalReachabilityTimeMs: number;
  earlySearchSummaryCount: number;
  earlySearchSpawnChildCount: number;
  earlySearchRootEvaluationCount: number;
  earlySearchExpandedNodeCount: number;
  earlySearchGeneratedNodeCount: number;
  earlySearchEnqueuedNodeCount: number;
  earlySearchEnqueueDuplicateSkippedCount: number;
  earlySearchEnqueueDominatedSkippedCount: number;
  earlySearchPopDuplicateSkippedCount: number;
  earlySearchFrontierPeakSizePeak: number;
  earlySearchBestDepthReachedSum: number;
  earlySearchBestDepthReachedPeak: number;
  earlySearchCacheHitCount: number;
  earlySearchCacheMissCount: number;
  earlySearchDuplicatePrunedCount: number;
  earlySearchNoLegalMovePrunedCount: number;
  earlySearchNodeCapHitCount: number;
  earlySearchMaxFrontierSizePeak: number;
  criticalSearchDecisionCount: number;
  criticalSearchTotalTimeMs: number;
  criticalSearchTotalSearchTimeMs: number;
  criticalSearchTotalReachabilityTimeMs: number;
  criticalSearchSummaryCount: number;
  criticalSearchSpawnChildCount: number;
  criticalSearchRootEvaluationCount: number;
  criticalSearchExpandedNodeCount: number;
  criticalSearchGeneratedNodeCount: number;
  criticalSearchEnqueuedNodeCount: number;
  criticalSearchEnqueueDuplicateSkippedCount: number;
  criticalSearchEnqueueDominatedSkippedCount: number;
  criticalSearchPopDuplicateSkippedCount: number;
  criticalSearchFrontierPeakSizePeak: number;
  criticalSearchBestDepthReachedSum: number;
  criticalSearchBestDepthReachedPeak: number;
  criticalSearchCacheHitCount: number;
  criticalSearchCacheMissCount: number;
  criticalSearchDuplicatePrunedCount: number;
  criticalSearchNoLegalMovePrunedCount: number;
  criticalSearchNodeCapHitCount: number;
  criticalSearchMaxFrontierSizePeak: number;
  post7SearchDecisionCount: number;
  post7SearchTotalTimeMs: number;
  post7SearchTotalSearchTimeMs: number;
  post7SearchTotalReachabilityTimeMs: number;
  post7SearchSummaryCount: number;
  post7SearchSpawnChildCount: number;
  post7SearchRootEvaluationCount: number;
  post7SearchExpandedNodeCount: number;
  post7SearchGeneratedNodeCount: number;
  post7SearchEnqueuedNodeCount: number;
  post7SearchEnqueueDuplicateSkippedCount: number;
  post7SearchEnqueueDominatedSkippedCount: number;
  post7SearchPopDuplicateSkippedCount: number;
  post7SearchFrontierPeakSizePeak: number;
  post7SearchBestDepthReachedSum: number;
  post7SearchBestDepthReachedPeak: number;
  post7SearchChosenSearchScoreSum: number;
  post7SearchChosenReachableRatioSum: number;
  post7SearchChosenMeanWorstReachableImmediateMergeLevelSum: number;
  post7SearchChosenMeanWorstReachableNearTermMergeLevelSum: number;
  post7SearchChosenFinalNoMergeShareSum: number;
  post7SearchCacheHitCount: number;
  post7SearchCacheMissCount: number;
  post7SearchDuplicatePrunedCount: number;
  post7SearchNoLegalMovePrunedCount: number;
  post7SearchNodeCapHitCount: number;
  post7SearchMaxFrontierSizePeak: number;
};

export type MinimalPolicyExperimentDebugCounters = {
  mergeWindowEntryCount: number;
  mergeMoveEvaluatedCount: number;
  mergeChosenMoveCount: number;
  mergeChosenCapturedImmediate77Count: number;
  mergeChosenCapturedImmediate66Count: number;
  mergeChosenCapturedOnlyChainSustainCount: number;
  mergeChosenMissedImmediateHighMergeCount: number;
  mergeChosenAllSpawnsNoMergeCount: number;
  mergeChosenMeanNoMergeShare: number;
  mergeChosenMeanWorstImmediateMergeLevel: number;
  mergeChosenMeanWorstNearTermMergeLevel: number;
  mergeChosenMeanChainSustainMergeCount: number;
  mergeChosenMeanViableMoveCount: number;
  mergeTotalSpawnChildrenEvaluated: number;
  moveCacheHitCount: number;
  moveCacheMissCount: number;
  spawnCacheHitCount: number;
  spawnCacheMissCount: number;
  stateSignalCacheHitCount: number;
  stateSignalCacheMissCount: number;
  earlySearchDecisionCount: number;
  earlySearchMeanMoveTimeMs: number;
  earlySearchMeanSearchTimeMs: number;
  earlySearchMeanReachabilityTimeMs: number;
  earlySearchSummaryCount: number;
  earlySearchSpawnChildCount: number;
  earlySearchMeanSpawnChildCount: number;
  earlySearchRootEvaluationCount: number;
  earlySearchExpandedNodeCount: number;
  earlySearchMeanPerRootExpandedNodes: number;
  earlySearchGeneratedNodeCount: number;
  earlySearchEnqueuedNodeCount: number;
  earlySearchMeanPerRootEnqueuedNodes: number;
  earlySearchEnqueueDuplicateSkippedCount: number;
  earlySearchEnqueueDominatedSkippedCount: number;
  earlySearchPopDuplicateSkippedCount: number;
  earlySearchFrontierPeakSizePeak: number;
  earlySearchMeanBestDepthReached: number;
  earlySearchBestDepthReachedPeak: number;
  earlySearchCacheHitCount: number;
  earlySearchCacheMissCount: number;
  earlySearchDuplicatePrunedCount: number;
  earlySearchNoLegalMovePrunedCount: number;
  earlySearchNodeCapHitCount: number;
  earlySearchMaxFrontierSizePeak: number;
  criticalSearchDecisionCount: number;
  criticalSearchMeanMoveTimeMs: number;
  criticalSearchMeanSearchTimeMs: number;
  criticalSearchMeanReachabilityTimeMs: number;
  criticalSearchSummaryCount: number;
  criticalSearchSpawnChildCount: number;
  criticalSearchMeanSpawnChildCount: number;
  criticalSearchRootEvaluationCount: number;
  criticalSearchExpandedNodeCount: number;
  criticalSearchMeanPerRootExpandedNodes: number;
  criticalSearchGeneratedNodeCount: number;
  criticalSearchEnqueuedNodeCount: number;
  criticalSearchMeanPerRootEnqueuedNodes: number;
  criticalSearchEnqueueDuplicateSkippedCount: number;
  criticalSearchEnqueueDominatedSkippedCount: number;
  criticalSearchPopDuplicateSkippedCount: number;
  criticalSearchFrontierPeakSizePeak: number;
  criticalSearchMeanBestDepthReached: number;
  criticalSearchBestDepthReachedPeak: number;
  criticalSearchCacheHitCount: number;
  criticalSearchCacheMissCount: number;
  criticalSearchDuplicatePrunedCount: number;
  criticalSearchNoLegalMovePrunedCount: number;
  criticalSearchNodeCapHitCount: number;
  criticalSearchMaxFrontierSizePeak: number;
  post7SearchDecisionCount: number;
  post7SearchMeanMoveTimeMs: number;
  post7SearchMeanSearchTimeMs: number;
  post7SearchMeanReachabilityTimeMs: number;
  post7SearchSummaryCount: number;
  post7SearchSpawnChildCount: number;
  post7SearchMeanSpawnChildCount: number;
  post7SearchRootEvaluationCount: number;
  post7SearchExpandedNodeCount: number;
  post7SearchMeanPerRootExpandedNodes: number;
  post7SearchGeneratedNodeCount: number;
  post7SearchEnqueuedNodeCount: number;
  post7SearchMeanPerRootEnqueuedNodes: number;
  post7SearchEnqueueDuplicateSkippedCount: number;
  post7SearchEnqueueDominatedSkippedCount: number;
  post7SearchPopDuplicateSkippedCount: number;
  post7SearchFrontierPeakSizePeak: number;
  post7SearchMeanBestDepthReached: number;
  post7SearchBestDepthReachedPeak: number;
  post7SearchChosenMeanSearchScore: number;
  post7SearchChosenMeanReachableRatio: number;
  post7SearchChosenMeanWorstReachableImmediateMergeLevel: number;
  post7SearchChosenMeanWorstReachableNearTermMergeLevel: number;
  post7SearchChosenMeanFinalNoMergeShare: number;
  post7SearchCacheHitCount: number;
  post7SearchCacheMissCount: number;
  post7SearchDuplicatePrunedCount: number;
  post7SearchNoLegalMovePrunedCount: number;
  post7SearchNodeCapHitCount: number;
  post7SearchMaxFrontierSizePeak: number;
};

const minimalPolicyExperimentCounterState: MinimalPolicyExperimentCounterState = {
  mergeWindowEntryCount: 0,
  mergeMoveEvaluatedCount: 0,
  mergeChosenMoveCount: 0,
  mergeChosenCapturedImmediate77Count: 0,
  mergeChosenCapturedImmediate66Count: 0,
  mergeChosenCapturedOnlyChainSustainCount: 0,
  mergeChosenMissedImmediateHighMergeCount: 0,
  mergeChosenAllSpawnsNoMergeCount: 0,
  mergeChosenNoMergeShareSum: 0,
  mergeChosenWorstImmediateMergeLevelSum: 0,
  mergeChosenWorstNearTermMergeLevelSum: 0,
  mergeChosenChainSustainMergeCountSum: 0,
  mergeChosenMeanViableMoveCountSum: 0,
  mergeTotalSpawnChildrenEvaluated: 0,
  moveCacheHitCount: 0,
  moveCacheMissCount: 0,
  spawnCacheHitCount: 0,
  spawnCacheMissCount: 0,
  stateSignalCacheHitCount: 0,
  stateSignalCacheMissCount: 0,
  earlySearchDecisionCount: 0,
  earlySearchTotalTimeMs: 0,
  earlySearchTotalSearchTimeMs: 0,
  earlySearchTotalReachabilityTimeMs: 0,
  earlySearchSummaryCount: 0,
  earlySearchSpawnChildCount: 0,
  earlySearchRootEvaluationCount: 0,
  earlySearchExpandedNodeCount: 0,
  earlySearchGeneratedNodeCount: 0,
  earlySearchEnqueuedNodeCount: 0,
  earlySearchEnqueueDuplicateSkippedCount: 0,
  earlySearchEnqueueDominatedSkippedCount: 0,
  earlySearchPopDuplicateSkippedCount: 0,
  earlySearchFrontierPeakSizePeak: 0,
  earlySearchBestDepthReachedSum: 0,
  earlySearchBestDepthReachedPeak: 0,
  earlySearchCacheHitCount: 0,
  earlySearchCacheMissCount: 0,
  earlySearchDuplicatePrunedCount: 0,
  earlySearchNoLegalMovePrunedCount: 0,
  earlySearchNodeCapHitCount: 0,
  earlySearchMaxFrontierSizePeak: 0,
  criticalSearchDecisionCount: 0,
  criticalSearchTotalTimeMs: 0,
  criticalSearchTotalSearchTimeMs: 0,
  criticalSearchTotalReachabilityTimeMs: 0,
  criticalSearchSummaryCount: 0,
  criticalSearchSpawnChildCount: 0,
  criticalSearchRootEvaluationCount: 0,
  criticalSearchExpandedNodeCount: 0,
  criticalSearchGeneratedNodeCount: 0,
  criticalSearchEnqueuedNodeCount: 0,
  criticalSearchEnqueueDuplicateSkippedCount: 0,
  criticalSearchEnqueueDominatedSkippedCount: 0,
  criticalSearchPopDuplicateSkippedCount: 0,
  criticalSearchFrontierPeakSizePeak: 0,
  criticalSearchBestDepthReachedSum: 0,
  criticalSearchBestDepthReachedPeak: 0,
  criticalSearchCacheHitCount: 0,
  criticalSearchCacheMissCount: 0,
  criticalSearchDuplicatePrunedCount: 0,
  criticalSearchNoLegalMovePrunedCount: 0,
  criticalSearchNodeCapHitCount: 0,
  criticalSearchMaxFrontierSizePeak: 0,
  post7SearchDecisionCount: 0,
  post7SearchTotalTimeMs: 0,
  post7SearchTotalSearchTimeMs: 0,
  post7SearchTotalReachabilityTimeMs: 0,
  post7SearchSummaryCount: 0,
  post7SearchSpawnChildCount: 0,
  post7SearchRootEvaluationCount: 0,
  post7SearchExpandedNodeCount: 0,
  post7SearchGeneratedNodeCount: 0,
  post7SearchEnqueuedNodeCount: 0,
  post7SearchEnqueueDuplicateSkippedCount: 0,
  post7SearchEnqueueDominatedSkippedCount: 0,
  post7SearchPopDuplicateSkippedCount: 0,
  post7SearchFrontierPeakSizePeak: 0,
  post7SearchBestDepthReachedSum: 0,
  post7SearchBestDepthReachedPeak: 0,
  post7SearchChosenSearchScoreSum: 0,
  post7SearchChosenReachableRatioSum: 0,
  post7SearchChosenMeanWorstReachableImmediateMergeLevelSum: 0,
  post7SearchChosenMeanWorstReachableNearTermMergeLevelSum: 0,
  post7SearchChosenFinalNoMergeShareSum: 0,
  post7SearchCacheHitCount: 0,
  post7SearchCacheMissCount: 0,
  post7SearchDuplicatePrunedCount: 0,
  post7SearchNoLegalMovePrunedCount: 0,
  post7SearchNodeCapHitCount: 0,
  post7SearchMaxFrontierSizePeak: 0,
};

const minimalPolicyExperimentMoveCache = new Map<string, CachedSlideResult>();
const minimalPolicyExperimentSpawnCache = new Map<string, readonly Board[]>();
const minimalPolicyExperimentViableCountCache = new Map<string, number>();
const minimalPolicyExperimentStateSignalCache = new Map<string, MergeStateSignals>();
const minimalPolicyExperimentSearchTranspositionTable = new Map<bigint, CacheEntry>();
const minimalPolicyExperimentPairReachabilityCache = new Map<string, boolean>();
let minimalPolicyExperimentSearchVisitClock = 0;
let activeSearchRuntimeBreakdown: SearchRuntimeBreakdown | null = null;

export function resetMinimalPolicyExperimentDebugCounters(): void {
  minimalPolicyExperimentCounterState.mergeWindowEntryCount = 0;
  minimalPolicyExperimentCounterState.mergeMoveEvaluatedCount = 0;
  minimalPolicyExperimentCounterState.mergeChosenMoveCount = 0;
  minimalPolicyExperimentCounterState.mergeChosenCapturedImmediate77Count = 0;
  minimalPolicyExperimentCounterState.mergeChosenCapturedImmediate66Count = 0;
  minimalPolicyExperimentCounterState.mergeChosenCapturedOnlyChainSustainCount = 0;
  minimalPolicyExperimentCounterState.mergeChosenMissedImmediateHighMergeCount = 0;
  minimalPolicyExperimentCounterState.mergeChosenAllSpawnsNoMergeCount = 0;
  minimalPolicyExperimentCounterState.mergeChosenNoMergeShareSum = 0;
  minimalPolicyExperimentCounterState.mergeChosenWorstImmediateMergeLevelSum = 0;
  minimalPolicyExperimentCounterState.mergeChosenWorstNearTermMergeLevelSum = 0;
  minimalPolicyExperimentCounterState.mergeChosenChainSustainMergeCountSum = 0;
  minimalPolicyExperimentCounterState.mergeChosenMeanViableMoveCountSum = 0;
  minimalPolicyExperimentCounterState.mergeTotalSpawnChildrenEvaluated = 0;
  minimalPolicyExperimentCounterState.moveCacheHitCount = 0;
  minimalPolicyExperimentCounterState.moveCacheMissCount = 0;
  minimalPolicyExperimentCounterState.spawnCacheHitCount = 0;
  minimalPolicyExperimentCounterState.spawnCacheMissCount = 0;
  minimalPolicyExperimentCounterState.stateSignalCacheHitCount = 0;
  minimalPolicyExperimentCounterState.stateSignalCacheMissCount = 0;
  minimalPolicyExperimentCounterState.earlySearchDecisionCount = 0;
  minimalPolicyExperimentCounterState.earlySearchTotalTimeMs = 0;
  minimalPolicyExperimentCounterState.earlySearchTotalSearchTimeMs = 0;
  minimalPolicyExperimentCounterState.earlySearchTotalReachabilityTimeMs = 0;
  minimalPolicyExperimentCounterState.earlySearchSummaryCount = 0;
  minimalPolicyExperimentCounterState.earlySearchSpawnChildCount = 0;
  minimalPolicyExperimentCounterState.earlySearchRootEvaluationCount = 0;
  minimalPolicyExperimentCounterState.earlySearchExpandedNodeCount = 0;
  minimalPolicyExperimentCounterState.earlySearchGeneratedNodeCount = 0;
  minimalPolicyExperimentCounterState.earlySearchEnqueuedNodeCount = 0;
  minimalPolicyExperimentCounterState.earlySearchEnqueueDuplicateSkippedCount = 0;
  minimalPolicyExperimentCounterState.earlySearchEnqueueDominatedSkippedCount = 0;
  minimalPolicyExperimentCounterState.earlySearchPopDuplicateSkippedCount = 0;
  minimalPolicyExperimentCounterState.earlySearchFrontierPeakSizePeak = 0;
  minimalPolicyExperimentCounterState.earlySearchBestDepthReachedSum = 0;
  minimalPolicyExperimentCounterState.earlySearchBestDepthReachedPeak = 0;
  minimalPolicyExperimentCounterState.earlySearchCacheHitCount = 0;
  minimalPolicyExperimentCounterState.earlySearchCacheMissCount = 0;
  minimalPolicyExperimentCounterState.earlySearchDuplicatePrunedCount = 0;
  minimalPolicyExperimentCounterState.earlySearchNoLegalMovePrunedCount = 0;
  minimalPolicyExperimentCounterState.earlySearchNodeCapHitCount = 0;
  minimalPolicyExperimentCounterState.earlySearchMaxFrontierSizePeak = 0;
  minimalPolicyExperimentCounterState.criticalSearchDecisionCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchTotalTimeMs = 0;
  minimalPolicyExperimentCounterState.criticalSearchTotalSearchTimeMs = 0;
  minimalPolicyExperimentCounterState.criticalSearchTotalReachabilityTimeMs = 0;
  minimalPolicyExperimentCounterState.criticalSearchSummaryCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchSpawnChildCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchRootEvaluationCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchExpandedNodeCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchGeneratedNodeCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchEnqueuedNodeCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchEnqueueDuplicateSkippedCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchEnqueueDominatedSkippedCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchPopDuplicateSkippedCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchFrontierPeakSizePeak = 0;
  minimalPolicyExperimentCounterState.criticalSearchBestDepthReachedSum = 0;
  minimalPolicyExperimentCounterState.criticalSearchBestDepthReachedPeak = 0;
  minimalPolicyExperimentCounterState.criticalSearchCacheHitCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchCacheMissCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchDuplicatePrunedCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchNoLegalMovePrunedCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchNodeCapHitCount = 0;
  minimalPolicyExperimentCounterState.criticalSearchMaxFrontierSizePeak = 0;
  minimalPolicyExperimentCounterState.post7SearchDecisionCount = 0;
  minimalPolicyExperimentCounterState.post7SearchTotalTimeMs = 0;
  minimalPolicyExperimentCounterState.post7SearchTotalSearchTimeMs = 0;
  minimalPolicyExperimentCounterState.post7SearchTotalReachabilityTimeMs = 0;
  minimalPolicyExperimentCounterState.post7SearchSummaryCount = 0;
  minimalPolicyExperimentCounterState.post7SearchSpawnChildCount = 0;
  minimalPolicyExperimentCounterState.post7SearchRootEvaluationCount = 0;
  minimalPolicyExperimentCounterState.post7SearchExpandedNodeCount = 0;
  minimalPolicyExperimentCounterState.post7SearchGeneratedNodeCount = 0;
  minimalPolicyExperimentCounterState.post7SearchEnqueuedNodeCount = 0;
  minimalPolicyExperimentCounterState.post7SearchEnqueueDuplicateSkippedCount = 0;
  minimalPolicyExperimentCounterState.post7SearchEnqueueDominatedSkippedCount = 0;
  minimalPolicyExperimentCounterState.post7SearchPopDuplicateSkippedCount = 0;
  minimalPolicyExperimentCounterState.post7SearchFrontierPeakSizePeak = 0;
  minimalPolicyExperimentCounterState.post7SearchBestDepthReachedSum = 0;
  minimalPolicyExperimentCounterState.post7SearchBestDepthReachedPeak = 0;
  minimalPolicyExperimentCounterState.post7SearchChosenSearchScoreSum = 0;
  minimalPolicyExperimentCounterState.post7SearchChosenReachableRatioSum = 0;
  minimalPolicyExperimentCounterState.post7SearchChosenMeanWorstReachableImmediateMergeLevelSum = 0;
  minimalPolicyExperimentCounterState.post7SearchChosenMeanWorstReachableNearTermMergeLevelSum = 0;
  minimalPolicyExperimentCounterState.post7SearchChosenFinalNoMergeShareSum = 0;
  minimalPolicyExperimentCounterState.post7SearchCacheHitCount = 0;
  minimalPolicyExperimentCounterState.post7SearchCacheMissCount = 0;
  minimalPolicyExperimentCounterState.post7SearchDuplicatePrunedCount = 0;
  minimalPolicyExperimentCounterState.post7SearchNoLegalMovePrunedCount = 0;
  minimalPolicyExperimentCounterState.post7SearchNodeCapHitCount = 0;
  minimalPolicyExperimentCounterState.post7SearchMaxFrontierSizePeak = 0;
  minimalPolicyExperimentMoveCache.clear();
  minimalPolicyExperimentSpawnCache.clear();
  minimalPolicyExperimentViableCountCache.clear();
  minimalPolicyExperimentStateSignalCache.clear();
  minimalPolicyExperimentSearchTranspositionTable.clear();
  minimalPolicyExperimentPairReachabilityCache.clear();
  minimalPolicyExperimentSearchVisitClock = 0;
}

export function snapshotMinimalPolicyExperimentDebugCounters(): MinimalPolicyExperimentDebugCounters {
  const chosen = minimalPolicyExperimentCounterState.mergeChosenMoveCount;
  return {
    mergeWindowEntryCount: minimalPolicyExperimentCounterState.mergeWindowEntryCount,
    mergeMoveEvaluatedCount: minimalPolicyExperimentCounterState.mergeMoveEvaluatedCount,
    mergeChosenMoveCount: minimalPolicyExperimentCounterState.mergeChosenMoveCount,
    mergeChosenCapturedImmediate77Count:
      minimalPolicyExperimentCounterState.mergeChosenCapturedImmediate77Count,
    mergeChosenCapturedImmediate66Count:
      minimalPolicyExperimentCounterState.mergeChosenCapturedImmediate66Count,
    mergeChosenCapturedOnlyChainSustainCount:
      minimalPolicyExperimentCounterState.mergeChosenCapturedOnlyChainSustainCount,
    mergeChosenMissedImmediateHighMergeCount:
      minimalPolicyExperimentCounterState.mergeChosenMissedImmediateHighMergeCount,
    mergeChosenAllSpawnsNoMergeCount:
      minimalPolicyExperimentCounterState.mergeChosenAllSpawnsNoMergeCount,
    mergeChosenMeanNoMergeShare:
      chosen > 0
        ? minimalPolicyExperimentCounterState.mergeChosenNoMergeShareSum / chosen
        : 0,
    mergeChosenMeanWorstImmediateMergeLevel:
      chosen > 0
        ? minimalPolicyExperimentCounterState.mergeChosenWorstImmediateMergeLevelSum / chosen
        : 0,
    mergeChosenMeanWorstNearTermMergeLevel:
      chosen > 0
        ? minimalPolicyExperimentCounterState.mergeChosenWorstNearTermMergeLevelSum / chosen
        : 0,
    mergeChosenMeanChainSustainMergeCount:
      chosen > 0
        ? minimalPolicyExperimentCounterState.mergeChosenChainSustainMergeCountSum / chosen
        : 0,
    mergeChosenMeanViableMoveCount:
      chosen > 0
        ? minimalPolicyExperimentCounterState.mergeChosenMeanViableMoveCountSum / chosen
        : 0,
    mergeTotalSpawnChildrenEvaluated:
      minimalPolicyExperimentCounterState.mergeTotalSpawnChildrenEvaluated,
    moveCacheHitCount: minimalPolicyExperimentCounterState.moveCacheHitCount,
    moveCacheMissCount: minimalPolicyExperimentCounterState.moveCacheMissCount,
    spawnCacheHitCount: minimalPolicyExperimentCounterState.spawnCacheHitCount,
    spawnCacheMissCount: minimalPolicyExperimentCounterState.spawnCacheMissCount,
    stateSignalCacheHitCount: minimalPolicyExperimentCounterState.stateSignalCacheHitCount,
    stateSignalCacheMissCount: minimalPolicyExperimentCounterState.stateSignalCacheMissCount,
    earlySearchDecisionCount: minimalPolicyExperimentCounterState.earlySearchDecisionCount,
    earlySearchMeanMoveTimeMs:
      minimalPolicyExperimentCounterState.earlySearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.earlySearchTotalTimeMs /
          minimalPolicyExperimentCounterState.earlySearchDecisionCount
        : 0,
    earlySearchMeanSearchTimeMs:
      minimalPolicyExperimentCounterState.earlySearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.earlySearchTotalSearchTimeMs /
          minimalPolicyExperimentCounterState.earlySearchDecisionCount
        : 0,
    earlySearchMeanReachabilityTimeMs:
      minimalPolicyExperimentCounterState.earlySearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.earlySearchTotalReachabilityTimeMs /
          minimalPolicyExperimentCounterState.earlySearchDecisionCount
        : 0,
    earlySearchSummaryCount: minimalPolicyExperimentCounterState.earlySearchSummaryCount,
    earlySearchSpawnChildCount: minimalPolicyExperimentCounterState.earlySearchSpawnChildCount,
    earlySearchMeanSpawnChildCount:
      minimalPolicyExperimentCounterState.earlySearchSummaryCount > 0
        ? minimalPolicyExperimentCounterState.earlySearchSpawnChildCount /
          minimalPolicyExperimentCounterState.earlySearchSummaryCount
        : 0,
    earlySearchRootEvaluationCount:
      minimalPolicyExperimentCounterState.earlySearchRootEvaluationCount,
    earlySearchExpandedNodeCount: minimalPolicyExperimentCounterState.earlySearchExpandedNodeCount,
    earlySearchMeanPerRootExpandedNodes:
      minimalPolicyExperimentCounterState.earlySearchRootEvaluationCount > 0
        ? minimalPolicyExperimentCounterState.earlySearchExpandedNodeCount /
          minimalPolicyExperimentCounterState.earlySearchRootEvaluationCount
        : 0,
    earlySearchGeneratedNodeCount:
      minimalPolicyExperimentCounterState.earlySearchGeneratedNodeCount,
    earlySearchEnqueuedNodeCount:
      minimalPolicyExperimentCounterState.earlySearchEnqueuedNodeCount,
    earlySearchMeanPerRootEnqueuedNodes:
      minimalPolicyExperimentCounterState.earlySearchRootEvaluationCount > 0
        ? minimalPolicyExperimentCounterState.earlySearchEnqueuedNodeCount /
          minimalPolicyExperimentCounterState.earlySearchRootEvaluationCount
        : 0,
    earlySearchEnqueueDuplicateSkippedCount:
      minimalPolicyExperimentCounterState.earlySearchEnqueueDuplicateSkippedCount,
    earlySearchEnqueueDominatedSkippedCount:
      minimalPolicyExperimentCounterState.earlySearchEnqueueDominatedSkippedCount,
    earlySearchPopDuplicateSkippedCount:
      minimalPolicyExperimentCounterState.earlySearchPopDuplicateSkippedCount,
    earlySearchFrontierPeakSizePeak:
      minimalPolicyExperimentCounterState.earlySearchFrontierPeakSizePeak,
    earlySearchMeanBestDepthReached:
      minimalPolicyExperimentCounterState.earlySearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.earlySearchBestDepthReachedSum /
          minimalPolicyExperimentCounterState.earlySearchDecisionCount
        : 0,
    earlySearchBestDepthReachedPeak:
      minimalPolicyExperimentCounterState.earlySearchBestDepthReachedPeak,
    earlySearchCacheHitCount: minimalPolicyExperimentCounterState.earlySearchCacheHitCount,
    earlySearchCacheMissCount: minimalPolicyExperimentCounterState.earlySearchCacheMissCount,
    earlySearchDuplicatePrunedCount:
      minimalPolicyExperimentCounterState.earlySearchDuplicatePrunedCount,
    earlySearchNoLegalMovePrunedCount:
      minimalPolicyExperimentCounterState.earlySearchNoLegalMovePrunedCount,
    earlySearchNodeCapHitCount: minimalPolicyExperimentCounterState.earlySearchNodeCapHitCount,
    earlySearchMaxFrontierSizePeak:
      minimalPolicyExperimentCounterState.earlySearchMaxFrontierSizePeak,
    criticalSearchDecisionCount: minimalPolicyExperimentCounterState.criticalSearchDecisionCount,
    criticalSearchMeanMoveTimeMs:
      minimalPolicyExperimentCounterState.criticalSearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.criticalSearchTotalTimeMs /
          minimalPolicyExperimentCounterState.criticalSearchDecisionCount
        : 0,
    criticalSearchMeanSearchTimeMs:
      minimalPolicyExperimentCounterState.criticalSearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.criticalSearchTotalSearchTimeMs /
          minimalPolicyExperimentCounterState.criticalSearchDecisionCount
        : 0,
    criticalSearchMeanReachabilityTimeMs:
      minimalPolicyExperimentCounterState.criticalSearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.criticalSearchTotalReachabilityTimeMs /
          minimalPolicyExperimentCounterState.criticalSearchDecisionCount
        : 0,
    criticalSearchSummaryCount: minimalPolicyExperimentCounterState.criticalSearchSummaryCount,
    criticalSearchSpawnChildCount:
      minimalPolicyExperimentCounterState.criticalSearchSpawnChildCount,
    criticalSearchMeanSpawnChildCount:
      minimalPolicyExperimentCounterState.criticalSearchSummaryCount > 0
        ? minimalPolicyExperimentCounterState.criticalSearchSpawnChildCount /
          minimalPolicyExperimentCounterState.criticalSearchSummaryCount
        : 0,
    criticalSearchRootEvaluationCount:
      minimalPolicyExperimentCounterState.criticalSearchRootEvaluationCount,
    criticalSearchExpandedNodeCount:
      minimalPolicyExperimentCounterState.criticalSearchExpandedNodeCount,
    criticalSearchMeanPerRootExpandedNodes:
      minimalPolicyExperimentCounterState.criticalSearchRootEvaluationCount > 0
        ? minimalPolicyExperimentCounterState.criticalSearchExpandedNodeCount /
          minimalPolicyExperimentCounterState.criticalSearchRootEvaluationCount
        : 0,
    criticalSearchGeneratedNodeCount:
      minimalPolicyExperimentCounterState.criticalSearchGeneratedNodeCount,
    criticalSearchEnqueuedNodeCount:
      minimalPolicyExperimentCounterState.criticalSearchEnqueuedNodeCount,
    criticalSearchMeanPerRootEnqueuedNodes:
      minimalPolicyExperimentCounterState.criticalSearchRootEvaluationCount > 0
        ? minimalPolicyExperimentCounterState.criticalSearchEnqueuedNodeCount /
          minimalPolicyExperimentCounterState.criticalSearchRootEvaluationCount
        : 0,
    criticalSearchEnqueueDuplicateSkippedCount:
      minimalPolicyExperimentCounterState.criticalSearchEnqueueDuplicateSkippedCount,
    criticalSearchEnqueueDominatedSkippedCount:
      minimalPolicyExperimentCounterState.criticalSearchEnqueueDominatedSkippedCount,
    criticalSearchPopDuplicateSkippedCount:
      minimalPolicyExperimentCounterState.criticalSearchPopDuplicateSkippedCount,
    criticalSearchFrontierPeakSizePeak:
      minimalPolicyExperimentCounterState.criticalSearchFrontierPeakSizePeak,
    criticalSearchMeanBestDepthReached:
      minimalPolicyExperimentCounterState.criticalSearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.criticalSearchBestDepthReachedSum /
          minimalPolicyExperimentCounterState.criticalSearchDecisionCount
        : 0,
    criticalSearchBestDepthReachedPeak:
      minimalPolicyExperimentCounterState.criticalSearchBestDepthReachedPeak,
    criticalSearchCacheHitCount: minimalPolicyExperimentCounterState.criticalSearchCacheHitCount,
    criticalSearchCacheMissCount: minimalPolicyExperimentCounterState.criticalSearchCacheMissCount,
    criticalSearchDuplicatePrunedCount:
      minimalPolicyExperimentCounterState.criticalSearchDuplicatePrunedCount,
    criticalSearchNoLegalMovePrunedCount:
      minimalPolicyExperimentCounterState.criticalSearchNoLegalMovePrunedCount,
    criticalSearchNodeCapHitCount:
      minimalPolicyExperimentCounterState.criticalSearchNodeCapHitCount,
    criticalSearchMaxFrontierSizePeak:
      minimalPolicyExperimentCounterState.criticalSearchMaxFrontierSizePeak,
    post7SearchDecisionCount: minimalPolicyExperimentCounterState.post7SearchDecisionCount,
    post7SearchMeanMoveTimeMs:
      minimalPolicyExperimentCounterState.post7SearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.post7SearchTotalTimeMs /
          minimalPolicyExperimentCounterState.post7SearchDecisionCount
        : 0,
    post7SearchMeanSearchTimeMs:
      minimalPolicyExperimentCounterState.post7SearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.post7SearchTotalSearchTimeMs /
          minimalPolicyExperimentCounterState.post7SearchDecisionCount
        : 0,
    post7SearchMeanReachabilityTimeMs:
      minimalPolicyExperimentCounterState.post7SearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.post7SearchTotalReachabilityTimeMs /
          minimalPolicyExperimentCounterState.post7SearchDecisionCount
        : 0,
    post7SearchSummaryCount: minimalPolicyExperimentCounterState.post7SearchSummaryCount,
    post7SearchSpawnChildCount: minimalPolicyExperimentCounterState.post7SearchSpawnChildCount,
    post7SearchMeanSpawnChildCount:
      minimalPolicyExperimentCounterState.post7SearchSummaryCount > 0
        ? minimalPolicyExperimentCounterState.post7SearchSpawnChildCount /
          minimalPolicyExperimentCounterState.post7SearchSummaryCount
        : 0,
    post7SearchRootEvaluationCount:
      minimalPolicyExperimentCounterState.post7SearchRootEvaluationCount,
    post7SearchExpandedNodeCount: minimalPolicyExperimentCounterState.post7SearchExpandedNodeCount,
    post7SearchMeanPerRootExpandedNodes:
      minimalPolicyExperimentCounterState.post7SearchRootEvaluationCount > 0
        ? minimalPolicyExperimentCounterState.post7SearchExpandedNodeCount /
          minimalPolicyExperimentCounterState.post7SearchRootEvaluationCount
        : 0,
    post7SearchGeneratedNodeCount:
      minimalPolicyExperimentCounterState.post7SearchGeneratedNodeCount,
    post7SearchEnqueuedNodeCount:
      minimalPolicyExperimentCounterState.post7SearchEnqueuedNodeCount,
    post7SearchMeanPerRootEnqueuedNodes:
      minimalPolicyExperimentCounterState.post7SearchRootEvaluationCount > 0
        ? minimalPolicyExperimentCounterState.post7SearchEnqueuedNodeCount /
          minimalPolicyExperimentCounterState.post7SearchRootEvaluationCount
        : 0,
    post7SearchEnqueueDuplicateSkippedCount:
      minimalPolicyExperimentCounterState.post7SearchEnqueueDuplicateSkippedCount,
    post7SearchEnqueueDominatedSkippedCount:
      minimalPolicyExperimentCounterState.post7SearchEnqueueDominatedSkippedCount,
    post7SearchPopDuplicateSkippedCount:
      minimalPolicyExperimentCounterState.post7SearchPopDuplicateSkippedCount,
    post7SearchFrontierPeakSizePeak:
      minimalPolicyExperimentCounterState.post7SearchFrontierPeakSizePeak,
    post7SearchMeanBestDepthReached:
      minimalPolicyExperimentCounterState.post7SearchDecisionCount > 0
        ? minimalPolicyExperimentCounterState.post7SearchBestDepthReachedSum /
          minimalPolicyExperimentCounterState.post7SearchDecisionCount
        : 0,
    post7SearchBestDepthReachedPeak:
      minimalPolicyExperimentCounterState.post7SearchBestDepthReachedPeak,
    post7SearchChosenMeanSearchScore:
      chosen > 0
        ? minimalPolicyExperimentCounterState.post7SearchChosenSearchScoreSum / chosen
        : 0,
    post7SearchChosenMeanReachableRatio:
      chosen > 0
        ? minimalPolicyExperimentCounterState.post7SearchChosenReachableRatioSum / chosen
        : 0,
    post7SearchChosenMeanWorstReachableImmediateMergeLevel:
      chosen > 0
        ? minimalPolicyExperimentCounterState
            .post7SearchChosenMeanWorstReachableImmediateMergeLevelSum / chosen
        : 0,
    post7SearchChosenMeanWorstReachableNearTermMergeLevel:
      chosen > 0
        ? minimalPolicyExperimentCounterState
            .post7SearchChosenMeanWorstReachableNearTermMergeLevelSum / chosen
        : 0,
    post7SearchChosenMeanFinalNoMergeShare:
      chosen > 0
        ? minimalPolicyExperimentCounterState.post7SearchChosenFinalNoMergeShareSum / chosen
        : 0,
    post7SearchCacheHitCount: minimalPolicyExperimentCounterState.post7SearchCacheHitCount,
    post7SearchCacheMissCount: minimalPolicyExperimentCounterState.post7SearchCacheMissCount,
    post7SearchDuplicatePrunedCount:
      minimalPolicyExperimentCounterState.post7SearchDuplicatePrunedCount,
    post7SearchNoLegalMovePrunedCount:
      minimalPolicyExperimentCounterState.post7SearchNoLegalMovePrunedCount,
    post7SearchNodeCapHitCount: minimalPolicyExperimentCounterState.post7SearchNodeCapHitCount,
    post7SearchMaxFrontierSizePeak:
      minimalPolicyExperimentCounterState.post7SearchMaxFrontierSizePeak,
  };
}

function boardKey(board: Board): string {
  return board.join(",");
}

function encodeBoardBigInt(board: Board): bigint {
  let key = 0n;
  for (let i = 0; i < LEN; i++) {
    key = (key << 4n) | BigInt(board[i] ?? 0);
  }
  return key;
}

function transformIndex(index: number, symmetry: number): number {
  const r = Math.floor(index / 3);
  const c = index % 3;
  switch (symmetry) {
    case 0:
      return index;
    case 1:
      return c * 3 + (2 - r);
    case 2:
      return (2 - r) * 3 + (2 - c);
    case 3:
      return (2 - c) * 3 + r;
    case 4:
      return r * 3 + (2 - c);
    case 5:
      return (2 - c) * 3 + (2 - r);
    case 6:
      return (2 - r) * 3 + c;
    case 7:
      return c * 3 + r;
    default:
      return index;
  }
}

function canonicalStateKey(board: Board): bigint {
  let best = 0n;
  let initialized = false;
  for (let symmetry = 0; symmetry < 8; symmetry++) {
    const transformed = new Array<number>(LEN).fill(0);
    for (let i = 0; i < LEN; i++) {
      transformed[transformIndex(i, symmetry)] = board[i] ?? 0;
    }
    const encoded = encodeBoardBigInt(transformed);
    if (!initialized || encoded < best) {
      best = encoded;
      initialized = true;
    }
  }
  return best;
}

function sampleSpawnChildrenWorstFirst(
  afterSlide: Board,
  spawnChildren: readonly Board[],
  limit: number
): readonly Board[] {
  if (spawnChildren.length <= limit) return spawnChildren;
  const anchorIndex = detectCornerWithMax(afterSlide);
  if (anchorIndex == null) return spawnChildren.slice(0, limit);
  return [...spawnChildren]
    .sort((a, b) => compareSpawnRiskWorstFirst(a, b, anchorIndex))
    .slice(0, limit);
}

function sampleSpawnChildrenVariant(
  afterSlide: Board,
  spawnChildren: readonly Board[],
  limit: number,
  variant: number
): readonly Board[] {
  if (spawnChildren.length <= limit) return spawnChildren;
  const anchorIndex = detectCornerWithMax(afterSlide);
  const ordered =
    anchorIndex == null
      ? [...spawnChildren]
      : [...spawnChildren].sort((a, b) => compareSpawnRiskWorstFirst(a, b, anchorIndex));
  const offset = ((variant % ordered.length) + ordered.length) % ordered.length;
  const selected: Board[] = [];
  for (let i = 0; i < Math.min(limit, ordered.length); i++) {
    selected.push(ordered[(offset + i) % ordered.length]!);
  }
  return selected;
}

function cachedSlide(board: Board, action: Direction): CachedSlideResult {
  const key = `${action}|${boardKey(board)}`;
  const hit = minimalPolicyExperimentMoveCache.get(key);
  if (hit != null) {
    minimalPolicyExperimentCounterState.moveCacheHitCount++;
    return hit;
  }

  minimalPolicyExperimentCounterState.moveCacheMissCount++;
  const result = slide(board, action);
  minimalPolicyExperimentMoveCache.set(key, result);
  return result;
}

function spawnChildrenForMinimalPolicy(afterSlide: Board): readonly Board[] {
  const key = boardKey(afterSlide);
  const hit = minimalPolicyExperimentSpawnCache.get(key);
  if (hit != null) {
    minimalPolicyExperimentCounterState.spawnCacheHitCount++;
    return hit;
  }

  minimalPolicyExperimentCounterState.spawnCacheMissCount++;
  const spawned = spawnAll(afterSlide);
  const out = spawned.length > 0 ? spawned : [afterSlide];
  minimalPolicyExperimentSpawnCache.set(key, out);
  return out;
}

function representativeSpawnChild(afterSlide: Board, spawnChildren: readonly Board[]): Board {
  if (spawnChildren.length === 0) return afterSlide;
  const anchorIndex = detectCornerWithMax(afterSlide);
  if (anchorIndex == null) {
    const sorted = [...spawnChildren].sort((a, b) => scoreBoardMinimal(a) - scoreBoardMinimal(b));
    return sorted[0]!;
  }
  const sorted = [...spawnChildren].sort((a, b) => compareSpawnRiskWorstFirst(a, b, anchorIndex));
  return sorted[0]!;
}

function spawnChildrenForStageSearch(
  afterSlide: Board,
  stage: SearchStage
): readonly Board[] {
  const spawnChildren = spawnChildrenForMinimalPolicy(afterSlide);
  if (stage === "post7") return spawnChildren;
  if (stage === "critical") return sampleSpawnChildrenWorstFirst(afterSlide, spawnChildren, 4);
  return sampleSpawnChildrenWorstFirst(afterSlide, spawnChildren, 2);
}

function cachedViableCount(board: Board): number {
  const timerStartMs = performance.now();
  const anchorIndex = detectCornerWithMax(board);
  const key = `${anchorIndex ?? "none"}|${boardKey(board)}`;
  const hit = minimalPolicyExperimentViableCountCache.get(key);
  if (hit != null) {
    if (activeSearchRuntimeBreakdown != null) {
      activeSearchRuntimeBreakdown.viableCountTimeMs += performance.now() - timerStartMs;
    }
    return hit;
  }

  const out = countViableMoves(board, anchorIndex);
  minimalPolicyExperimentViableCountCache.set(key, out);
  if (activeSearchRuntimeBreakdown != null) {
    activeSearchRuntimeBreakdown.viableCountTimeMs += performance.now() - timerStartMs;
  }
  return out;
}

function minimalPolicyCached(board: Board, actions: Direction[]): Direction {
  let bestScore = Number.NEGATIVE_INFINITY;
  const tied: Direction[] = [];

  for (const d of actions) {
    const { next, win, moved } = cachedSlide(board, d);
    if (win) return d;
    if (!moved) continue;
    const s = scoreActionWithCurrentHeuristics(board, next);
    if (s > bestScore) {
      bestScore = s;
      tied.length = 0;
      tied.push(d);
    } else if (s === bestScore) {
      tied.push(d);
    }
  }

  for (const d of DIR_ORDER) {
    if (tied.includes(d)) return d;
  }

  return actions[0]!;
}

function highestImmediateMergeInfo(board: Board): HighestMergeInfo | null {
  for (let level = maxTileLevel(board); level >= 1; level--) {
    const count = immediateMergeCount(board, level);
    if (count > 0) return { level, count };
  }
  return null;
}

function highestNearTermMergeInfo(board: Board): HighestMergeInfo | null {
  let bestLevel = 0;
  let bestCount = 0;

  for (const action of legalActions(board)) {
    const transition = cachedSlide(board, action);
    if (!transition.moved) continue;
    const immediateInfo = highestImmediateMergeInfo(transition.next);
    const level = immediateInfo?.level ?? 0;
    if (level <= 0) continue;
    if (level > bestLevel) {
      bestLevel = level;
      bestCount = 1;
    } else if (level === bestLevel) {
      bestCount++;
    }
  }

  return bestLevel > 0 ? { level: bestLevel, count: bestCount } : null;
}

function evaluateMergeStateSignals(board: Board): MergeStateSignals {
  const timerStartMs = performance.now();
  const key = boardKey(board);
  const hit = minimalPolicyExperimentStateSignalCache.get(key);
  if (hit != null) {
    minimalPolicyExperimentCounterState.stateSignalCacheHitCount++;
    if (activeSearchRuntimeBreakdown != null) {
      activeSearchRuntimeBreakdown.evalSignalsTimeMs += performance.now() - timerStartMs;
    }
    return hit;
  }

  minimalPolicyExperimentCounterState.stateSignalCacheMissCount++;
  const immediateInfo = highestImmediateMergeInfo(board);
  const nearTermInfo = highestNearTermMergeInfo(board);
  const out: MergeStateSignals = {
    highestImmediateMergeLevel: immediateInfo?.level ?? 0,
    highestImmediateMergeCount: immediateInfo?.count ?? 0,
    highestNearTermMergeLevel: nearTermInfo?.level ?? 0,
    highestNearTermMergeCount: nearTermInfo?.count ?? 0,
    chainSustainMergeCount:
      immediateInfo?.count ?? nearTermInfo?.count ?? 0,
    hasAnyMergeNow: immediateInfo != null,
    hasAnyNearTermMerge: nearTermInfo != null,
    viableMoveCount: cachedViableCount(board),
    emptyCount: emptyCount(board),
  };
  minimalPolicyExperimentStateSignalCache.set(key, out);
  if (activeSearchRuntimeBreakdown != null) {
    activeSearchRuntimeBreakdown.evalSignalsTimeMs += performance.now() - timerStartMs;
  }
  return out;
}

function evaluateMoveMergeOpportunitySummary(
  board: Board,
  action: Direction,
  stage: SearchStage
): MoveMergeOpportunitySummary | null {
  const transition = cachedSlide(board, action);
  if (!transition.moved) return null;

  const spawnChildren = transition.win
    ? [transition.next]
    : spawnChildrenForStageSearch(transition.next, stage);
  if (spawnChildren.length === 0) return null;

  minimalPolicyExperimentCounterState.mergeMoveEvaluatedCount++;

  const beforeImmediateInfo = highestImmediateMergeInfo(board);
  const beforeImmediateLevel = beforeImmediateInfo?.level ?? 0;
  const capturedImmediate77 = countMergesAtLevelInSlide(board, action, 7) > 0;
  const capturedImmediate66 = countMergesAtLevelInSlide(board, action, 6) > 0;
  const capturedHighestCurrentMerge =
    beforeImmediateLevel > 0 &&
    countMergesAtLevelInSlide(board, action, beforeImmediateLevel) > 0;
  const afterSlideImmediateLevel = highestImmediateMergeInfo(transition.next)?.level ?? 0;
  const missedImmediateHighMerge =
    beforeImmediateLevel >= 6 &&
    !capturedHighestCurrentMerge &&
    afterSlideImmediateLevel < beforeImmediateLevel;
  const capturedOnlyChainSustainMerge =
    beforeImmediateLevel > 0 &&
    beforeImmediateLevel < 6 &&
    beforeImmediateInfo?.count === 1 &&
    capturedHighestCurrentMerge;

  let noMergeSpawnCount = 0;
  let worstHighestImmediateMergeLevel = Number.POSITIVE_INFINITY;
  let worstHighestNearTermMergeLevel = Number.POSITIVE_INFINITY;
  let chainSustainMergeCountSum = 0;
  let viableMoveCountSum = 0;
  let emptyCountSum = 0;

  for (const child of spawnChildren) {
    minimalPolicyExperimentCounterState.mergeTotalSpawnChildrenEvaluated++;
    const signals = evaluateMergeStateSignals(child);
    const reducedToNoMergeState =
      !signals.hasAnyMergeNow && !signals.hasAnyNearTermMerge && signals.chainSustainMergeCount <= 0;

    if (reducedToNoMergeState) noMergeSpawnCount++;
    if (signals.highestImmediateMergeLevel < worstHighestImmediateMergeLevel) {
      worstHighestImmediateMergeLevel = signals.highestImmediateMergeLevel;
    }
    if (signals.highestNearTermMergeLevel < worstHighestNearTermMergeLevel) {
      worstHighestNearTermMergeLevel = signals.highestNearTermMergeLevel;
    }
    chainSustainMergeCountSum += signals.chainSustainMergeCount;
    viableMoveCountSum += signals.viableMoveCount;
    emptyCountSum += signals.emptyCount;
  }

  const spawnCount = spawnChildren.length;
  return {
    direction: action,
    capturedImmediate77,
    capturedImmediate66,
    capturedOnlyChainSustainMerge,
    missedImmediateHighMerge,
    spawnCount,
    allSpawnsNoMerge: noMergeSpawnCount === spawnCount,
    noMergeShare: noMergeSpawnCount / spawnCount,
    worstHighestImmediateMergeLevel:
      Number.isFinite(worstHighestImmediateMergeLevel) ? worstHighestImmediateMergeLevel : 0,
    worstHighestNearTermMergeLevel:
      Number.isFinite(worstHighestNearTermMergeLevel) ? worstHighestNearTermMergeLevel : 0,
    meanChainSustainMergeCount: chainSustainMergeCountSum / spawnCount,
    meanViableMoveCount: viableMoveCountSum / spawnCount,
    meanEmptyCount: emptyCountSum / spawnCount,
    baseScore: scoreActionWithCurrentHeuristics(board, transition.next),
  };
}

function compareMoveMergeOpportunitySummaries(
  left: MoveMergeOpportunitySummary,
  right: MoveMergeOpportunitySummary
): number {
  if (left.capturedImmediate77 !== right.capturedImmediate77) {
    return left.capturedImmediate77 ? -1 : 1;
  }
  if (left.capturedImmediate66 !== right.capturedImmediate66) {
    return left.capturedImmediate66 ? -1 : 1;
  }
  if (left.missedImmediateHighMerge !== right.missedImmediateHighMerge) {
    return left.missedImmediateHighMerge ? 1 : -1;
  }
  if (left.capturedOnlyChainSustainMerge !== right.capturedOnlyChainSustainMerge) {
    return left.capturedOnlyChainSustainMerge ? -1 : 1;
  }
  if (left.allSpawnsNoMerge !== right.allSpawnsNoMerge) {
    return left.allSpawnsNoMerge ? 1 : -1;
  }
  if (left.noMergeShare !== right.noMergeShare) {
    return left.noMergeShare - right.noMergeShare;
  }
  if (left.worstHighestImmediateMergeLevel !== right.worstHighestImmediateMergeLevel) {
    return right.worstHighestImmediateMergeLevel - left.worstHighestImmediateMergeLevel;
  }
  if (left.worstHighestNearTermMergeLevel !== right.worstHighestNearTermMergeLevel) {
    return right.worstHighestNearTermMergeLevel - left.worstHighestNearTermMergeLevel;
  }
  if (left.meanChainSustainMergeCount !== right.meanChainSustainMergeCount) {
    return right.meanChainSustainMergeCount - left.meanChainSustainMergeCount;
  }
  if (left.meanViableMoveCount !== right.meanViableMoveCount) {
    return right.meanViableMoveCount - left.meanViableMoveCount;
  }
  if (left.meanEmptyCount !== right.meanEmptyCount) {
    return right.meanEmptyCount - left.meanEmptyCount;
  }
  if (left.baseScore !== right.baseScore) {
    return right.baseScore - left.baseScore;
  }

  return DIR_ORDER.indexOf(left.direction) - DIR_ORDER.indexOf(right.direction);
}

function hasNearTermHighMergeLadder(board: Board): boolean {
  const signals = evaluateMergeStateSignals(board);
  return signals.highestImmediateMergeLevel >= 5 || signals.highestNearTermMergeLevel >= 5;
}

function getSearchStage(board: Board): SearchStage {
  const mx = maxTileLevel(board);
  if (mx >= 7) return "post7";
  if (mx === 6 || hasNearTermHighMergeLadder(board)) return "critical";
  return "early";
}

function getStageSearchConfig(stage: SearchStage): BestFirstSearchConfig {
  if (ORACLE_SEARCH_ENABLED && stage === "post7") {
    return {
      horizon: ORACLE_POST7_SEARCH_HORIZON,
      reachabilityDepth: 14,
      reachabilityBeamWidth: 6,
      useAllSpawns: true,
      spawnSampleLimit: LEN,
      expandedNodeCap: ORACLE_POST7_EXPANDED_NODE_CAP,
      decisionExpandedNodeCap: ORACLE_POST7_EXPANDED_NODE_CAP,
      rootScreeningBudgetFraction: 0.25,
      rootRefineTopK: 2,
      maxFrontierSize: null,
      maxPerRootFrontierSize: null,
      maxPerSpawnLineFrontierSize: null,
    };
  }
  if (ORACLE_SEARCH_ENABLED && stage === "critical") {
    return {
      horizon: ORACLE_CRITICAL_SEARCH_HORIZON,
      reachabilityDepth: 12,
      reachabilityBeamWidth: 4,
      useAllSpawns: true,
      spawnSampleLimit: LEN,
      expandedNodeCap: ORACLE_CRITICAL_EXPANDED_NODE_CAP,
      decisionExpandedNodeCap: ORACLE_CRITICAL_EXPANDED_NODE_CAP,
      rootScreeningBudgetFraction: 0.25,
      rootRefineTopK: 2,
      maxFrontierSize: null,
      maxPerRootFrontierSize: null,
      maxPerSpawnLineFrontierSize: null,
    };
  }
  if (stage === "post7") {
    return {
      horizon: 20,
      reachabilityDepth: 12,
      reachabilityBeamWidth: 4,
      useAllSpawns: true,
      spawnSampleLimit: LEN,
      expandedNodeCap: null,
      decisionExpandedNodeCap: null,
      rootScreeningBudgetFraction: 1,
      rootRefineTopK: 0,
      maxFrontierSize: null,
      maxPerRootFrontierSize: null,
      maxPerSpawnLineFrontierSize: null,
    };
  }
  if (stage === "critical") {
    return {
      horizon: 12,
      reachabilityDepth: 10,
      reachabilityBeamWidth: 3,
      useAllSpawns: false,
      spawnSampleLimit: 4,
      expandedNodeCap: null,
      decisionExpandedNodeCap: null,
      rootScreeningBudgetFraction: 1,
      rootRefineTopK: 0,
      maxFrontierSize: null,
      maxPerRootFrontierSize: null,
      maxPerSpawnLineFrontierSize: null,
    };
  }
  return {
    horizon: 6,
    reachabilityDepth: 6,
    reachabilityBeamWidth: 2,
    useAllSpawns: false,
    spawnSampleLimit: 2,
    expandedNodeCap: null,
    decisionExpandedNodeCap: null,
    rootScreeningBudgetFraction: 1,
    rootRefineTopK: 0,
    maxFrontierSize: null,
    maxPerRootFrontierSize: null,
    maxPerSpawnLineFrontierSize: null,
  };
}

function getStageTimeBudgetMs(stage: SearchStage): number {
  if (stage === "post7") return POST7_SEARCH_TIME_BUDGET_MS;
  if (stage === "critical") return CRITICAL_SEARCH_TIME_BUDGET_MS;
  return EARLY_SEARCH_TIME_BUDGET_MS;
}

function getTargetLevelForReachability(board: Board): number {
  return Math.max(1, maxTileLevel(board) - 2);
}

function isNoMergeState(signals: MergeStateSignals): boolean {
  return !signals.hasAnyMergeNow && !signals.hasAnyNearTermMerge && signals.chainSustainMergeCount <= 0;
}

function compareSearchStateQuality(
  leftSignals: MergeStateSignals,
  leftScore: number,
  leftBoard: Board,
  rightSignals: MergeStateSignals,
  rightScore: number,
  rightBoard: Board
): number {
  if (leftSignals.highestImmediateMergeLevel !== rightSignals.highestImmediateMergeLevel) {
    return rightSignals.highestImmediateMergeLevel - leftSignals.highestImmediateMergeLevel;
  }
  if (leftSignals.highestImmediateMergeCount !== rightSignals.highestImmediateMergeCount) {
    return rightSignals.highestImmediateMergeCount - leftSignals.highestImmediateMergeCount;
  }
  if (leftSignals.highestNearTermMergeLevel !== rightSignals.highestNearTermMergeLevel) {
    return rightSignals.highestNearTermMergeLevel - leftSignals.highestNearTermMergeLevel;
  }
  if (leftSignals.highestNearTermMergeCount !== rightSignals.highestNearTermMergeCount) {
    return rightSignals.highestNearTermMergeCount - leftSignals.highestNearTermMergeCount;
  }
  if (leftSignals.chainSustainMergeCount !== rightSignals.chainSustainMergeCount) {
    return rightSignals.chainSustainMergeCount - leftSignals.chainSustainMergeCount;
  }
  if (leftSignals.viableMoveCount !== rightSignals.viableMoveCount) {
    return rightSignals.viableMoveCount - leftSignals.viableMoveCount;
  }
  if (leftSignals.emptyCount !== rightSignals.emptyCount) {
    return rightSignals.emptyCount - leftSignals.emptyCount;
  }
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  return boardKey(leftBoard).localeCompare(boardKey(rightBoard));
}

function compareSearchNodes(left: SearchNode, right: SearchNode): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.depth !== right.depth) return right.depth - left.depth;
  return compareSearchStateQuality(
    left.signals,
    left.score,
    left.board,
    right.signals,
    right.score,
    right.board
  );
}

class MaxPriorityQueue<T> {
  private readonly data: T[] = [];

  constructor(private readonly compare: (left: T, right: T) => number) {}

  get size(): number {
    return this.data.length;
  }

  push(value: T): void {
    this.data.push(value);
    this.siftUp(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0]!;
    const tail = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = tail;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.compare(this.data[parent]!, this.data[child]!) <= 0) break;
      [this.data[parent], this.data[child]] = [this.data[child]!, this.data[parent]!];
      child = parent;
    }
  }

  private siftDown(index: number): void {
    let parent = index;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let best = parent;
      if (left < this.data.length && this.compare(this.data[best]!, this.data[left]!) > 0) {
        best = left;
      }
      if (right < this.data.length && this.compare(this.data[best]!, this.data[right]!) > 0) {
        best = right;
      }
      if (best === parent) break;
      [this.data[parent], this.data[best]] = [this.data[best]!, this.data[parent]!];
      parent = best;
    }
  }
}

function getSearchExpansionSpawnChildren(
  afterSlide: Board,
  config: BestFirstSearchConfig
): readonly Board[] {
  const spawnChildren = spawnChildrenForMinimalPolicy(afterSlide);
  if (config.useAllSpawns) return spawnChildren;
  return sampleSpawnChildrenWorstFirst(afterSlide, spawnChildren, config.spawnSampleLimit);
}

function computeSearchStateScore(board: Board, signals: MergeStateSignals): number {
  const timerStartMs = activeSearchRuntimeBreakdown == null ? 0 : performance.now();
  const out =
    (
    scoreBoardMinimal(board) +
    signals.highestImmediateMergeLevel * 1_000_000 +
    signals.highestImmediateMergeCount * 100_000 +
    signals.highestNearTermMergeLevel * 20_000 +
    signals.highestNearTermMergeCount * 5_000 +
    signals.chainSustainMergeCount * 500 +
    signals.viableMoveCount * 100 +
    signals.emptyCount * 10
  );
  if (activeSearchRuntimeBreakdown != null) {
    activeSearchRuntimeBreakdown.scoreComputeTimeMs += performance.now() - timerStartMs;
  }
  return out;
}

function computeSearchNodePriority(
  score: number,
  signals: MergeStateSignals,
  depth: number
): number {
  let priority = score;
  if (isNoMergeState(signals)) priority -= 1_000_000;
  else if (!signals.hasAnyMergeNow && !signals.hasAnyNearTermMerge) priority -= 200_000;
  priority += depth * 25;
  return priority;
}

function touchSearchTranspositionEntry(key: bigint, entry: CacheEntry): void {
  if (minimalPolicyExperimentSearchTranspositionTable.has(key)) {
    minimalPolicyExperimentSearchTranspositionTable.delete(key);
  }
  entry.lastVisitTs = ++minimalPolicyExperimentSearchVisitClock;
  minimalPolicyExperimentSearchTranspositionTable.set(key, entry);

  while (minimalPolicyExperimentSearchTranspositionTable.size > SEARCH_TRANSPOSITION_TABLE_MAX_SIZE) {
    const oldestKey = minimalPolicyExperimentSearchTranspositionTable.keys().next().value as
      | bigint
      | undefined;
    if (oldestKey == null) break;
    minimalPolicyExperimentSearchTranspositionTable.delete(oldestKey);
    if (
      minimalPolicyExperimentSearchTranspositionTable.size <=
      SEARCH_TRANSPOSITION_TABLE_MAX_SIZE - SEARCH_TRANSPOSITION_TABLE_EVICT_COUNT
    ) {
      break;
    }
  }
}

function resetSearchTranspositionTable(): void {
  minimalPolicyExperimentSearchTranspositionTable.clear();
  minimalPolicyExperimentSearchVisitClock = 0;
}

function createSearchRuntimeBreakdown(): SearchRuntimeBreakdown {
  return {
    canonicalTimeMs: 0,
    heapTimeMs: 0,
    expandTimeMs: 0,
    evalSignalsTimeMs: 0,
    viableCountTimeMs: 0,
    scoreComputeTimeMs: 0,
    transpositionCheckTimeMs: 0,
    frontierDedupeTimeMs: 0,
  };
}

function mergeDepthHistograms(left: DepthHistogram, right: DepthHistogram): DepthHistogram {
  const merged: DepthHistogram = { ...left };
  for (const [depth, count] of Object.entries(right)) {
    const depthKey = Number(depth);
    merged[depthKey] = (merged[depthKey] ?? 0) + count;
  }
  return merged;
}

function incrementDepthHistogram(histogram: DepthHistogram, depth: number): void {
  histogram[depth] = (histogram[depth] ?? 0) + 1;
}

function mergeRuntimeBreakdowns(
  left: SearchRuntimeBreakdown,
  right: SearchRuntimeBreakdown
): SearchRuntimeBreakdown {
  return {
    canonicalTimeMs: left.canonicalTimeMs + right.canonicalTimeMs,
    heapTimeMs: left.heapTimeMs + right.heapTimeMs,
    expandTimeMs: left.expandTimeMs + right.expandTimeMs,
    evalSignalsTimeMs: left.evalSignalsTimeMs + right.evalSignalsTimeMs,
    viableCountTimeMs: left.viableCountTimeMs + right.viableCountTimeMs,
    scoreComputeTimeMs: left.scoreComputeTimeMs + right.scoreComputeTimeMs,
    transpositionCheckTimeMs: left.transpositionCheckTimeMs + right.transpositionCheckTimeMs,
    frontierDedupeTimeMs: left.frontierDedupeTimeMs + right.frontierDedupeTimeMs,
  };
}

function toFrontierEntry(node: SearchNode): FrontierEntry {
  return {
    priority: node.priority,
    score: node.score,
    depth: node.depth,
  };
}

function frontierEntryMatchesNode(entry: FrontierEntry | undefined, node: SearchNode): boolean {
  return (
    entry != null &&
    entry.priority === node.priority &&
    Math.abs(entry.score - node.score) <= SEARCH_SCORE_EPSILON &&
    entry.depth === node.depth
  );
}

function dominatesSearchCandidate(
  existingScore: number,
  existingDepth: number,
  nextScore: number,
  nextDepth: number
): boolean {
  return existingScore >= nextScore - SEARCH_SCORE_EPSILON && existingDepth <= nextDepth;
}

function shouldReplaceFrontierEntry(existing: FrontierEntry, next: SearchNode): boolean {
  return next.score > existing.score + SEARCH_SCORE_EPSILON || next.depth < existing.depth;
}

function effectiveLineFrontierCap(config: BestFirstSearchConfig): number | null {
  const caps = [
    config.maxFrontierSize,
    config.maxPerRootFrontierSize,
    config.maxPerSpawnLineFrontierSize,
  ].filter((value): value is number => value != null && value > 0);
  if (caps.length === 0) return null;
  return Math.min(...caps);
}

function shouldPruneSearchNode(entry: CacheEntry, node: SearchNode): boolean {
  return dominatesSearchCandidate(entry.bestScoreSeen, entry.depthSeen, node.score, node.depth);
}

function updateSearchTranspositionEntry(key: bigint, node: SearchNode): void {
  const previous = minimalPolicyExperimentSearchTranspositionTable.get(key);
  const next: CacheEntry = {
    bestScoreSeen: previous == null ? node.score : Math.max(previous.bestScoreSeen, node.score),
    depthSeen: previous == null ? node.depth : Math.min(previous.depthSeen, node.depth),
    lastVisitTs: previous?.lastVisitTs ?? 0,
  };
  touchSearchTranspositionEntry(key, next);
}

function buildReachabilityCacheKey(
  board: Board,
  level: number,
  opts: ReachabilityOptions,
  variant: number
): string {
  return `${canonicalStateKey(board).toString()}|${level}|${opts.depth}|${opts.beamWidth}|${opts.useAllSpawns ? 1 : 0}|${opts.spawnSampleLimit}|${variant}`;
}

function isPairReachable(board: Board, level: number, opts: ReachabilityOptions, variant = 0): boolean {
  if (level <= 0) return true;
  if (countTilesEqual(board, level) >= 2) return true;

  const cacheKey = buildReachabilityCacheKey(board, level, opts, variant);
  const cacheHit = minimalPolicyExperimentPairReachabilityCache.get(cacheKey);
  if (cacheHit != null) return cacheHit;

  const rootSignals = evaluateMergeStateSignals(board);
  const rootScore = computeSearchStateScore(board, rootSignals);
  let frontier: SearchNode[] = [
    {
      board,
      stateKey: canonicalStateKey(board),
      depth: 0,
      score: rootScore,
      priority: computeSearchNodePriority(rootScore, rootSignals, 0),
      signals: rootSignals,
    },
  ];
  const visited = new Set<bigint>([canonicalStateKey(board)]);

  for (let depth = 0; depth < opts.depth && frontier.length > 0; depth++) {
    const nextByKey = new Map<bigint, SearchNode>();

    for (const state of frontier) {
      for (const action of legalActions(state.board)) {
        const transition = cachedSlide(state.board, action);
        if (!transition.moved) continue;
        const spawnChildren = transition.win
          ? [transition.next]
          : opts.useAllSpawns
            ? spawnChildrenForMinimalPolicy(transition.next)
            : sampleSpawnChildrenVariant(
                transition.next,
                spawnChildrenForMinimalPolicy(transition.next),
                opts.spawnSampleLimit,
                variant + depth + DIR_ORDER.indexOf(action)
              );

        for (const child of spawnChildren) {
          if (countTilesEqual(child, level) >= 2) {
            minimalPolicyExperimentPairReachabilityCache.set(cacheKey, true);
            return true;
          }
          const childKey = canonicalStateKey(child);
          if (visited.has(childKey)) continue;
          visited.add(childKey);
          const childSignals = evaluateMergeStateSignals(child);
          const childScore = computeSearchStateScore(child, childSignals);
          const childNode: SearchNode = {
            board: child,
            stateKey: childKey,
            depth: depth + 1,
            score: childScore,
            priority: computeSearchNodePriority(childScore, childSignals, depth + 1),
            signals: childSignals,
          };
          const previous = nextByKey.get(childKey);
          if (
            previous == null ||
            compareSearchStateQuality(
              childSignals,
              childScore,
              child,
              previous.signals,
              previous.score,
              previous.board
            ) < 0
          ) {
            nextByKey.set(childKey, childNode);
          }
        }
      }
    }

    if (nextByKey.size === 0) break;
    frontier = [...nextByKey.values()]
      .sort((left, right) =>
        compareSearchStateQuality(
          left.signals,
          left.score,
          left.board,
          right.signals,
          right.score,
          right.board
        )
      )
      .slice(0, opts.beamWidth);
  }

  minimalPolicyExperimentPairReachabilityCache.set(cacheKey, false);
  return false;
}

function evaluateRootReachabilitySummary(
  spawnChildren: readonly Board[],
  targetLevel: number,
  stage: SearchStage,
  opts: ReachabilityOptions
): RootReachabilitySummary {
  if (stage === "early") {
    return {
      targetLevel,
      reachableRatio: null,
      worstReachableImmediateMergeLevel: 0,
      worstReachableNearTermMergeLevel: 0,
      reachabilityTimeMs: 0,
    };
  }

  const startMs = performance.now();
  let reachableCount = 0;
  let worstReachableImmediateMergeLevel = Number.POSITIVE_INFINITY;
  let worstReachableNearTermMergeLevel = Number.POSITIVE_INFINITY;

  for (const child of spawnChildren) {
    if (!isPairReachable(child, targetLevel, opts)) continue;
    reachableCount++;
    const signals = evaluateMergeStateSignals(child);
    if (signals.highestImmediateMergeLevel < worstReachableImmediateMergeLevel) {
      worstReachableImmediateMergeLevel = signals.highestImmediateMergeLevel;
    }
    if (signals.highestNearTermMergeLevel < worstReachableNearTermMergeLevel) {
      worstReachableNearTermMergeLevel = signals.highestNearTermMergeLevel;
    }
  }

  return {
    targetLevel,
    reachableRatio: reachableCount / Math.max(1, spawnChildren.length),
    worstReachableImmediateMergeLevel: Number.isFinite(worstReachableImmediateMergeLevel)
      ? worstReachableImmediateMergeLevel
      : 0,
    worstReachableNearTermMergeLevel: Number.isFinite(worstReachableNearTermMergeLevel)
      ? worstReachableNearTermMergeLevel
      : 0,
    reachabilityTimeMs: performance.now() - startMs,
  };
}

function evaluateBestFirstSearch(
  board: Board,
  config: BestFirstSearchConfig,
  budgetMs: number
): SearchLineSummary {
  const startMs = performance.now();
  const runtimeBreakdown = createSearchRuntimeBreakdown();
  const previousActiveRuntimeBreakdown = activeSearchRuntimeBreakdown;
  activeSearchRuntimeBreakdown = runtimeBreakdown;

  try {
    const rootSignals = evaluateMergeStateSignals(board);
    const rootScore = computeSearchStateScore(board, rootSignals);
    const rootCanonicalStartMs = performance.now();
    const rootStateKey = canonicalStateKey(board);
    runtimeBreakdown.canonicalTimeMs += performance.now() - rootCanonicalStartMs;

    let bestScore = rootScore;
    let bestDepthReached = 0;
    let maxDepthReached = 0;
    let bestImmediateMergeLevelSeen = rootSignals.highestImmediateMergeLevel;
    let bestNearTermMergeLevelSeen = rootSignals.highestNearTermMergeLevel;
    let bestChainSustainMergeCountSeen = rootSignals.chainSustainMergeCount;
    let bestSignals = rootSignals;
    let expandedNodes = 0;
    let cacheHitCount = 0;
    let cacheMissCount = 0;
    let duplicatePrunedCount = 0;
    let noLegalMovePrunedCount = 0;
    let nodeCapHit = false;
    let generatedNodes = 1;
    let enqueuedNodes = 1;
    let enqueueDuplicateSkipped = 0;
    let enqueueDominatedSkipped = 0;
    let popDuplicateSkipped = 0;
    const expandedByDepth: DepthHistogram = {};
    const enqueuedByDepth: DepthHistogram = {};
    incrementDepthHistogram(enqueuedByDepth, 0);

    const rootNode: SearchNode = {
      board,
      stateKey: rootStateKey,
      depth: 0,
      score: rootScore,
      priority: computeSearchNodePriority(rootScore, rootSignals, 0),
      signals: rootSignals,
    };
    const frontier = new MaxPriorityQueue<SearchNode>(compareSearchNodes);
    const frontierBest = new Map<StateKey, FrontierEntry>();
    const rootPushStartMs = performance.now();
    frontier.push(rootNode);
    runtimeBreakdown.heapTimeMs += performance.now() - rootPushStartMs;
    frontierBest.set(rootStateKey, toFrontierEntry(rootNode));
    let maxFrontierSize = frontier.size;
    let frontierPeakSize = frontierBest.size;
    const deadline = config.expandedNodeCap == null ? startMs + Math.max(1, budgetMs) : null;
    const lineFrontierCap = effectiveLineFrontierCap(config);

    while (frontier.size > 0) {
      if (deadline != null && performance.now() >= deadline) break;
      if (config.expandedNodeCap != null && expandedNodes >= config.expandedNodeCap) {
        nodeCapHit = true;
        break;
      }
      const popStartMs = performance.now();
      const node = frontier.pop();
      runtimeBreakdown.heapTimeMs += performance.now() - popStartMs;
      if (node == null) break;

      const frontierMatchStartMs = performance.now();
      if (!frontierEntryMatchesNode(frontierBest.get(node.stateKey), node)) {
        runtimeBreakdown.frontierDedupeTimeMs += performance.now() - frontierMatchStartMs;
        popDuplicateSkipped++;
        continue;
      }
      frontierBest.delete(node.stateKey);
      runtimeBreakdown.frontierDedupeTimeMs += performance.now() - frontierMatchStartMs;

      const transpositionStartMs = performance.now();
      const cacheEntry = minimalPolicyExperimentSearchTranspositionTable.get(node.stateKey);
      if (cacheEntry != null) {
        cacheHitCount++;
        if (shouldPruneSearchNode(cacheEntry, node)) {
          runtimeBreakdown.transpositionCheckTimeMs += performance.now() - transpositionStartMs;
          duplicatePrunedCount++;
          continue;
        }
      } else {
        cacheMissCount++;
      }
      updateSearchTranspositionEntry(node.stateKey, node);
      runtimeBreakdown.transpositionCheckTimeMs += performance.now() - transpositionStartMs;

      expandedNodes++;
      incrementDepthHistogram(expandedByDepth, node.depth);

      if (node.score > bestScore + SEARCH_SCORE_EPSILON) {
        bestScore = node.score;
        bestDepthReached = node.depth;
        bestSignals = node.signals;
      } else if (Math.abs(node.score - bestScore) <= SEARCH_SCORE_EPSILON && node.depth > bestDepthReached) {
        bestDepthReached = node.depth;
      }
      if (node.depth > maxDepthReached) maxDepthReached = node.depth;
      if (node.signals.highestImmediateMergeLevel > bestImmediateMergeLevelSeen) {
        bestImmediateMergeLevelSeen = node.signals.highestImmediateMergeLevel;
      }
      if (node.signals.highestNearTermMergeLevel > bestNearTermMergeLevelSeen) {
        bestNearTermMergeLevelSeen = node.signals.highestNearTermMergeLevel;
      }
      if (node.signals.chainSustainMergeCount > bestChainSustainMergeCountSeen) {
        bestChainSustainMergeCountSeen = node.signals.chainSustainMergeCount;
      }

      if (node.depth >= config.horizon) continue;
      const legalActionsStartMs = performance.now();
      const actions = legalActions(node.board);
      runtimeBreakdown.expandTimeMs += performance.now() - legalActionsStartMs;
      if (actions.length === 0) {
        noLegalMovePrunedCount++;
        continue;
      }

      for (const action of actions) {
        const expandActionStartMs = performance.now();
        const transition = cachedSlide(node.board, action);
        if (!transition.moved) {
          runtimeBreakdown.expandTimeMs += performance.now() - expandActionStartMs;
          continue;
        }
        const spawnChildren = transition.win
          ? [transition.next]
          : getSearchExpansionSpawnChildren(transition.next, config);
        runtimeBreakdown.expandTimeMs += performance.now() - expandActionStartMs;

        for (const child of spawnChildren) {
          generatedNodes++;
          const childDepth = node.depth + 1;
          const canonicalStartMs = performance.now();
          const childStateKey = canonicalStateKey(child);
          runtimeBreakdown.canonicalTimeMs += performance.now() - canonicalStartMs;

          const childNode: SearchNode = {
            board: child,
            stateKey: childStateKey,
            depth: childDepth,
            score: 0,
            priority: 0,
            signals: rootSignals,
          };

          const dedupeStartMs = performance.now();
          const existingFrontier = frontierBest.get(childStateKey);
          if (existingFrontier != null && existingFrontier.depth <= childDepth) {
            runtimeBreakdown.frontierDedupeTimeMs += performance.now() - dedupeStartMs;
            enqueueDuplicateSkipped++;
            continue;
          }
          runtimeBreakdown.frontierDedupeTimeMs += performance.now() - dedupeStartMs;

          const childTranspositionStartMs = performance.now();
          const closedEntry = minimalPolicyExperimentSearchTranspositionTable.get(childStateKey);
          if (closedEntry != null && closedEntry.depthSeen <= childDepth) {
            runtimeBreakdown.transpositionCheckTimeMs += performance.now() - childTranspositionStartMs;
            enqueueDominatedSkipped++;
            continue;
          }
          runtimeBreakdown.transpositionCheckTimeMs += performance.now() - childTranspositionStartMs;

          if (lineFrontierCap != null && frontierBest.size >= lineFrontierCap && existingFrontier == null) {
            enqueueDominatedSkipped++;
            continue;
          }

          const childSignals = evaluateMergeStateSignals(child);
          const childScore = computeSearchStateScore(child, childSignals);
          const childPriority = computeSearchNodePriority(childScore, childSignals, childDepth);
          childNode.score = childScore;
          childNode.priority = childPriority;
          childNode.signals = childSignals;

          const replaceCheckStartMs = performance.now();
          if (existingFrontier != null && !shouldReplaceFrontierEntry(existingFrontier, childNode)) {
            runtimeBreakdown.frontierDedupeTimeMs += performance.now() - replaceCheckStartMs;
            enqueueDuplicateSkipped++;
            continue;
          }
          frontierBest.set(childStateKey, toFrontierEntry(childNode));
          runtimeBreakdown.frontierDedupeTimeMs += performance.now() - replaceCheckStartMs;

          const pushStartMs = performance.now();
          frontier.push(childNode);
          runtimeBreakdown.heapTimeMs += performance.now() - pushStartMs;
          enqueuedNodes++;
          incrementDepthHistogram(enqueuedByDepth, childDepth);
          if (frontier.size > maxFrontierSize) maxFrontierSize = frontier.size;
          if (frontierBest.size > frontierPeakSize) frontierPeakSize = frontierBest.size;
        }
      }
    }

    return {
      bestScore,
      bestDepthReached,
      maxDepthReached,
      expandedNodes,
      cacheHitCount,
      cacheMissCount,
      duplicatePrunedCount,
      noLegalMovePrunedCount,
      nodeCapHit,
      maxFrontierSize,
      generatedNodes,
      enqueuedNodes,
      enqueueDuplicateSkipped,
      enqueueDominatedSkipped,
      popDuplicateSkipped,
      frontierPeakSize,
      expandedByDepth,
      enqueuedByDepth,
      runtimeBreakdown,
      searchTimeMs: performance.now() - startMs,
      bestImmediateMergeLevelSeen,
      bestNearTermMergeLevelSeen,
      bestChainSustainMergeCountSeen,
      finalHighestImmediateMergeLevel: bestSignals.highestImmediateMergeLevel,
      finalHighestNearTermMergeLevel: bestSignals.highestNearTermMergeLevel,
      finalChainSustainMergeCount: bestSignals.chainSustainMergeCount,
      finalViableMoveCount: bestSignals.viableMoveCount,
      finalEmptyCount: bestSignals.emptyCount,
      finalNoMerge: isNoMergeState(bestSignals),
    };
  } finally {
    activeSearchRuntimeBreakdown = previousActiveRuntimeBreakdown;
  }
}

function filterPost7SearchCandidates(
  summaries: readonly MoveMergeOpportunitySummary[]
): MoveMergeOpportunitySummary[] {
  const capture77 = summaries.filter((summary) => summary.capturedImmediate77);
  if (capture77.length > 0) return capture77;

  const capture66 = summaries.filter((summary) => summary.capturedImmediate66);
  if (capture66.length > 0) return capture66;

  const safeHighMerge = summaries.filter((summary) => !summary.missedImmediateHighMerge);
  if (safeHighMerge.length > 0 && safeHighMerge.length < summaries.length) return safeHighMerge;

  return [...summaries];
}

function evaluatePost7MoveSearchSummary(
  board: Board,
  transition: MoveMergeOpportunitySummary,
  config: BestFirstSearchConfig,
  stage: SearchStage,
  budgetMs: number,
  includeReachability = true
): MoveSearchSummary {
  const transitionResult = cachedSlide(board, transition.direction);
  const searchSpawnChildren = transitionResult.win
    ? [transitionResult.next]
    : spawnChildrenForStageSearch(transitionResult.next, stage);
  const reachabilitySpawnChildren = transitionResult.win
    ? [transitionResult.next]
    : spawnChildrenForMinimalPolicy(transitionResult.next);
  const targetLevel = getTargetLevelForReachability(transitionResult.next);
  const reachabilityOpts: ReachabilityOptions = {
    depth: config.reachabilityDepth,
    beamWidth: config.reachabilityBeamWidth,
    useAllSpawns: config.useAllSpawns,
    spawnSampleLimit: config.spawnSampleLimit,
  };

  let finalNoMergeCount = 0;
  let bestImmediateMergeLevelSeenSum = 0;
  let bestNearTermMergeLevelSeenSum = 0;
  let bestChainSustainMergeCountSeenSum = 0;
  let finalViableMoveCountSum = 0;
  let finalEmptyCountSum = 0;
  let bestScoreSum = 0;
  let expandedNodes = 0;
  let cacheHitCount = 0;
  let cacheMissCount = 0;
  let duplicatePrunedCount = 0;
  let noLegalMovePrunedCount = 0;
  let nodeCapHitCount = 0;
  let maxFrontierSize = 0;
  let generatedNodes = 0;
  let enqueuedNodes = 0;
  let enqueueDuplicateSkipped = 0;
  let enqueueDominatedSkipped = 0;
  let popDuplicateSkipped = 0;
  let frontierPeakSize = 0;
  let bestDepthReached = 0;
  let maxDepthReached = 0;
  let topCandidateScore = Number.NEGATIVE_INFINITY;
  let topCandidateDepth = 0;
  let expandedByDepth: DepthHistogram = {};
  let enqueuedByDepth: DepthHistogram = {};
  let runtimeBreakdown = createSearchRuntimeBreakdown();
  let searchTimeMs = 0;
  const perChildBudgetMs = Math.max(1, budgetMs / Math.max(1, searchSpawnChildren.length));
  let remainingExpandedNodeCap = config.expandedNodeCap;

  for (let i = 0; i < searchSpawnChildren.length; i++) {
    const child = searchSpawnChildren[i]!;
    const childrenLeft = searchSpawnChildren.length - i;
    const lineConfig =
      remainingExpandedNodeCap == null
        ? config
        : {
            ...config,
            expandedNodeCap: Math.max(
              1,
              Math.floor(remainingExpandedNodeCap / Math.max(1, childrenLeft))
            ),
          };
    const lineSummary = evaluateBestFirstSearch(child, lineConfig, perChildBudgetMs);
    if (lineSummary.finalNoMerge) finalNoMergeCount++;
    bestImmediateMergeLevelSeenSum += lineSummary.bestImmediateMergeLevelSeen;
    bestNearTermMergeLevelSeenSum += lineSummary.bestNearTermMergeLevelSeen;
    bestChainSustainMergeCountSeenSum += lineSummary.bestChainSustainMergeCountSeen;
    finalViableMoveCountSum += lineSummary.finalViableMoveCount;
    finalEmptyCountSum += lineSummary.finalEmptyCount;
    bestScoreSum += lineSummary.bestScore;
    expandedNodes += lineSummary.expandedNodes;
    cacheHitCount += lineSummary.cacheHitCount;
    cacheMissCount += lineSummary.cacheMissCount;
    duplicatePrunedCount += lineSummary.duplicatePrunedCount;
    noLegalMovePrunedCount += lineSummary.noLegalMovePrunedCount;
    if (lineSummary.nodeCapHit) nodeCapHitCount++;
    if (lineSummary.maxFrontierSize > maxFrontierSize) {
      maxFrontierSize = lineSummary.maxFrontierSize;
    }
    generatedNodes += lineSummary.generatedNodes;
    enqueuedNodes += lineSummary.enqueuedNodes;
    enqueueDuplicateSkipped += lineSummary.enqueueDuplicateSkipped;
    enqueueDominatedSkipped += lineSummary.enqueueDominatedSkipped;
    popDuplicateSkipped += lineSummary.popDuplicateSkipped;
    if (lineSummary.frontierPeakSize > frontierPeakSize) {
      frontierPeakSize = lineSummary.frontierPeakSize;
    }
    expandedByDepth = mergeDepthHistograms(expandedByDepth, lineSummary.expandedByDepth);
    enqueuedByDepth = mergeDepthHistograms(enqueuedByDepth, lineSummary.enqueuedByDepth);
    runtimeBreakdown = mergeRuntimeBreakdowns(runtimeBreakdown, lineSummary.runtimeBreakdown);
    searchTimeMs += lineSummary.searchTimeMs;
    if (remainingExpandedNodeCap != null) {
      remainingExpandedNodeCap = Math.max(0, remainingExpandedNodeCap - lineSummary.expandedNodes);
    }
    if (
      lineSummary.bestScore > topCandidateScore + SEARCH_SCORE_EPSILON ||
      (Math.abs(lineSummary.bestScore - topCandidateScore) <= SEARCH_SCORE_EPSILON &&
        lineSummary.bestDepthReached > topCandidateDepth)
    ) {
      topCandidateScore = lineSummary.bestScore;
      topCandidateDepth = lineSummary.bestDepthReached;
    }
    if (lineSummary.bestDepthReached > bestDepthReached) {
      bestDepthReached = lineSummary.bestDepthReached;
    }
    if (lineSummary.maxDepthReached > maxDepthReached) {
      maxDepthReached = lineSummary.maxDepthReached;
    }
  }

  const reachabilitySummary = includeReachability
    ? evaluateRootReachabilitySummary(reachabilitySpawnChildren, targetLevel, stage, reachabilityOpts)
    : {
        targetLevel,
        reachableRatio: null,
        worstReachableImmediateMergeLevel: 0,
        worstReachableNearTermMergeLevel: 0,
        reachabilityTimeMs: 0,
      };
  const spawnCount = Math.max(1, searchSpawnChildren.length);
  const cacheTotal = cacheHitCount + cacheMissCount;
  return {
    transition,
    config,
    targetLevel,
    searchScore: bestScoreSum / spawnCount,
    reachableRatio: reachabilitySummary.reachableRatio,
    worstReachableImmediateMergeLevel: reachabilitySummary.worstReachableImmediateMergeLevel,
    worstReachableNearTermMergeLevel: reachabilitySummary.worstReachableNearTermMergeLevel,
    finalNoMergeShare: finalNoMergeCount / spawnCount,
    meanBestImmediateMergeLevelSeen: bestImmediateMergeLevelSeenSum / spawnCount,
    meanBestNearTermMergeLevelSeen: bestNearTermMergeLevelSeenSum / spawnCount,
    meanBestChainSustainMergeCountSeen: bestChainSustainMergeCountSeenSum / spawnCount,
    meanFinalViableMoveCount: finalViableMoveCountSum / spawnCount,
    meanFinalEmptyCount: finalEmptyCountSum / spawnCount,
    bestDepthReached,
    maxDepthReached,
    expandedNodes,
    cacheHitCount,
    cacheMissCount,
    cacheHitRate: cacheTotal > 0 ? cacheHitCount / cacheTotal : 0,
    searchSpawnChildCount: searchSpawnChildren.length,
    searchSummaryCount: searchSpawnChildren.length,
    duplicatePrunedCount,
    noLegalMovePrunedCount,
    nodeCapHitCount,
    maxFrontierSize,
    generatedNodes,
    enqueuedNodes,
    enqueueDuplicateSkipped,
    enqueueDominatedSkipped,
    popDuplicateSkipped,
    frontierPeakSize,
    expandedByDepth,
    enqueuedByDepth,
    runtimeBreakdown,
    topCandidateDepth,
    topCandidateScore,
    searchTimeMs,
    reachabilityTimeMs: reachabilitySummary.reachabilityTimeMs,
  };
}

function hasKnownReachability(summary: MoveSearchSummary): boolean {
  return summary.reachableRatio != null;
}

function compareSearchEvidenceMoveSearchSummaries(
  left: MoveSearchSummary,
  right: MoveSearchSummary
): number {
  if (left.maxDepthReached !== right.maxDepthReached) {
    return right.maxDepthReached - left.maxDepthReached;
  }
  if (left.topCandidateDepth !== right.topCandidateDepth) {
    return right.topCandidateDepth - left.topCandidateDepth;
  }
  if (left.searchScore !== right.searchScore) {
    return right.searchScore - left.searchScore;
  }
  if (left.topCandidateScore !== right.topCandidateScore) {
    return right.topCandidateScore - left.topCandidateScore;
  }
  if (left.bestDepthReached !== right.bestDepthReached) {
    return right.bestDepthReached - left.bestDepthReached;
  }
  return 0;
}

function compareOracleScreeningMoveSearchSummaries(
  left: MoveSearchSummary,
  right: MoveSearchSummary
): number {
  if (left.transition.capturedImmediate77 !== right.transition.capturedImmediate77) {
    return left.transition.capturedImmediate77 ? -1 : 1;
  }
  if (left.transition.capturedImmediate66 !== right.transition.capturedImmediate66) {
    return left.transition.capturedImmediate66 ? -1 : 1;
  }
  const searchEvidenceCompare = compareSearchEvidenceMoveSearchSummaries(left, right);
  if (searchEvidenceCompare !== 0) return searchEvidenceCompare;
  if (left.transition.missedImmediateHighMerge !== right.transition.missedImmediateHighMerge) {
    return left.transition.missedImmediateHighMerge ? 1 : -1;
  }
  if (left.transition.noMergeShare !== right.transition.noMergeShare) {
    return left.transition.noMergeShare - right.transition.noMergeShare;
  }
  if (left.meanBestImmediateMergeLevelSeen !== right.meanBestImmediateMergeLevelSeen) {
    return right.meanBestImmediateMergeLevelSeen - left.meanBestImmediateMergeLevelSeen;
  }
  if (left.meanBestNearTermMergeLevelSeen !== right.meanBestNearTermMergeLevelSeen) {
    return right.meanBestNearTermMergeLevelSeen - left.meanBestNearTermMergeLevelSeen;
  }
  return compareMoveMergeOpportunitySummaries(left.transition, right.transition);
}

function comparePost7MoveSearchSummaries(
  left: MoveSearchSummary,
  right: MoveSearchSummary,
  stage: SearchStage
): number {
  if (left.transition.capturedImmediate77 !== right.transition.capturedImmediate77) {
    return left.transition.capturedImmediate77 ? -1 : 1;
  }
  if (left.transition.capturedImmediate66 !== right.transition.capturedImmediate66) {
    return left.transition.capturedImmediate66 ? -1 : 1;
  }
  if (stage !== "early") {
    const leftHasReachability = hasKnownReachability(left);
    const rightHasReachability = hasKnownReachability(right);
    if (leftHasReachability && rightHasReachability && left.reachableRatio !== right.reachableRatio) {
      return (right.reachableRatio ?? 0) - (left.reachableRatio ?? 0);
    }
  }
  const searchEvidenceCompare = compareSearchEvidenceMoveSearchSummaries(left, right);
  if (searchEvidenceCompare !== 0) {
    return searchEvidenceCompare;
  }
  if (left.transition.missedImmediateHighMerge !== right.transition.missedImmediateHighMerge) {
    return left.transition.missedImmediateHighMerge ? 1 : -1;
  }
  if (stage !== "early") {
    const leftHasReachability = hasKnownReachability(left);
    const rightHasReachability = hasKnownReachability(right);
    if (
      leftHasReachability &&
      rightHasReachability &&
      left.worstReachableImmediateMergeLevel !== right.worstReachableImmediateMergeLevel
    ) {
      return right.worstReachableImmediateMergeLevel - left.worstReachableImmediateMergeLevel;
    }
    if (
      leftHasReachability &&
      rightHasReachability &&
      left.worstReachableNearTermMergeLevel !== right.worstReachableNearTermMergeLevel
    ) {
      return right.worstReachableNearTermMergeLevel - left.worstReachableNearTermMergeLevel;
    }
  }
  if (left.transition.noMergeShare !== right.transition.noMergeShare) {
    return left.transition.noMergeShare - right.transition.noMergeShare;
  }
  if (left.meanBestImmediateMergeLevelSeen !== right.meanBestImmediateMergeLevelSeen) {
    return right.meanBestImmediateMergeLevelSeen - left.meanBestImmediateMergeLevelSeen;
  }
  if (left.meanBestNearTermMergeLevelSeen !== right.meanBestNearTermMergeLevelSeen) {
    return right.meanBestNearTermMergeLevelSeen - left.meanBestNearTermMergeLevelSeen;
  }
  if (left.meanBestChainSustainMergeCountSeen !== right.meanBestChainSustainMergeCountSeen) {
    return right.meanBestChainSustainMergeCountSeen - left.meanBestChainSustainMergeCountSeen;
  }
  if (
    left.transition.worstHighestImmediateMergeLevel !== right.transition.worstHighestImmediateMergeLevel
  ) {
    return (
      right.transition.worstHighestImmediateMergeLevel -
      left.transition.worstHighestImmediateMergeLevel
    );
  }
  if (
    left.transition.worstHighestNearTermMergeLevel !==
    right.transition.worstHighestNearTermMergeLevel
  ) {
    return (
      right.transition.worstHighestNearTermMergeLevel -
      left.transition.worstHighestNearTermMergeLevel
    );
  }
  if (left.meanFinalViableMoveCount !== right.meanFinalViableMoveCount) {
    return right.meanFinalViableMoveCount - left.meanFinalViableMoveCount;
  }
  if (left.meanFinalEmptyCount !== right.meanFinalEmptyCount) {
    return right.meanFinalEmptyCount - left.meanFinalEmptyCount;
  }
  if (left.finalNoMergeShare !== right.finalNoMergeShare) {
    return left.finalNoMergeShare - right.finalNoMergeShare;
  }
  return compareMoveMergeOpportunitySummaries(left.transition, right.transition);
}

function evaluateSearchPass(
  board: Board,
  candidates: readonly MoveMergeOpportunitySummary[],
  config: BestFirstSearchConfig,
  stage: SearchStage,
  decisionDeadlineMs: number | null,
  includeReachability: boolean
): SearchPassSummary {
  const summaries: MoveSearchSummary[] = [];
  let expandedNodes = 0;
  let cacheHitCount = 0;
  let cacheMissCount = 0;
  let searchTimeMs = 0;
  let reachabilityTimeMs = 0;
  let searchSummaryCount = 0;
  let searchSpawnChildCount = 0;
  let duplicatePrunedCount = 0;
  let noLegalMovePrunedCount = 0;
  let nodeCapHitCount = 0;
  let maxFrontierSizePeak = 0;
  let generatedNodes = 0;
  let enqueuedNodes = 0;
  let enqueueDuplicateSkipped = 0;
  let enqueueDominatedSkipped = 0;
  let popDuplicateSkipped = 0;
  let frontierPeakSize = 0;
  let expandedByDepth: DepthHistogram = {};
  let enqueuedByDepth: DepthHistogram = {};
  let runtimeBreakdown = createSearchRuntimeBreakdown();
  let remainingExpandedNodeCap = config.expandedNodeCap;

  for (let i = 0; i < candidates.length; i++) {
    const candidatesLeft = candidates.length - i;
    const candidateBudgetMs =
      decisionDeadlineMs == null
        ? getStageTimeBudgetMs(stage)
        : Math.max(1, Math.max(1, decisionDeadlineMs - performance.now()) / Math.max(1, candidatesLeft));
    const candidateConfig =
      remainingExpandedNodeCap == null
        ? config
        : {
            ...config,
            expandedNodeCap: Math.max(
              1,
              Math.floor(remainingExpandedNodeCap / Math.max(1, candidatesLeft))
            ),
          };
    const summary = evaluatePost7MoveSearchSummary(
      board,
      candidates[i]!,
      candidateConfig,
      stage,
      candidateBudgetMs,
      includeReachability
    );
    summaries.push(summary);
    expandedNodes += summary.expandedNodes;
    cacheHitCount += summary.cacheHitCount;
    cacheMissCount += summary.cacheMissCount;
    searchTimeMs += summary.searchTimeMs;
    reachabilityTimeMs += summary.reachabilityTimeMs;
    searchSummaryCount += summary.searchSummaryCount;
    searchSpawnChildCount += summary.searchSpawnChildCount;
    duplicatePrunedCount += summary.duplicatePrunedCount;
    noLegalMovePrunedCount += summary.noLegalMovePrunedCount;
    nodeCapHitCount += summary.nodeCapHitCount;
    if (summary.maxFrontierSize > maxFrontierSizePeak) {
      maxFrontierSizePeak = summary.maxFrontierSize;
    }
    generatedNodes += summary.generatedNodes;
    enqueuedNodes += summary.enqueuedNodes;
    enqueueDuplicateSkipped += summary.enqueueDuplicateSkipped;
    enqueueDominatedSkipped += summary.enqueueDominatedSkipped;
    popDuplicateSkipped += summary.popDuplicateSkipped;
    if (summary.frontierPeakSize > frontierPeakSize) {
      frontierPeakSize = summary.frontierPeakSize;
    }
    expandedByDepth = mergeDepthHistograms(expandedByDepth, summary.expandedByDepth);
    enqueuedByDepth = mergeDepthHistograms(enqueuedByDepth, summary.enqueuedByDepth);
    runtimeBreakdown = mergeRuntimeBreakdowns(runtimeBreakdown, summary.runtimeBreakdown);
    if (remainingExpandedNodeCap != null) {
      remainingExpandedNodeCap = Math.max(0, remainingExpandedNodeCap - summary.expandedNodes);
      if (remainingExpandedNodeCap <= 0) break;
    }
    if (decisionDeadlineMs != null && performance.now() >= decisionDeadlineMs) break;
  }

  return {
    summaries,
    expandedNodes,
    cacheHitCount,
    cacheMissCount,
    searchTimeMs,
    reachabilityTimeMs,
    searchSummaryCount,
    searchSpawnChildCount,
    duplicatePrunedCount,
    noLegalMovePrunedCount,
    nodeCapHitCount,
    maxFrontierSizePeak,
    rootEvaluationCount: summaries.length,
    generatedNodes,
    enqueuedNodes,
    enqueueDuplicateSkipped,
    enqueueDominatedSkipped,
    popDuplicateSkipped,
    frontierPeakSize,
    expandedByDepth,
    enqueuedByDepth,
    runtimeBreakdown,
  };
}

function mergeSearchPassSummaries(
  left: SearchPassSummary,
  right: SearchPassSummary
): SearchPassSummary {
  return {
    summaries: [...left.summaries, ...right.summaries],
    expandedNodes: left.expandedNodes + right.expandedNodes,
    cacheHitCount: left.cacheHitCount + right.cacheHitCount,
    cacheMissCount: left.cacheMissCount + right.cacheMissCount,
    searchTimeMs: left.searchTimeMs + right.searchTimeMs,
    reachabilityTimeMs: left.reachabilityTimeMs + right.reachabilityTimeMs,
    searchSummaryCount: left.searchSummaryCount + right.searchSummaryCount,
    searchSpawnChildCount: left.searchSpawnChildCount + right.searchSpawnChildCount,
    duplicatePrunedCount: left.duplicatePrunedCount + right.duplicatePrunedCount,
    noLegalMovePrunedCount: left.noLegalMovePrunedCount + right.noLegalMovePrunedCount,
    nodeCapHitCount: left.nodeCapHitCount + right.nodeCapHitCount,
    maxFrontierSizePeak: Math.max(left.maxFrontierSizePeak, right.maxFrontierSizePeak),
    rootEvaluationCount: left.rootEvaluationCount + right.rootEvaluationCount,
    generatedNodes: left.generatedNodes + right.generatedNodes,
    enqueuedNodes: left.enqueuedNodes + right.enqueuedNodes,
    enqueueDuplicateSkipped:
      left.enqueueDuplicateSkipped + right.enqueueDuplicateSkipped,
    enqueueDominatedSkipped:
      left.enqueueDominatedSkipped + right.enqueueDominatedSkipped,
    popDuplicateSkipped: left.popDuplicateSkipped + right.popDuplicateSkipped,
    frontierPeakSize: Math.max(left.frontierPeakSize, right.frontierPeakSize),
    expandedByDepth: mergeDepthHistograms(left.expandedByDepth, right.expandedByDepth),
    enqueuedByDepth: mergeDepthHistograms(left.enqueuedByDepth, right.enqueuedByDepth),
    runtimeBreakdown: mergeRuntimeBreakdowns(left.runtimeBreakdown, right.runtimeBreakdown),
  };
}

function formatDepthHistogram(histogram: DepthHistogram): string {
  const parts = Object.entries(histogram)
    .map(([depth, count]) => [Number(depth), count] as const)
    .sort((left, right) => left[0] - right[0])
    .map(([depth, count]) => `${depth}:${count}`);
  return parts.length > 0 ? parts.join(" ") : "(none)";
}

function summarizePerRootMove<T>(
  summaries: readonly MoveSearchSummary[],
  stage: SearchStage,
  pick: (summary: MoveSearchSummary) => T
): Partial<Record<Direction, T>> {
  const byMove = new Map<Direction, MoveSearchSummary>();
  for (const summary of summaries) {
    const previous = byMove.get(summary.transition.direction);
    if (
      previous == null ||
      comparePost7MoveSearchSummaries(summary, previous, stage) < 0
    ) {
      byMove.set(summary.transition.direction, summary);
    }
  }

  const out: Partial<Record<Direction, T>> = {};
  for (const [move, summary] of byMove.entries()) {
    out[move] = pick(summary);
  }
  return out;
}

function formatSearchRuntimeBreakdown(breakdown: SearchRuntimeBreakdown): string {
  return [
    `canonicalTimeMs=${breakdown.canonicalTimeMs.toFixed(2)}`,
    `heapTimeMs=${breakdown.heapTimeMs.toFixed(2)}`,
    `expandTimeMs=${breakdown.expandTimeMs.toFixed(2)}`,
    `evalSignalsTimeMs=${breakdown.evalSignalsTimeMs.toFixed(2)}`,
    `viableCountTimeMs=${breakdown.viableCountTimeMs.toFixed(2)}`,
    `scoreComputeTimeMs=${breakdown.scoreComputeTimeMs.toFixed(2)}`,
    `transpositionCheckTimeMs=${breakdown.transpositionCheckTimeMs.toFixed(2)}`,
    `frontierDedupeTimeMs=${breakdown.frontierDedupeTimeMs.toFixed(2)}`,
  ].join(" ");
}

function logRootComparisonTable(
  stage: SearchStage,
  summaries: readonly MoveSearchSummary[],
  chosenMove: Direction
): void {
  console.log(`stage=${stage} root-comparison`);
  console.log(
    "move cap77 cap66 missedHigh reachableRatio searchScore bestDepth maxDepth noMergeShare worstImmediate worstNearTerm expanded enqueued topDepth topScore searchTimeMs chosen"
  );

  const byMove = new Map<Direction, MoveSearchSummary>();
  for (const summary of summaries) {
    const previous = byMove.get(summary.transition.direction);
    if (
      previous == null ||
      comparePost7MoveSearchSummaries(summary, previous, stage) < 0
    ) {
      byMove.set(summary.transition.direction, summary);
    }
  }

  const ordered = [...byMove.values()].sort((left, right) =>
    comparePost7MoveSearchSummaries(left, right, stage)
  );

  for (const summary of ordered) {
    console.log(
      [
        summary.transition.direction,
        summary.transition.capturedImmediate77 ? "1" : "0",
        summary.transition.capturedImmediate66 ? "1" : "0",
        summary.transition.missedImmediateHighMerge ? "1" : "0",
        summary.reachableRatio == null ? "na" : summary.reachableRatio.toFixed(4),
        summary.searchScore.toFixed(2),
        String(summary.bestDepthReached),
        String(summary.maxDepthReached),
        summary.transition.noMergeShare.toFixed(4),
        String(summary.transition.worstHighestImmediateMergeLevel),
        String(summary.transition.worstHighestNearTermMergeLevel),
        String(summary.expandedNodes),
        String(summary.enqueuedNodes),
        String(summary.topCandidateDepth),
        summary.topCandidateScore.toFixed(2),
        summary.searchTimeMs.toFixed(2),
        summary.transition.direction === chosenMove ? "yes" : "no",
      ].join(" ")
    );
  }
}

function recordChosenMergeSummary(
  chosen: MoveMergeOpportunitySummary,
  chosenSearch: MoveSearchSummary | null
): void {
  minimalPolicyExperimentCounterState.mergeChosenMoveCount++;
  if (chosen.capturedImmediate77) {
    minimalPolicyExperimentCounterState.mergeChosenCapturedImmediate77Count++;
  }
  if (chosen.capturedImmediate66) {
    minimalPolicyExperimentCounterState.mergeChosenCapturedImmediate66Count++;
  }
  if (chosen.capturedOnlyChainSustainMerge) {
    minimalPolicyExperimentCounterState.mergeChosenCapturedOnlyChainSustainCount++;
  }
  if (chosen.missedImmediateHighMerge) {
    minimalPolicyExperimentCounterState.mergeChosenMissedImmediateHighMergeCount++;
  }
  if (chosen.allSpawnsNoMerge) {
    minimalPolicyExperimentCounterState.mergeChosenAllSpawnsNoMergeCount++;
  }
  minimalPolicyExperimentCounterState.mergeChosenNoMergeShareSum += chosen.noMergeShare;
  minimalPolicyExperimentCounterState.mergeChosenWorstImmediateMergeLevelSum +=
    chosen.worstHighestImmediateMergeLevel;
  minimalPolicyExperimentCounterState.mergeChosenWorstNearTermMergeLevelSum +=
    chosen.worstHighestNearTermMergeLevel;
  minimalPolicyExperimentCounterState.mergeChosenChainSustainMergeCountSum +=
    chosen.meanChainSustainMergeCount;
  minimalPolicyExperimentCounterState.mergeChosenMeanViableMoveCountSum +=
    chosen.meanViableMoveCount;

  if (chosenSearch != null) {
    minimalPolicyExperimentCounterState.post7SearchChosenSearchScoreSum +=
      chosenSearch.searchScore;
    minimalPolicyExperimentCounterState.post7SearchChosenReachableRatioSum +=
      chosenSearch.reachableRatio ?? 0;
    minimalPolicyExperimentCounterState.post7SearchChosenMeanWorstReachableImmediateMergeLevelSum +=
      chosenSearch.worstReachableImmediateMergeLevel;
    minimalPolicyExperimentCounterState.post7SearchChosenMeanWorstReachableNearTermMergeLevelSum +=
      chosenSearch.worstReachableNearTermMergeLevel;
    minimalPolicyExperimentCounterState.post7SearchChosenFinalNoMergeShareSum +=
      chosenSearch.finalNoMergeShare;
  }
}

function recordStageDecisionMetrics(stage: SearchStage, metrics: StageDecisionMetrics): void {
  if (stage === "post7") {
    minimalPolicyExperimentCounterState.post7SearchDecisionCount++;
    minimalPolicyExperimentCounterState.post7SearchTotalTimeMs += metrics.elapsedMs;
    minimalPolicyExperimentCounterState.post7SearchTotalSearchTimeMs += metrics.searchTimeMs;
    minimalPolicyExperimentCounterState.post7SearchTotalReachabilityTimeMs +=
      metrics.reachabilityTimeMs;
    minimalPolicyExperimentCounterState.post7SearchSummaryCount += metrics.searchSummaryCount;
    minimalPolicyExperimentCounterState.post7SearchSpawnChildCount += metrics.searchSpawnChildCount;
    minimalPolicyExperimentCounterState.post7SearchRootEvaluationCount += metrics.rootEvaluationCount;
    minimalPolicyExperimentCounterState.post7SearchExpandedNodeCount += metrics.expandedNodes;
    minimalPolicyExperimentCounterState.post7SearchGeneratedNodeCount += metrics.generatedNodes;
    minimalPolicyExperimentCounterState.post7SearchEnqueuedNodeCount += metrics.enqueuedNodes;
    minimalPolicyExperimentCounterState.post7SearchEnqueueDuplicateSkippedCount +=
      metrics.enqueueDuplicateSkipped;
    minimalPolicyExperimentCounterState.post7SearchEnqueueDominatedSkippedCount +=
      metrics.enqueueDominatedSkipped;
    minimalPolicyExperimentCounterState.post7SearchPopDuplicateSkippedCount +=
      metrics.popDuplicateSkipped;
    minimalPolicyExperimentCounterState.post7SearchFrontierPeakSizePeak = Math.max(
      minimalPolicyExperimentCounterState.post7SearchFrontierPeakSizePeak,
      metrics.frontierPeakSize
    );
    minimalPolicyExperimentCounterState.post7SearchBestDepthReachedSum +=
      metrics.chosenBestDepthReached;
    minimalPolicyExperimentCounterState.post7SearchBestDepthReachedPeak = Math.max(
      minimalPolicyExperimentCounterState.post7SearchBestDepthReachedPeak,
      metrics.chosenBestDepthReached
    );
    minimalPolicyExperimentCounterState.post7SearchCacheHitCount += metrics.cacheHitCount;
    minimalPolicyExperimentCounterState.post7SearchCacheMissCount += metrics.cacheMissCount;
    minimalPolicyExperimentCounterState.post7SearchDuplicatePrunedCount +=
      metrics.duplicatePrunedCount;
    minimalPolicyExperimentCounterState.post7SearchNoLegalMovePrunedCount +=
      metrics.noLegalMovePrunedCount;
    minimalPolicyExperimentCounterState.post7SearchNodeCapHitCount += metrics.nodeCapHitCount;
    minimalPolicyExperimentCounterState.post7SearchMaxFrontierSizePeak = Math.max(
      minimalPolicyExperimentCounterState.post7SearchMaxFrontierSizePeak,
      metrics.maxFrontierSizePeak
    );
    return;
  }
  if (stage === "critical") {
    minimalPolicyExperimentCounterState.criticalSearchDecisionCount++;
    minimalPolicyExperimentCounterState.criticalSearchTotalTimeMs += metrics.elapsedMs;
    minimalPolicyExperimentCounterState.criticalSearchTotalSearchTimeMs += metrics.searchTimeMs;
    minimalPolicyExperimentCounterState.criticalSearchTotalReachabilityTimeMs +=
      metrics.reachabilityTimeMs;
    minimalPolicyExperimentCounterState.criticalSearchSummaryCount += metrics.searchSummaryCount;
    minimalPolicyExperimentCounterState.criticalSearchSpawnChildCount +=
      metrics.searchSpawnChildCount;
    minimalPolicyExperimentCounterState.criticalSearchRootEvaluationCount +=
      metrics.rootEvaluationCount;
    minimalPolicyExperimentCounterState.criticalSearchExpandedNodeCount += metrics.expandedNodes;
    minimalPolicyExperimentCounterState.criticalSearchGeneratedNodeCount += metrics.generatedNodes;
    minimalPolicyExperimentCounterState.criticalSearchEnqueuedNodeCount += metrics.enqueuedNodes;
    minimalPolicyExperimentCounterState.criticalSearchEnqueueDuplicateSkippedCount +=
      metrics.enqueueDuplicateSkipped;
    minimalPolicyExperimentCounterState.criticalSearchEnqueueDominatedSkippedCount +=
      metrics.enqueueDominatedSkipped;
    minimalPolicyExperimentCounterState.criticalSearchPopDuplicateSkippedCount +=
      metrics.popDuplicateSkipped;
    minimalPolicyExperimentCounterState.criticalSearchFrontierPeakSizePeak = Math.max(
      minimalPolicyExperimentCounterState.criticalSearchFrontierPeakSizePeak,
      metrics.frontierPeakSize
    );
    minimalPolicyExperimentCounterState.criticalSearchBestDepthReachedSum +=
      metrics.chosenBestDepthReached;
    minimalPolicyExperimentCounterState.criticalSearchBestDepthReachedPeak = Math.max(
      minimalPolicyExperimentCounterState.criticalSearchBestDepthReachedPeak,
      metrics.chosenBestDepthReached
    );
    minimalPolicyExperimentCounterState.criticalSearchCacheHitCount += metrics.cacheHitCount;
    minimalPolicyExperimentCounterState.criticalSearchCacheMissCount += metrics.cacheMissCount;
    minimalPolicyExperimentCounterState.criticalSearchDuplicatePrunedCount +=
      metrics.duplicatePrunedCount;
    minimalPolicyExperimentCounterState.criticalSearchNoLegalMovePrunedCount +=
      metrics.noLegalMovePrunedCount;
    minimalPolicyExperimentCounterState.criticalSearchNodeCapHitCount += metrics.nodeCapHitCount;
    minimalPolicyExperimentCounterState.criticalSearchMaxFrontierSizePeak = Math.max(
      minimalPolicyExperimentCounterState.criticalSearchMaxFrontierSizePeak,
      metrics.maxFrontierSizePeak
    );
    return;
  }
  minimalPolicyExperimentCounterState.earlySearchDecisionCount++;
  minimalPolicyExperimentCounterState.earlySearchTotalTimeMs += metrics.elapsedMs;
  minimalPolicyExperimentCounterState.earlySearchTotalSearchTimeMs += metrics.searchTimeMs;
  minimalPolicyExperimentCounterState.earlySearchTotalReachabilityTimeMs +=
    metrics.reachabilityTimeMs;
  minimalPolicyExperimentCounterState.earlySearchSummaryCount += metrics.searchSummaryCount;
  minimalPolicyExperimentCounterState.earlySearchSpawnChildCount += metrics.searchSpawnChildCount;
  minimalPolicyExperimentCounterState.earlySearchRootEvaluationCount += metrics.rootEvaluationCount;
  minimalPolicyExperimentCounterState.earlySearchExpandedNodeCount += metrics.expandedNodes;
  minimalPolicyExperimentCounterState.earlySearchGeneratedNodeCount += metrics.generatedNodes;
  minimalPolicyExperimentCounterState.earlySearchEnqueuedNodeCount += metrics.enqueuedNodes;
  minimalPolicyExperimentCounterState.earlySearchEnqueueDuplicateSkippedCount +=
    metrics.enqueueDuplicateSkipped;
  minimalPolicyExperimentCounterState.earlySearchEnqueueDominatedSkippedCount +=
    metrics.enqueueDominatedSkipped;
  minimalPolicyExperimentCounterState.earlySearchPopDuplicateSkippedCount +=
    metrics.popDuplicateSkipped;
  minimalPolicyExperimentCounterState.earlySearchFrontierPeakSizePeak = Math.max(
    minimalPolicyExperimentCounterState.earlySearchFrontierPeakSizePeak,
    metrics.frontierPeakSize
  );
  minimalPolicyExperimentCounterState.earlySearchBestDepthReachedSum +=
    metrics.chosenBestDepthReached;
  minimalPolicyExperimentCounterState.earlySearchBestDepthReachedPeak = Math.max(
    minimalPolicyExperimentCounterState.earlySearchBestDepthReachedPeak,
    metrics.chosenBestDepthReached
  );
  minimalPolicyExperimentCounterState.earlySearchCacheHitCount += metrics.cacheHitCount;
  minimalPolicyExperimentCounterState.earlySearchCacheMissCount += metrics.cacheMissCount;
  minimalPolicyExperimentCounterState.earlySearchDuplicatePrunedCount +=
    metrics.duplicatePrunedCount;
  minimalPolicyExperimentCounterState.earlySearchNoLegalMovePrunedCount +=
    metrics.noLegalMovePrunedCount;
  minimalPolicyExperimentCounterState.earlySearchNodeCapHitCount += metrics.nodeCapHitCount;
  minimalPolicyExperimentCounterState.earlySearchMaxFrontierSizePeak = Math.max(
    minimalPolicyExperimentCounterState.earlySearchMaxFrontierSizePeak,
    metrics.maxFrontierSizePeak
  );
}

function chooseMinimalPolicyDirectionWithEarlyPost7Lift(
  board: Board,
  actions: Direction[]
): Direction {
  const baselineDirection = minimalPolicyCached(board, actions);
  if (cachedSlide(board, baselineDirection).win) return baselineDirection;
  const stage = getSearchStage(board);
  const startMs = performance.now();
  if (stage === "post7") {
    minimalPolicyExperimentCounterState.mergeWindowEntryCount++;
  }

  const transitionSummaries: MoveMergeOpportunitySummary[] = [];
  for (const direction of DIR_ORDER) {
    if (!actions.includes(direction)) continue;
    const summary = evaluateMoveMergeOpportunitySummary(board, direction, stage);
    if (summary != null) transitionSummaries.push(summary);
  }

  if (transitionSummaries.length === 0) {
    recordStageDecisionMetrics(stage, {
      elapsedMs: performance.now() - startMs,
      searchTimeMs: 0,
      reachabilityTimeMs: 0,
      searchSummaryCount: 0,
      searchSpawnChildCount: 0,
      expandedNodes: 0,
      cacheHitCount: 0,
      cacheMissCount: 0,
      duplicatePrunedCount: 0,
      noLegalMovePrunedCount: 0,
      nodeCapHitCount: 0,
      maxFrontierSizePeak: 0,
      rootEvaluationCount: 0,
      generatedNodes: 0,
      enqueuedNodes: 0,
      enqueueDuplicateSkipped: 0,
      enqueueDominatedSkipped: 0,
      popDuplicateSkipped: 0,
      frontierPeakSize: 0,
      chosenBestDepthReached: 0,
    });
    return baselineDirection;
  }

  const candidates =
    stage === "early" ? [...transitionSummaries] : filterPost7SearchCandidates(transitionSummaries);
  candidates.sort(compareMoveMergeOpportunitySummaries);
  let chosenTransition = candidates[0]!;
  let chosenSearch: MoveSearchSummary | null = null;

  if (candidates.length > 1) {
    const config = getStageSearchConfig(stage);
    const decisionDeadlineMs =
      config.decisionExpandedNodeCap == null ? startMs + getStageTimeBudgetMs(stage) : null;
    let evaluatedPass: SearchPassSummary;
    let screenedCandidateCount = 0;
    let refinedCandidateCount = 0;

    if (config.decisionExpandedNodeCap != null && config.rootRefineTopK > 0) {
      const screeningBudgetCap = Math.max(
        candidates.length,
        Math.floor(config.decisionExpandedNodeCap * config.rootScreeningBudgetFraction)
      );
      resetSearchTranspositionTable();
      const screeningPass = evaluateSearchPass(
        board,
        candidates,
        { ...config, expandedNodeCap: screeningBudgetCap },
        stage,
        null,
        false
      );
      screenedCandidateCount = screeningPass.summaries.length;
      const shortlisted = [...screeningPass.summaries].sort(compareOracleScreeningMoveSearchSummaries);
      const shortlistCount = Math.max(1, Math.min(config.rootRefineTopK, shortlisted.length));
      const shortlistTransitions = shortlisted
        .slice(0, shortlistCount)
        .map((summary) => summary.transition);
      refinedCandidateCount = shortlistTransitions.length;
      const remainingDecisionExpandedNodeCap = Math.max(
        1,
        config.decisionExpandedNodeCap - screeningPass.expandedNodes
      );
      resetSearchTranspositionTable();
      const refinePass = evaluateSearchPass(
        board,
        shortlistTransitions,
        { ...config, expandedNodeCap: remainingDecisionExpandedNodeCap },
        stage,
        null,
        true
      );
      evaluatedPass = mergeSearchPassSummaries(screeningPass, refinePass);
      if (refinePass.summaries.length > 0) {
        refinePass.summaries.sort((left, right) => comparePost7MoveSearchSummaries(left, right, stage));
        chosenSearch = refinePass.summaries[0]!;
      } else if (shortlisted.length > 0) {
        chosenSearch = shortlisted[0]!;
      }
    } else {
      resetSearchTranspositionTable();
      const searchPass = evaluateSearchPass(board, candidates, config, stage, decisionDeadlineMs, true);
      evaluatedPass = searchPass;
      screenedCandidateCount = searchPass.summaries.length;
      refinedCandidateCount = searchPass.summaries.length;
      if (searchPass.summaries.length > 0) {
        searchPass.summaries.sort((left, right) => comparePost7MoveSearchSummaries(left, right, stage));
        chosenSearch = searchPass.summaries[0]!;
      }
    }

    if (chosenSearch != null) {
      chosenTransition = chosenSearch.transition;
    }

    const elapsedMs = performance.now() - startMs;
    if (stage === "post7") {
      recordChosenMergeSummary(chosenTransition, chosenSearch);
    }
    if (SEARCH_LOGGING_ENABLED && chosenSearch != null) {
      const cacheTotal = evaluatedPass.cacheHitCount + evaluatedPass.cacheMissCount;
      const cacheHitRate = cacheTotal > 0 ? evaluatedPass.cacheHitCount / cacheTotal : 0;
      const globalMaxDepthReached = evaluatedPass.summaries.reduce(
        (best, summary) => Math.max(best, summary.maxDepthReached),
        0
      );
      const chosenRootBestDepthReached = chosenSearch.bestDepthReached;
      const perRootMaxDepthReached = summarizePerRootMove(
        evaluatedPass.summaries,
        stage,
        (summary) => summary.maxDepthReached
      );
      const perRootExpandedNodes = summarizePerRootMove(
        evaluatedPass.summaries,
        stage,
        (summary) => summary.expandedNodes
      );
      const perRootEnqueuedNodes = summarizePerRootMove(
        evaluatedPass.summaries,
        stage,
        (summary) => summary.enqueuedNodes
      );
      console.log(
        [
          `stage=${stage}`,
          `move=${chosenTransition.direction}`,
          `candidates=${candidates.length}`,
          `screened=${screenedCandidateCount}`,
          `refined=${refinedCandidateCount}`,
          `targetLevel=${chosenSearch.targetLevel}`,
          `decisionTimeMs=${elapsedMs.toFixed(2)}`,
          `searchTimeMs=${evaluatedPass.searchTimeMs.toFixed(2)}`,
          `reachabilityTimeMs=${evaluatedPass.reachabilityTimeMs.toFixed(2)}`,
          `expandedNodes=${evaluatedPass.expandedNodes}`,
          `generatedNodes=${evaluatedPass.generatedNodes}`,
          `enqueuedNodes=${evaluatedPass.enqueuedNodes}`,
          `enqueueDuplicateSkipped=${evaluatedPass.enqueueDuplicateSkipped}`,
          `enqueueDominatedSkipped=${evaluatedPass.enqueueDominatedSkipped}`,
          `popDuplicateSkipped=${evaluatedPass.popDuplicateSkipped}`,
          `cacheHitRate=${cacheHitRate.toFixed(4)}`,
          `globalMaxDepthReached=${globalMaxDepthReached}`,
          `chosenRootBestDepthReached=${chosenRootBestDepthReached}`,
          `reachableRatio=${chosenSearch.reachableRatio == null ? "na" : chosenSearch.reachableRatio.toFixed(4)}`,
          `spawnChildren=${chosenSearch.searchSpawnChildCount}`,
          `duplicatePruned=${chosenSearch.duplicatePrunedCount}`,
          `noLegalPruned=${chosenSearch.noLegalMovePrunedCount}`,
          `nodeCapHitCount=${chosenSearch.nodeCapHitCount}`,
          `maxFrontierSize=${chosenSearch.maxFrontierSize}`,
          `frontierPeakSize=${chosenSearch.frontierPeakSize}`,
          `depthUsed=${chosenSearch.config.horizon}`,
          `expandedNodeCap=${chosenSearch.config.expandedNodeCap ?? "time"}`,
          `bestDepthReached=${chosenSearch.bestDepthReached}`,
        ].join(" ")
      );
      console.log(`stage=${stage} expandedByDepth ${formatDepthHistogram(evaluatedPass.expandedByDepth)}`);
      console.log(`stage=${stage} enqueuedByDepth ${formatDepthHistogram(evaluatedPass.enqueuedByDepth)}`);
      console.log(`stage=${stage} runtime ${formatSearchRuntimeBreakdown(evaluatedPass.runtimeBreakdown)}`);
      console.log(`stage=${stage} perRootMaxDepthReached ${JSON.stringify(perRootMaxDepthReached)}`);
      console.log(`stage=${stage} perRootExpandedNodes ${JSON.stringify(perRootExpandedNodes)}`);
      console.log(`stage=${stage} perRootEnqueuedNodes ${JSON.stringify(perRootEnqueuedNodes)}`);
      logRootComparisonTable(stage, evaluatedPass.summaries, chosenTransition.direction);
    }
    recordStageDecisionMetrics(stage, {
      elapsedMs,
      searchTimeMs: evaluatedPass.searchTimeMs,
      reachabilityTimeMs: evaluatedPass.reachabilityTimeMs,
      searchSummaryCount: evaluatedPass.searchSummaryCount,
      searchSpawnChildCount: evaluatedPass.searchSpawnChildCount,
      expandedNodes: evaluatedPass.expandedNodes,
      cacheHitCount: evaluatedPass.cacheHitCount,
      cacheMissCount: evaluatedPass.cacheMissCount,
      duplicatePrunedCount: evaluatedPass.duplicatePrunedCount,
      noLegalMovePrunedCount: evaluatedPass.noLegalMovePrunedCount,
      nodeCapHitCount: evaluatedPass.nodeCapHitCount,
      maxFrontierSizePeak: evaluatedPass.maxFrontierSizePeak,
      rootEvaluationCount: evaluatedPass.rootEvaluationCount,
      generatedNodes: evaluatedPass.generatedNodes,
      enqueuedNodes: evaluatedPass.enqueuedNodes,
      enqueueDuplicateSkipped: evaluatedPass.enqueueDuplicateSkipped,
      enqueueDominatedSkipped: evaluatedPass.enqueueDominatedSkipped,
      popDuplicateSkipped: evaluatedPass.popDuplicateSkipped,
      frontierPeakSize: evaluatedPass.frontierPeakSize,
      chosenBestDepthReached: chosenSearch?.bestDepthReached ?? 0,
    });
    return chosenTransition.direction;
  }

  const elapsedMs = performance.now() - startMs;
  if (stage === "post7") {
    recordChosenMergeSummary(chosenTransition, chosenSearch);
  }
  recordStageDecisionMetrics(stage, {
    elapsedMs,
    searchTimeMs: 0,
    reachabilityTimeMs: 0,
    searchSummaryCount: 0,
    searchSpawnChildCount: 0,
    expandedNodes: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    duplicatePrunedCount: 0,
    noLegalMovePrunedCount: 0,
    nodeCapHitCount: 0,
    maxFrontierSizePeak: 0,
    rootEvaluationCount: 0,
    generatedNodes: 0,
    enqueuedNodes: 0,
    enqueueDuplicateSkipped: 0,
    enqueueDominatedSkipped: 0,
    popDuplicateSkipped: 0,
    frontierPeakSize: 0,
    chosenBestDepthReached: 0,
  });
  return chosenTransition.direction;
}

export function createEarlyPost7LiftMinimalPolicy(): Policy {
  return (board, actions) => chooseMinimalPolicyDirectionWithEarlyPost7Lift(board, actions);
}

export type HybridPolicyDecision = {
  readonly direction: Direction;
  readonly ctx: ClosureCtx;
  readonly usedClosure: boolean;
  readonly searchResult: ClosureSearchResult | null;
};

export type HybridMinimalPolicyDebugCounters = ClosureDebugCounters;
export const hybridMinimalPolicyDebugCounters = closureDebugCounters;
export const resetHybridMinimalPolicyDebugCounters = resetClosureDebugCounters;
export const snapshotHybridMinimalPolicyDebugCounters = snapshotClosureDebugCounters;

function shouldResetHybridClosureCtx(board: Board, ctx: ClosureCtx): boolean {
  if (ctx.prevBoard == null) return false;
  if (boardEquals(board, ctx.prevBoard)) return false;
  return maxTileLevel(board) <= 1 && LEN - emptyCount(board) <= 2;
}

function advanceRebuildFollowups(
  pending: readonly RebuildFollowupPending[],
  didHlMerge: boolean,
  addAcceptedRebuildDominantFamilyGroup: boolean | null,
  addAcceptedRebuildClosureReadyGroup: boolean | null,
  addAcceptedRebuildOrthAdjGroup: boolean | null
): RebuildFollowupPending[] {
  const nextPending: RebuildFollowupPending[] = [];

  for (const item of pending) {
    const age = item.age + 1;
    let hit4 = item.hit4;
    let hit8 = item.hit8;
    let hit12 = item.hit12;

    if (didHlMerge) {
      if (!hit4 && age <= 4) {
        closureDebugCounters.hlWithin4AfterRebuildAcceptedCount++;
        hit4 = true;
      }
      if (!hit8 && age <= 8) {
        closureDebugCounters.hlWithin8AfterRebuildAcceptedCount++;
        if (item.dominantFamilySizeGe2) {
          closureDebugCounters.hlWithin8AfterRebuildAcceptedDominantFamilySizeGe2Count++;
        } else {
          closureDebugCounters.hlWithin8AfterRebuildAcceptedDominantFamilySizeEq1Count++;
        }
        if (item.eventualClosureReadyHitsGe2) {
          closureDebugCounters.hlWithin8AfterRebuildAcceptedEventualClosureReadyHitsGe2Count++;
        } else {
          closureDebugCounters.hlWithin8AfterRebuildAcceptedEventualClosureReadyHitsLt2Count++;
        }
        if (item.eventualOrthAdjHitsGe2) {
          closureDebugCounters.hlWithin8AfterRebuildAcceptedEventualOrthAdjHitsGe2Count++;
        } else {
          closureDebugCounters.hlWithin8AfterRebuildAcceptedEventualOrthAdjHitsLt2Count++;
        }
        hit8 = true;
      }
      if (!hit12 && age <= 12) {
        closureDebugCounters.hlWithin12AfterRebuildAcceptedCount++;
        hit12 = true;
      }
    }

    if (age < 12) {
      nextPending.push({
        age,
        hit4,
        hit8,
        hit12,
        dominantFamilySizeGe2: item.dominantFamilySizeGe2,
        eventualClosureReadyHitsGe2: item.eventualClosureReadyHitsGe2,
        eventualOrthAdjHitsGe2: item.eventualOrthAdjHitsGe2,
      });
    }
  }

  if (
    addAcceptedRebuildDominantFamilyGroup != null &&
    addAcceptedRebuildClosureReadyGroup != null &&
    addAcceptedRebuildOrthAdjGroup != null
  ) {
    nextPending.push({
      age: 0,
      hit4: false,
      hit8: false,
      hit12: false,
      dominantFamilySizeGe2: addAcceptedRebuildDominantFamilyGroup,
      eventualClosureReadyHitsGe2: addAcceptedRebuildClosureReadyGroup,
      eventualOrthAdjHitsGe2: addAcceptedRebuildOrthAdjGroup,
    });
  }

  return nextPending;
}

type MicroRolloutEval = readonly [
  didHighLevelMerge: 0 | 1,
  finalSecondMaxTile: number,
  negFinalTopTwoDistance: number,
  finalTopTwoInsideBlock: 0 | 1,
  finalSurvivalClass: 0 | 1 | 2
];

type MicroRolloutReason = "hl" | "second_max" | "distance" | "top_two_inside" | "survival" | null;

type MicroRolloutValidation = {
  accepted: boolean;
  decisiveReason: MicroRolloutReason;
  rebuildEval: MicroRolloutEval;
  baselineEval: MicroRolloutEval;
};

function classifyMicroRolloutSurvival(n: number): 0 | 1 | 2 {
  if (n >= 5) return 2;
  if (n >= 2) return 1;
  return 0;
}

function negTopTwoDistance(board: Board, anchorIndex: ClosureAnchorIndex): number {
  const distance = getTopTwoDistance(board, anchorIndex);
  return distance == null ? -99 : -distance;
}

function representativeMicroRolloutSpawn(board: Board, anchorIndex: ClosureAnchorIndex): Board {
  const spawned = spawnAll(board);
  if (spawned.length === 0) return board;
  spawned.sort((a, b) => compareSpawnRiskWorstFirst(a, b, anchorIndex));
  return spawned[0]!;
}

function evaluateMicroRolloutBoard(board: Board, anchorIndex: ClosureAnchorIndex): MicroRolloutEval {
  return [
    0,
    secondMaxTile(board),
    negTopTwoDistance(board, anchorIndex),
    topTwoTilesMustRemainInsideAnchorBlock(board, anchorIndex) ? 1 : 0,
    classifyMicroRolloutSurvival(countOneStepSurvivors(board)),
  ];
}

function runMicroRollout(board: Board, firstMove: Direction, anchorIndex: ClosureAnchorIndex): MicroRolloutEval {
  let current = board;
  let didHighLevelMerge: 0 | 1 = 0;

  for (let ply = 0; ply < REBUILD_MICRO_ROLLOUT_HORIZON; ply++) {
    const actions = legalActions(current);
    if (actions.length === 0) break;

    const move =
      ply === 0 && actions.includes(firstMove) ? firstMove : minimalPolicy(current, actions);
    const { next, moved, win } = slide(current, move);
    if (!moved) break;
    if (createsHighLevelMerge(current, next)) didHighLevelMerge = 1;

    if (win) {
      current = next;
      break;
    }

    current = representativeMicroRolloutSpawn(next, anchorIndex);
  }

  const evalBoard = evaluateMicroRolloutBoard(current, anchorIndex);
  return [didHighLevelMerge, evalBoard[1], evalBoard[2], evalBoard[3], evalBoard[4]] as const;
}

function compareMicroRolloutEval(
  left: MicroRolloutEval,
  right: MicroRolloutEval
): { cmp: number; reason: MicroRolloutReason } {
  const reasons: readonly MicroRolloutReason[] = [
    "hl",
    "second_max",
    "distance",
    "top_two_inside",
    "survival",
  ];

  for (let i = 0; i < left.length; i++) {
    if (left[i] === right[i]) continue;
    return {
      cmp: left[i]! > right[i]! ? 1 : -1,
      reason: reasons[i] ?? null,
    };
  }

  return { cmp: 0, reason: null };
}

function evaluateRebuildMoveByMicroRollout(
  board: Board,
  rebuildMove: Direction,
  baselineMove: Direction,
  ctx: ClosureCtx
): MicroRolloutValidation {
  const status = getClosureModeStatus(board, ctx);
  const anchorIndex = status.anchor ?? ctx.anchorIndex;
  const fallbackEval = [
    0,
    secondMaxTile(board),
    -99,
    0,
    classifyMicroRolloutSurvival(countOneStepSurvivors(board)),
  ] as const satisfies MicroRolloutEval;

  if (anchorIndex == null) {
    return {
      accepted: false,
      decisiveReason: null,
      rebuildEval: fallbackEval,
      baselineEval: fallbackEval,
    };
  }

  const rebuildEval = runMicroRollout(board, rebuildMove, anchorIndex);
  const baselineEval = runMicroRollout(board, baselineMove, anchorIndex);
  const { cmp, reason } = compareMicroRolloutEval(rebuildEval, baselineEval);

  return {
    accepted: cmp > 0,
    decisiveReason: cmp > 0 ? reason : null,
    rebuildEval,
    baselineEval,
  };
}

export function validateRebuildMoveByMicroRollout(
  board: Board,
  rebuildMove: Direction,
  baselineMove: Direction,
  ctx: ClosureCtx
): boolean {
  return evaluateRebuildMoveByMicroRollout(board, rebuildMove, baselineMove, ctx).accepted;
}

export function hybridPolicy(
  board: Board,
  actions: Direction[],
  ctx: ClosureCtx = createClosureCtx()
): HybridPolicyDecision {
  if (actions.length === 0) {
    return {
      direction: DIR_ORDER[0]!,
      ctx: createClosureCtx({
        ...ctx,
        active: false,
        phase: null,
        anchorIndex: null,
        prevBoard: board,
        prevAction: null,
      }),
      usedClosure: false,
      searchResult: null,
    };
  }

  if (
    ctx.prevBoard != null &&
    ctx.prevAction != null &&
    boardEquals(ctx.prevBoard, board) &&
    actions.includes(ctx.prevAction)
  ) {
    recordClosureRepeatedBoardHit();
    return {
      direction: ctx.prevAction,
      ctx,
      usedClosure: ctx.active,
      searchResult: null,
    };
  }

  const status = getClosureModeStatus(board, ctx);
  if (status.phase === "closure" && ctx.phase !== "closure") {
    closureDebugCounters.promotedToClosureCount++;
  }
  if (status.enter) recordClosureEntry();

  const baselineDirection = minimalPolicy(board, actions);
  let direction = baselineDirection;
  let usedClosure = false;
  let searchResult: ClosureSearchResult | null = null;

  if (status.active && status.anchor != null) {
    searchResult = closureSearch(
      board,
      actions,
      createClosureCtx({
        ...ctx,
        active: status.active,
        phase: status.phase,
        anchorIndex: status.anchor,
      })
    );

    const report = getClosureDecisionReport(searchResult);
    const acceptedByPhase =
      searchResult.bestDir != null &&
      (status.phase === "closure"
        ? report.viable
        : status.phase === "rebuild"
          ? hasRebuildSuccess(searchResult.bestPath)
          : false);

    if (acceptedByPhase && searchResult.bestDir != null) {
      direction = searchResult.bestDir;
      usedClosure = true;
    }
    recordClosureDecision(report, usedClosure, status.phase, searchResult.bestPath);
  }

  const { next, moved } = slide(board, direction);
  const didHlMergeChosenMove = moved && createsHighLevelMerge(board, next);
  const acceptedRebuildProfile =
    usedClosure && status.phase === "rebuild" && searchResult?.bestPath != null
      ? getViabilityProfile(searchResult.bestPath.leafBoard, searchResult.bestPath.anchorIndex)
      : null;
  const acceptedRebuildDominantFamilySizeGe2 =
    acceptedRebuildProfile != null ? acceptedRebuildProfile.dominantFamilySize >= 2 : null;
  const acceptedRebuildEventualClosureReadyHitsGe2 =
    acceptedRebuildProfile != null ? acceptedRebuildProfile.eventualClosureReadyHitCount >= 2 : null;
  const acceptedRebuildEventualOrthAdjHitsGe2 =
    acceptedRebuildProfile != null ? acceptedRebuildProfile.eventualOrthAdjHitCount >= 2 : null;
  const rebuildFollowups = advanceRebuildFollowups(
    ctx.rebuildFollowups,
    didHlMergeChosenMove,
    acceptedRebuildDominantFamilySizeGe2,
    acceptedRebuildEventualClosureReadyHitsGe2,
    acceptedRebuildEventualOrthAdjHitsGe2
  );

  return {
    direction,
    ctx: createClosureCtx({
      ...advanceClosureCtx(ctx, board, direction),
      rebuildFollowups,
    }),
    usedClosure,
    searchResult,
  };
}

export function createHybridPolicy(seed?: Partial<ClosureCtx>): Policy {
  let ctx = createClosureCtx(seed);
  return (board, actions) => {
    if (shouldResetHybridClosureCtx(board, ctx)) {
      ctx = createClosureCtx();
    }
    const decision = hybridPolicy(board, actions, ctx);
    ctx = decision.ctx;
    return decision.direction;
  };
}

export const hybridMinimalPolicy: Policy = createHybridPolicy();

/**
 * hint 기반(기대값 탐색) + 현재 minimal 평가함수 결합 정책.
 * 기본 depth=2, 동점은 DOWN/UP/LEFT/RIGHT 우선.
 */
export function createMinimalHintHybridPolicy(cfg?: MinimalHintHybridConfig): Policy {
  const lateThreshold = cfg?.lateThreshold ?? MINIMAL_HINT_LATE_THRESHOLD;
  const depthEarly = Math.max(1, Math.floor(cfg?.depthEarly ?? MINIMAL_HINT_DEPTH_EARLY));
  const depthLate = Math.max(1, Math.floor(cfg?.depthLate ?? MINIMAL_HINT_DEPTH_LATE));
  const fixedDepth = cfg?.depth !== undefined ? Math.max(1, Math.floor(cfg.depth)) : null;
  return (board, actions) => {
    const depth =
      fixedDepth ?? (maxTileLevel(board) >= lateThreshold ? depthLate : depthEarly);
    const memo = new Map<string, number>();
    let best = actions[0]!;
    let bestQ = Number.NEGATIVE_INFINITY;
    for (const d of MINIMAL_HINT_ORDER) {
      if (!actions.includes(d)) continue;
      const q = evaluateActionMinimalHint(board, d, depth, memo);
      if (q > bestQ) {
        bestQ = q;
        best = d;
      }
    }
    return best;
  };
}

export const minimalHintHybridPolicy: Policy = createMinimalHintHybridPolicy();

/** 턴 시작 시점 보드 스냅샷(합법 slide 직전). */
export type MinimalSurvivalTurnSnapshot = {
  readonly legal: number;
  readonly empty: number;
  readonly mergePairs: number;
  readonly survivalNext: number;
  readonly nearDead: boolean;
};

export type MinimalSurvivalEpisodeReport = {
  readonly win: boolean;
  readonly steps: number;
  readonly terminalReason: TerminalReason;
  readonly maxLevelReached: number;
  readonly finalMaxLevel: number;
  readonly snapshots: readonly MinimalSurvivalTurnSnapshot[];
  readonly hadNearDead: boolean;
  /** 1-based: 몇 번째 플레이 가능 턴에서 첫 near-dead (없으면 null) */
  readonly firstNearDeadTurn: number | null;
  /** near-dead를 본 뒤 패배까지 남은 플레이 횟수(승/맥스스텝이면 null) */
  readonly turnsAfterNearDeadUntilDeath: number | null;
  /** near-dead 이후 한 번이라도 !nearDead 인 비종료 보드를 본 뒤 계속 진행 */
  readonly recoveredFromNearDead: boolean;
};

function maxOnBoard(board: Board): number {
  let m = 0;
  for (let i = 0; i < LEN; i++) if (board[i]! > m) m = board[i]!;
  return m;
}

const MAX_STEPS = 500_000;

const EMPTY_MIN: Board = Object.freeze(new Array(9).fill(0)) as Board;

/** simulateOne과 동일: 빈 판에 스폰 2회. */
export function createInitialBoardMinimal(rng: () => number): Board {
  let b: Board = EMPTY_MIN;
  b = spawnRandom(b, rng);
  return spawnRandom(b, rng);
}

/**
 * standard 모드, simulateOne과 동일한 터미널 규칙(합법 slide 없음 = 패배).
 */
export function simulateOneMinimalSurvival(rng: () => number): MinimalSurvivalEpisodeReport {
  let board = createInitialBoardMinimal(rng);
  const snapshots: MinimalSurvivalTurnSnapshot[] = [];
  let steps = 0;
  let maxLevel = 0;
  let hadNearDead = false;
  let firstNearDeadTurn: number | null = null;
  let recoveredFromNearDead = false;

  const pushSnapshot = (b: Board, turnIndex: number) => {
    const legal = legalActions(b).length;
    const empty = emptyCount(b);
    const mergePairs = countImmediateMergePairs(b);
    const survivalNext = countOneStepSurvivors(b);
    const nearDead = legal > 0 && isNearDeadFromComponents(legal, empty, mergePairs, survivalNext);
    snapshots.push({ legal, empty, mergePairs, survivalNext, nearDead });
    const mx = maxOnBoard(b);
    if (mx > maxLevel) maxLevel = mx;
    if (nearDead) {
      if (!hadNearDead) {
        hadNearDead = true;
        firstNearDeadTurn = turnIndex;
      }
    } else if (hadNearDead) {
      recoveredFromNearDead = true;
    }
  };

  let turnIndex = 1;
  while (steps < MAX_STEPS) {
    const actions = legalActions(board);
    if (actions.length === 0) {
      const turnsAfter =
        firstNearDeadTurn !== null && hadNearDead ? steps - firstNearDeadTurn + 1 : null;
      return {
        win: false,
        steps,
        terminalReason: "no_legal_moves",
        maxLevelReached: maxLevel,
        finalMaxLevel: maxOnBoard(board),
        snapshots,
        hadNearDead,
        firstNearDeadTurn,
        turnsAfterNearDeadUntilDeath: turnsAfter,
        recoveredFromNearDead,
      };
    }

    pushSnapshot(board, turnIndex);

    const dir = minimalPolicy(board, actions);
    const { next, moved, win } = slide(board, dir);
    steps++;
    const mxNext = maxOnBoard(next);
    if (mxNext > maxLevel) maxLevel = mxNext;

    if (win) {
      return {
        win: true,
        steps,
        terminalReason: "win",
        maxLevelReached: maxLevel,
        finalMaxLevel: maxOnBoard(next),
        snapshots,
        hadNearDead,
        firstNearDeadTurn,
        turnsAfterNearDeadUntilDeath: null,
        recoveredFromNearDead,
      };
    }
    if (!moved) {
      return {
        win: false,
        steps,
        terminalReason: "policy_illegal_move",
        maxLevelReached: maxLevel,
        finalMaxLevel: maxOnBoard(next),
        snapshots,
        hadNearDead,
        firstNearDeadTurn,
        turnsAfterNearDeadUntilDeath: null,
        recoveredFromNearDead,
      };
    }

    board = spawnRandom(next, rng);
    turnIndex++;
    const mx = maxOnBoard(board);
    if (mx > maxLevel) maxLevel = mx;
  }

  return {
    win: false,
    steps: MAX_STEPS,
    terminalReason: "max_steps",
    maxLevelReached: maxLevel,
    finalMaxLevel: maxOnBoard(board),
    snapshots,
    hadNearDead,
    firstNearDeadTurn,
    turnsAfterNearDeadUntilDeath: null,
    recoveredFromNearDead,
  };
}

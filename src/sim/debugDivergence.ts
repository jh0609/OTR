import { maxTileLevel } from "./board";
import { secondMaxTile } from "./boardStats";
import { detectCornerWithMax } from "./closureMode";
import { countViableMoves } from "./closureSearch";
import { legalActions } from "./legal";
import { scoreBoardMinimal } from "./minimalSurvival";
import { slide } from "./slide";
import { spawnAll } from "./spawn";
import type { Board, Direction, SlideResult } from "./types";

const DIR_ORDER: readonly Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];
const DEFAULT_BEAM_WIDTH = 3;
const DEFAULT_HORIZON = 15;
const DEFAULT_PLATEAU_WINDOW = 4;

export type LineProgressSummary = {
  bestSecondMax: number;
  finalSecondMax: number;
  reached6: boolean;
  reached7: boolean;
  deathDepth: number | null;
  lastSecondMaxIncreaseDepth: number | null;
  plateauByEnd: boolean;
};

export type DebugLine = {
  spawnStartBoard: Board;
  moves: readonly Direction[];
  boards: readonly Board[];
  secondMaxByDepth: readonly number[];
  viableCountByDepth: readonly number[];
  maxByDepth: readonly number[];
  summary: LineProgressSummary;
};

export type RootMoveDebugSummary = {
  move: Direction;
  exploredSpawnCount: number;
  reachableSecondMax6: boolean;
  reachableSecondMax7: boolean;
  bestReachableSecondMax: number;
  bestFinalSecondMax: number;
  earliestReach6Depth: number | null;
  earliestReach7Depth: number | null;
  deadLineCount: number;
  deadLineShare: number;
  plateauLineCount: number;
  plateauLineShare: number;
  bestExampleLine?: DebugLine;
};

export type ActualContinuationSummary = {
  actualMove: Direction | null;
  horizon: number;
  exploredDepth: number;
  secondMaxByDepth: readonly number[];
  viableCountByDepth: readonly number[];
  bestSecondMax: number;
  finalSecondMax: number;
  reached6: boolean;
  reached7: boolean;
  deathDepth: number | null;
  lastSecondMaxIncreaseDepth: number | null;
  plateauByEnd: boolean;
  plateauEntryDepth: number | null;
};

export type DivergenceSearchConfig = {
  beamWidth?: number;
  horizon?: number;
  plateauWindow?: number;
};

export type DivergenceStateAnalysis = {
  board: Board;
  legalMoves: readonly Direction[];
  rootSummaries: readonly RootMoveDebugSummary[];
};

type SearchContext = {
  readonly beamWidth: number;
  readonly horizon: number;
  readonly plateauWindow: number;
  readonly slideCache: Map<string, SlideResult>;
  readonly spawnCache: Map<string, readonly Board[]>;
  readonly viableCache: Map<string, number>;
  readonly legalCache: Map<string, readonly Direction[]>;
  readonly scoreCache: Map<string, number>;
  readonly beamCache: Map<string, SpawnLineSearchResult>;
};

type BeamNode = {
  board: Board;
  moves: readonly Direction[];
  boards: readonly Board[];
  secondMaxByDepth: readonly number[];
  viableCountByDepth: readonly number[];
  maxByDepth: readonly number[];
  tieBreakScore: number;
};

type SpawnLineSearchResult = {
  summary: LineProgressSummary;
  earliestReach6Depth: number | null;
  earliestReach7Depth: number | null;
  bestLine: DebugLine;
};

function boardKey(board: Board): string {
  return board.join(",");
}

function slideCacheKey(board: Board, move: Direction): string {
  return `${boardKey(board)}|${move}`;
}

function beamCacheKey(board: Board, ctx: SearchContext): string {
  return `${boardKey(board)}|bw=${ctx.beamWidth}|h=${ctx.horizon}|p=${ctx.plateauWindow}`;
}

function cachedLegalActions(ctx: SearchContext, board: Board): readonly Direction[] {
  const key = boardKey(board);
  const hit = ctx.legalCache.get(key);
  if (hit != null) return hit;
  const next = legalActions(board);
  ctx.legalCache.set(key, next);
  return next;
}

function cachedViableCount(ctx: SearchContext, board: Board): number {
  const key = boardKey(board);
  const hit = ctx.viableCache.get(key);
  if (hit !== undefined) return hit;
  const viable = countViableMoves(board, detectCornerWithMax(board));
  ctx.viableCache.set(key, viable);
  return viable;
}

function cachedScore(ctx: SearchContext, board: Board): number {
  const key = boardKey(board);
  const hit = ctx.scoreCache.get(key);
  if (hit !== undefined) return hit;
  const score = scoreBoardMinimal(board);
  ctx.scoreCache.set(key, score);
  return score;
}

function cachedSlide(ctx: SearchContext, board: Board, move: Direction): SlideResult {
  const key = slideCacheKey(board, move);
  const hit = ctx.slideCache.get(key);
  if (hit != null) return hit;
  const result = slide(board, move);
  ctx.slideCache.set(key, result);
  return result;
}

function cachedSpawnAll(ctx: SearchContext, board: Board): readonly Board[] {
  const key = boardKey(board);
  const hit = ctx.spawnCache.get(key);
  if (hit != null) return hit;
  const spawned = spawnAll(board);
  const out = spawned.length > 0 ? spawned : [board];
  ctx.spawnCache.set(key, out);
  return out;
}

function buildLineSummary(
  secondMaxByDepth: readonly number[],
  viableCountByDepth: readonly number[],
  plateauWindow: number
): LineProgressSummary {
  let bestSecondMax = 0;
  let lastSecondMaxIncreaseDepth: number | null = null;
  let deathDepth: number | null = null;

  for (let i = 0; i < secondMaxByDepth.length; i++) {
    const second = secondMaxByDepth[i]!;
    if (second > bestSecondMax) bestSecondMax = second;
    if (i > 0 && second > secondMaxByDepth[i - 1]!) {
      lastSecondMaxIncreaseDepth = i;
    }
    if (deathDepth === null && viableCountByDepth[i] === 0) {
      deathDepth = i;
    }
  }

  const finalDepth = deathDepth ?? (secondMaxByDepth.length - 1);
  const plateauByEnd =
    finalDepth >= plateauWindow &&
    (lastSecondMaxIncreaseDepth === null || finalDepth - lastSecondMaxIncreaseDepth >= plateauWindow);

  return {
    bestSecondMax,
    finalSecondMax: secondMaxByDepth[secondMaxByDepth.length - 1] ?? 0,
    reached6: bestSecondMax >= 6,
    reached7: bestSecondMax >= 7,
    deathDepth,
    lastSecondMaxIncreaseDepth,
    plateauByEnd,
  };
}

function buildDebugLine(node: BeamNode, plateauWindow: number): DebugLine {
  return {
    spawnStartBoard: node.boards[0] ?? node.board,
    moves: node.moves,
    boards: node.boards,
    secondMaxByDepth: node.secondMaxByDepth,
    viableCountByDepth: node.viableCountByDepth,
    maxByDepth: node.maxByDepth,
    summary: buildLineSummary(node.secondMaxByDepth, node.viableCountByDepth, plateauWindow),
  };
}

function compareBeamNodes(left: BeamNode, right: BeamNode): number {
  const leftViable = left.viableCountByDepth[left.viableCountByDepth.length - 1] ?? 0;
  const rightViable = right.viableCountByDepth[right.viableCountByDepth.length - 1] ?? 0;
  const leftAlive = leftViable > 0 ? 1 : 0;
  const rightAlive = rightViable > 0 ? 1 : 0;
  if (leftAlive !== rightAlive) return rightAlive - leftAlive;
  if (leftViable !== rightViable) return rightViable - leftViable;

  const leftSecond = left.secondMaxByDepth[left.secondMaxByDepth.length - 1] ?? 0;
  const rightSecond = right.secondMaxByDepth[right.secondMaxByDepth.length - 1] ?? 0;
  if (leftSecond !== rightSecond) return rightSecond - leftSecond;

  if (left.tieBreakScore !== right.tieBreakScore) return right.tieBreakScore - left.tieBreakScore;
  return 0;
}

function compareDebugLines(left: DebugLine, right: DebugLine): number {
  if (left.summary.reached7 !== right.summary.reached7) {
    return Number(right.summary.reached7) - Number(left.summary.reached7);
  }
  if (left.summary.reached6 !== right.summary.reached6) {
    return Number(right.summary.reached6) - Number(left.summary.reached6);
  }
  if (left.summary.bestSecondMax !== right.summary.bestSecondMax) {
    return right.summary.bestSecondMax - left.summary.bestSecondMax;
  }
  if (left.summary.finalSecondMax !== right.summary.finalSecondMax) {
    return right.summary.finalSecondMax - left.summary.finalSecondMax;
  }

  const leftDeath = left.summary.deathDepth ?? Number.POSITIVE_INFINITY;
  const rightDeath = right.summary.deathDepth ?? Number.POSITIVE_INFINITY;
  if (leftDeath !== rightDeath) return rightDeath - leftDeath;

  const leftViable = left.viableCountByDepth[left.viableCountByDepth.length - 1] ?? 0;
  const rightViable = right.viableCountByDepth[right.viableCountByDepth.length - 1] ?? 0;
  if (leftViable !== rightViable) return rightViable - leftViable;

  return right.moves.length - left.moves.length;
}

function makeStartNode(ctx: SearchContext, board: Board): BeamNode {
  return {
    board,
    moves: [],
    boards: [board],
    secondMaxByDepth: [secondMaxTile(board)],
    viableCountByDepth: [cachedViableCount(ctx, board)],
    maxByDepth: [maxTileLevel(board)],
    tieBreakScore: cachedScore(ctx, board),
  };
}

function searchSpawnLineWithBeam(ctx: SearchContext, board: Board): SpawnLineSearchResult {
  const cacheKey = beamCacheKey(board, ctx);
  const cached = ctx.beamCache.get(cacheKey);
  if (cached != null) return cached;

  const startNode = makeStartNode(ctx, board);
  const startLine = buildDebugLine(startNode, ctx.plateauWindow);
  let bestLine = startLine;
  let earliestReach6Depth: number | null = bestLine.summary.reached6 ? 0 : null;
  let earliestReach7Depth: number | null = bestLine.summary.reached7 ? 0 : null;
  let globalBestSecondMax = bestLine.summary.bestSecondMax;

  let frontier: BeamNode[] = startLine.summary.deathDepth === 0 ? [] : [startNode];

  for (let depth = 1; depth <= ctx.horizon && frontier.length > 0; depth++) {
    const nextFrontier: BeamNode[] = [];

    for (const node of frontier) {
      const currentViable = node.viableCountByDepth[node.viableCountByDepth.length - 1] ?? 0;
      if (currentViable === 0) continue;

      const actions = cachedLegalActions(ctx, node.board);
      if (actions.length === 0) continue;

      for (const move of DIR_ORDER) {
        if (!actions.includes(move)) continue;
        const transition = cachedSlide(ctx, node.board, move);
        if (!transition.moved) continue;

        const spawnedBoards = transition.win ? [transition.next] : cachedSpawnAll(ctx, transition.next);
        for (const child of spawnedBoards) {
          const childSecond = secondMaxTile(child);
          const childViable = cachedViableCount(ctx, child);
          const childNode: BeamNode = {
            board: child,
            moves: [...node.moves, move],
            boards: [...node.boards, child],
            secondMaxByDepth: [...node.secondMaxByDepth, childSecond],
            viableCountByDepth: [...node.viableCountByDepth, childViable],
            maxByDepth: [...node.maxByDepth, maxTileLevel(child)],
            tieBreakScore: cachedScore(ctx, child),
          };

          const childLine = buildDebugLine(childNode, ctx.plateauWindow);
          if (compareDebugLines(bestLine, childLine) > 0) {
            bestLine = childLine;
          }

          if (childLine.summary.bestSecondMax > globalBestSecondMax) {
            globalBestSecondMax = childLine.summary.bestSecondMax;
          }
          if (earliestReach6Depth === null && childLine.summary.reached6) {
            earliestReach6Depth = childNode.moves.length;
          }
          if (earliestReach7Depth === null && childLine.summary.reached7) {
            earliestReach7Depth = childNode.moves.length;
          }

          if (childViable > 0 && cachedLegalActions(ctx, child).length > 0) {
            nextFrontier.push(childNode);
          }
        }
      }
    }

    if (nextFrontier.length === 0) break;
    nextFrontier.sort(compareBeamNodes);
    frontier = nextFrontier.slice(0, ctx.beamWidth);
  }

  const bestSummary: LineProgressSummary = {
    ...bestLine.summary,
    bestSecondMax: Math.max(bestLine.summary.bestSecondMax, globalBestSecondMax),
  };
  const result: SpawnLineSearchResult = {
    summary: bestSummary,
    earliestReach6Depth,
    earliestReach7Depth,
    bestLine: {
      ...bestLine,
      summary: bestSummary,
    },
  };

  ctx.beamCache.set(cacheKey, result);
  return result;
}

function compareRootSummaries(left: RootMoveDebugSummary, right: RootMoveDebugSummary): number {
  if (left.reachableSecondMax7 !== right.reachableSecondMax7) {
    return Number(right.reachableSecondMax7) - Number(left.reachableSecondMax7);
  }
  if (left.reachableSecondMax6 !== right.reachableSecondMax6) {
    return Number(right.reachableSecondMax6) - Number(left.reachableSecondMax6);
  }

  const leftReach6Depth = left.earliestReach6Depth ?? Number.POSITIVE_INFINITY;
  const rightReach6Depth = right.earliestReach6Depth ?? Number.POSITIVE_INFINITY;
  if (leftReach6Depth !== rightReach6Depth) return leftReach6Depth - rightReach6Depth;

  if (left.bestReachableSecondMax !== right.bestReachableSecondMax) {
    return right.bestReachableSecondMax - left.bestReachableSecondMax;
  }
  if (left.bestFinalSecondMax !== right.bestFinalSecondMax) {
    return right.bestFinalSecondMax - left.bestFinalSecondMax;
  }
  if (left.deadLineShare !== right.deadLineShare) {
    return left.deadLineShare - right.deadLineShare;
  }
  if (left.plateauLineShare !== right.plateauLineShare) {
    return left.plateauLineShare - right.plateauLineShare;
  }
  return DIR_ORDER.indexOf(left.move) - DIR_ORDER.indexOf(right.move);
}

function createSearchContext(config: DivergenceSearchConfig): SearchContext {
  return {
    beamWidth: Math.max(1, config.beamWidth ?? DEFAULT_BEAM_WIDTH),
    horizon: Math.max(1, config.horizon ?? DEFAULT_HORIZON),
    plateauWindow: Math.max(1, config.plateauWindow ?? DEFAULT_PLATEAU_WINDOW),
    slideCache: new Map(),
    spawnCache: new Map(),
    viableCache: new Map(),
    legalCache: new Map(),
    scoreCache: new Map(),
    beamCache: new Map(),
  };
}

export function analyzeStateRootMoves(
  board: Board,
  config: DivergenceSearchConfig = {}
): DivergenceStateAnalysis {
  const ctx = createSearchContext(config);
  const legalMoves = cachedLegalActions(ctx, board);
  const summaries: RootMoveDebugSummary[] = [];

  for (const move of DIR_ORDER) {
    if (!legalMoves.includes(move)) continue;

    const transition = cachedSlide(ctx, board, move);
    if (!transition.moved) continue;
    const rootSpawnBoards = transition.win ? [transition.next] : cachedSpawnAll(ctx, transition.next);

    let reachableSecondMax6 = false;
    let reachableSecondMax7 = false;
    let bestReachableSecondMax = Number.NEGATIVE_INFINITY;
    let bestFinalSecondMax = Number.NEGATIVE_INFINITY;
    let earliestReach6Depth: number | null = null;
    let earliestReach7Depth: number | null = null;
    let deadLineCount = 0;
    let plateauLineCount = 0;
    let bestExampleLine: DebugLine | undefined;

    for (const spawnBoard of rootSpawnBoards) {
      const line = searchSpawnLineWithBeam(ctx, spawnBoard);
      if (line.summary.reached6) reachableSecondMax6 = true;
      if (line.summary.reached7) reachableSecondMax7 = true;
      if (line.summary.bestSecondMax > bestReachableSecondMax) {
        bestReachableSecondMax = line.summary.bestSecondMax;
      }
      if (line.summary.finalSecondMax > bestFinalSecondMax) {
        bestFinalSecondMax = line.summary.finalSecondMax;
      }
      if (line.earliestReach6Depth !== null) {
        const candidateDepth = line.earliestReach6Depth + 1;
        earliestReach6Depth =
          earliestReach6Depth === null ? candidateDepth : Math.min(earliestReach6Depth, candidateDepth);
      }
      if (line.earliestReach7Depth !== null) {
        const candidateDepth = line.earliestReach7Depth + 1;
        earliestReach7Depth =
          earliestReach7Depth === null ? candidateDepth : Math.min(earliestReach7Depth, candidateDepth);
      }
      if (line.summary.deathDepth !== null) deadLineCount++;
      if (line.summary.plateauByEnd) plateauLineCount++;
      if (bestExampleLine == null || compareDebugLines(bestExampleLine, line.bestLine) > 0) {
        bestExampleLine = line.bestLine;
      }
    }

    const exploredSpawnCount = rootSpawnBoards.length;
    summaries.push({
      move,
      exploredSpawnCount,
      reachableSecondMax6,
      reachableSecondMax7,
      bestReachableSecondMax: Number.isFinite(bestReachableSecondMax) ? bestReachableSecondMax : secondMaxTile(board),
      bestFinalSecondMax: Number.isFinite(bestFinalSecondMax) ? bestFinalSecondMax : secondMaxTile(board),
      earliestReach6Depth,
      earliestReach7Depth,
      deadLineCount,
      deadLineShare: exploredSpawnCount > 0 ? deadLineCount / exploredSpawnCount : 0,
      plateauLineCount,
      plateauLineShare: exploredSpawnCount > 0 ? plateauLineCount / exploredSpawnCount : 0,
      bestExampleLine,
    });
  }

  summaries.sort(compareRootSummaries);
  return {
    board,
    legalMoves,
    rootSummaries: summaries,
  };
}

export function summarizeActualContinuation(
  startBoard: Board,
  actualMove: Direction | null,
  continuationBoards: readonly Board[],
  config: DivergenceSearchConfig = {}
): ActualContinuationSummary {
  const ctx = createSearchContext(config);
  const horizon = Math.max(1, config.horizon ?? DEFAULT_HORIZON);
  const plateauWindow = Math.max(1, config.plateauWindow ?? DEFAULT_PLATEAU_WINDOW);
  const boards = [startBoard, ...continuationBoards.slice(0, horizon)];
  const secondMaxByDepth = boards.map((boardItem) => secondMaxTile(boardItem));
  const viableCountByDepth = boards.map((boardItem) => cachedViableCount(ctx, boardItem));
  const summary = buildLineSummary(secondMaxByDepth, viableCountByDepth, plateauWindow);
  const exploredDepth = Math.max(0, boards.length - 1);
  const plateauEntryDepth =
    summary.plateauByEnd && exploredDepth >= plateauWindow ? exploredDepth - plateauWindow + 1 : null;

  return {
    actualMove,
    horizon,
    exploredDepth,
    secondMaxByDepth,
    viableCountByDepth,
    bestSecondMax: summary.bestSecondMax,
    finalSecondMax: summary.finalSecondMax,
    reached6: summary.reached6,
    reached7: summary.reached7,
    deathDepth: summary.deathDepth,
    lastSecondMaxIncreaseDepth: summary.lastSecondMaxIncreaseDepth,
    plateauByEnd: summary.plateauByEnd,
    plateauEntryDepth,
  };
}

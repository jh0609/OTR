import type { Board, Direction } from "./types";
import { legalActions } from "./legal";
import { slide } from "./slide";
import { maxTileAtAnchor } from "./boardStats";
import type { ClosureAnchorIndex } from "./closureMode";
import {
  getTopTwoDistance,
  isCornerClean,
  topTileMustRemainInsideAnchorBlock,
  topTwoTilesMustRemainInsideAnchorBlock,
} from "./closureMode";
import { countOneStepSurvivors } from "./minimalSurvival";
import { createsHighLevelMerge, getMaxTileGap, getTopEndPairability } from "./topEndPairability";

export type WindowState = {
  windowUnbrokenAll: 0 | 1;
  windowRunLen: number;
};

export type ClosureEval = readonly [
  didHlMerge: 0 | 1,
  windowUnbrokenAll: 0 | 1,
  windowRunLen: number,
  canHlMergeNext: 0 | 1,
  anchorStableAll: 0 | 1,
  topEndInsideBlockAll: 0 | 1,
  cornerCleanAll: 0 | 1,
  minSurvClassOnPath: 0 | 1 | 2,
  minLegalClassOnPath: 0 | 1 | 2,
  negStepsToHlMerge: number,
  negDirectionBreaks: number
];

export type ClosureEvalFields = {
  didHlMerge: 0 | 1;
  windowUnbrokenAll: 0 | 1;
  windowRunLen: number;
  canHlMergeNext: 0 | 1;
  anchorStableAll: 0 | 1;
  topEndInsideBlockAll: 0 | 1;
  cornerCleanAll: 0 | 1;
  minSurvClassOnPath: 0 | 1 | 2;
  minLegalClassOnPath: 0 | 1 | 2;
  negStepsToHlMerge: number;
  negDirectionBreaks: number;
};

export type ClosurePathState = {
  steps: number;
  didHlMerge: 0 | 1;
  firstHlStep: number | null;
  anchorIndex: ClosureAnchorIndex;
  leafBoard: Board;
  rootGap: number;
  rootSurvival: number;
  rootProgressScore: number;
  window: WindowState;
  anchorStableAll: 0 | 1;
  topEndInsideBlockAll: 0 | 1;
  cornerCleanAll: 0 | 1;
  everTopTwoInsideBlock: 0 | 1;
  everCanHlMergeNext: 0 | 1;
  everCanCreateHlOpportunitySoon: 0 | 1;
  everMadeClosureProgress: 0 | 1;
  rootTopTwoDistance: number | null;
  currentTopTwoDistance: number | null;
  bestTopTwoDistance: number | null;
  bestTopTwoDistanceImprovement: number;
  minSurvClassOnPath: 0 | 1 | 2;
  minLegalClassOnPath: 0 | 1 | 2;
  directionBreaks: number;
  lastDir: Direction | null;
};

export const MIN_CLOSURE_EVAL: ClosureEval = [0, 0, 0, 0, 0, 0, 0, 0, 0, -999_999, -999_999];

function bit(v: boolean): 0 | 1 {
  return v ? 1 : 0;
}

export function isClosureWindowOpen(board: Board): boolean {
  const pair = getTopEndPairability(board);
  return getMaxTileGap(board) <= 1 && pair.top2OrthAdj && countOneStepSurvivors(board) >= 2;
}

export function updateWindowState(prev: WindowState, node: Board): WindowState {
  const pair = getTopEndPairability(node);
  const windowNow =
    getMaxTileGap(node) <= 1 &&
    pair.top2OrthAdj &&
    countOneStepSurvivors(node) >= 2;

  if (prev.windowUnbrokenAll === 0) {
    return {
      windowUnbrokenAll: 0,
      windowRunLen: prev.windowRunLen,
    };
  }

  if (windowNow) {
    return {
      windowUnbrokenAll: 1,
      windowRunLen: prev.windowRunLen + 1,
    };
  }

  return {
    windowUnbrokenAll: 0,
    windowRunLen: prev.windowRunLen,
  };
}

export function classifySurvivalCount(n: number): 0 | 1 | 2 {
  if (n >= 5) return 2;
  if (n >= 2) return 1;
  return 0;
}

export function classifyLegalCount(n: number): 0 | 1 | 2 {
  if (n >= 2) return 2;
  if (n >= 1) return 1;
  return 0;
}

export function canHlMergeNext(board: Board): 0 | 1 {
  for (const dir of legalActions(board)) {
    const { next, moved } = slide(board, dir);
    if (moved && createsHighLevelMerge(board, next)) return 1;
  }
  return 0;
}

export function canCreateHlOpportunitySoon(
  board: Board,
  anchorIndex: ClosureAnchorIndex
): 0 | 1 {
  const pair = getTopEndPairability(board);
  return bit(
    topTwoTilesMustRemainInsideAnchorBlock(board, anchorIndex) &&
      getMaxTileGap(board) <= 1 &&
      pair.top2OrthAdj &&
      isCornerClean(board, anchorIndex)
  );
}

export function closureProgressScore(
  board: Board,
  anchorIndex: ClosureAnchorIndex,
  rootGap: number,
  rootSurvival: number
): number {
  const pair = getTopEndPairability(board);
  let score = 0;
  if (topTwoTilesMustRemainInsideAnchorBlock(board, anchorIndex)) score++;
  if (topTileMustRemainInsideAnchorBlock(board, anchorIndex)) score++;
  if (pair.top2OrthAdj) score++;
  if (isCornerClean(board, anchorIndex)) score++;
  if (getMaxTileGap(board) <= rootGap) score++;
  if (countOneStepSurvivors(board) >= rootSurvival) score++;
  return score;
}

export function madeClosureProgress(
  rootBoard: Board,
  node: Board,
  anchorIndex: ClosureAnchorIndex
): 0 | 1 {
  const rootGap = getMaxTileGap(rootBoard);
  const rootSurvival = countOneStepSurvivors(rootBoard);
  const rootScore = closureProgressScore(rootBoard, anchorIndex, rootGap, rootSurvival);
  const nodeScore = closureProgressScore(node, anchorIndex, rootGap, rootSurvival);
  return bit(nodeScore > rootScore);
}

export function compareClosureEval(a: ClosureEval, b: ClosureEval): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]! ? 1 : -1;
  }
  return 0;
}

export function readClosureEval(evalTuple: ClosureEval): ClosureEvalFields {
  return {
    didHlMerge: evalTuple[0],
    windowUnbrokenAll: evalTuple[1],
    windowRunLen: evalTuple[2],
    canHlMergeNext: evalTuple[3],
    anchorStableAll: evalTuple[4],
    topEndInsideBlockAll: evalTuple[5],
    cornerCleanAll: evalTuple[6],
    minSurvClassOnPath: evalTuple[7],
    minLegalClassOnPath: evalTuple[8],
    negStepsToHlMerge: evalTuple[9],
    negDirectionBreaks: evalTuple[10],
  };
}

export function createInitialClosurePathState(
  board: Board,
  anchorIndex: ClosureAnchorIndex,
  lastDir: Direction | null = null
): ClosurePathState {
  const topTwoInside = topTwoTilesMustRemainInsideAnchorBlock(board, anchorIndex);
  const canMergeNext = canHlMergeNext(board);
  const canCreateSoon = canCreateHlOpportunitySoon(board, anchorIndex);
  const rootTopTwoDistance = getTopTwoDistance(board, anchorIndex);
  const rootGap = getMaxTileGap(board);
  const rootSurvival = countOneStepSurvivors(board);
  const rootProgressScore = closureProgressScore(board, anchorIndex, rootGap, rootSurvival);
  return {
    steps: 0,
    didHlMerge: 0,
    firstHlStep: null,
    anchorIndex,
    leafBoard: board,
    rootGap,
    rootSurvival,
    rootProgressScore,
    window: {
      windowUnbrokenAll: 1,
      windowRunLen: 0,
    },
    anchorStableAll: bit(maxTileAtAnchor(board, anchorIndex) === 1),
    topEndInsideBlockAll: bit(topTwoInside),
    cornerCleanAll: bit(isCornerClean(board, anchorIndex)),
    everTopTwoInsideBlock: bit(topTwoInside),
    everCanHlMergeNext: canMergeNext,
    everCanCreateHlOpportunitySoon: canCreateSoon,
    everMadeClosureProgress: 0,
    rootTopTwoDistance,
    currentTopTwoDistance: rootTopTwoDistance,
    bestTopTwoDistance: rootTopTwoDistance,
    bestTopTwoDistanceImprovement: 0,
    minSurvClassOnPath: classifySurvivalCount(countOneStepSurvivors(board)),
    minLegalClassOnPath: classifyLegalCount(legalActions(board).length),
    directionBreaks: 0,
    lastDir,
  };
}

export function advanceClosurePathState(
  prev: ClosurePathState,
  node: Board,
  anchorIndex: ClosureAnchorIndex,
  action: Direction,
  didHlMergeThisStep: boolean
): ClosurePathState {
  const steps = prev.steps + 1;
  const survClass = classifySurvivalCount(countOneStepSurvivors(node));
  const legalClass = classifyLegalCount(legalActions(node).length);
  const topTwoInside = topTwoTilesMustRemainInsideAnchorBlock(node, anchorIndex);
  const currentTopTwoDistance = getTopTwoDistance(node, anchorIndex);
  const canMergeNext = canHlMergeNext(node);
  const canCreateSoon = canCreateHlOpportunitySoon(node, anchorIndex);
  const madeProgress =
    closureProgressScore(node, anchorIndex, prev.rootGap, prev.rootSurvival) > prev.rootProgressScore;
  const bestTopTwoDistance =
    prev.bestTopTwoDistance == null
      ? currentTopTwoDistance
      : currentTopTwoDistance == null
        ? prev.bestTopTwoDistance
        : currentTopTwoDistance < prev.bestTopTwoDistance
          ? currentTopTwoDistance
          : prev.bestTopTwoDistance;
  const bestTopTwoDistanceImprovement =
    prev.rootTopTwoDistance != null && bestTopTwoDistance != null
      ? prev.rootTopTwoDistance - bestTopTwoDistance
      : 0;

  return {
    steps,
    didHlMerge: bit(prev.didHlMerge === 1 || didHlMergeThisStep),
    firstHlStep: prev.firstHlStep ?? (didHlMergeThisStep ? steps : null),
    anchorIndex: prev.anchorIndex,
    leafBoard: node,
    rootGap: prev.rootGap,
    rootSurvival: prev.rootSurvival,
    rootProgressScore: prev.rootProgressScore,
    window: updateWindowState(prev.window, node),
    anchorStableAll: bit(prev.anchorStableAll === 1 && maxTileAtAnchor(node, anchorIndex) === 1),
    topEndInsideBlockAll: bit(prev.topEndInsideBlockAll === 1 && topTwoInside),
    cornerCleanAll: bit(prev.cornerCleanAll === 1 && isCornerClean(node, anchorIndex)),
    everTopTwoInsideBlock: bit(prev.everTopTwoInsideBlock === 1 || topTwoInside),
    everCanHlMergeNext: bit(prev.everCanHlMergeNext === 1 || canMergeNext === 1),
    everCanCreateHlOpportunitySoon: bit(
      prev.everCanCreateHlOpportunitySoon === 1 || canCreateSoon === 1
    ),
    everMadeClosureProgress: bit(prev.everMadeClosureProgress === 1 || madeProgress),
    rootTopTwoDistance: prev.rootTopTwoDistance,
    currentTopTwoDistance,
    bestTopTwoDistance,
    bestTopTwoDistanceImprovement,
    minSurvClassOnPath:
      prev.minSurvClassOnPath < survClass ? prev.minSurvClassOnPath : survClass,
    minLegalClassOnPath:
      prev.minLegalClassOnPath < legalClass ? prev.minLegalClassOnPath : legalClass,
    directionBreaks:
      prev.directionBreaks + (prev.lastDir !== null && prev.lastDir !== action ? 1 : 0),
    lastDir: action,
  };
}

export function evaluateClosureLeaf(board: Board, path: ClosurePathState): ClosureEval {
  return [
    path.didHlMerge,
    path.window.windowUnbrokenAll,
    path.window.windowRunLen,
    canHlMergeNext(board),
    path.anchorStableAll,
    path.topEndInsideBlockAll,
    path.cornerCleanAll,
    path.minSurvClassOnPath,
    path.minLegalClassOnPath,
    -(path.firstHlStep ?? (path.steps + 1)),
    -path.directionBreaks,
  ] as const;
}

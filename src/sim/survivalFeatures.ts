/**
 * 생존/말기 계측 공통: expectimax·minimal 등 어디서든 재사용.
 * scoreBoardV3와 독립.
 */
import type { Board, Direction } from "./types";
import { emptyCount, maxTileLevel, LEN } from "./board";
import { legalActions } from "./legal";
import {
  secondMaxTile,
  top2Gap,
  hasAdjacentPair,
} from "./boardStats";
import {
  countImmediateMergePairs,
  countOneStepSurvivors,
  isNearDeadFromComponents,
} from "./minimalSurvival";

export type SurvivalFeatures = {
  readonly legalActionCount: number;
  readonly emptyCount: number;
  /** 인접 동일값 쌍 수 (minimalSurvival.countImmediateMergePairs) */
  readonly immediateMergeCount: number;
  readonly oneStepSurvivalCount: number;
  readonly maxTile: number;
  readonly secondMaxTile: number;
  readonly maxTileGap: number;
  /** 레벨 L≥6 인 인접 동일값 쌍 존재 */
  readonly hasAdjacentPairAtOrAbove6: boolean;
  readonly hasAdjacentPairAtOrAbove7: boolean;
  /**
   * 직전 턴 시작과 **동일한 전역 max 레벨**인데, 그 레벨이 놓인 **칸 인덱스 집합**이 바뀌었으면 true.
   * (앵커 이동·붕괴 추적; 레벨 상승은 `maxLevelIncreasedSincePrevTurn` 참고)
   */
  readonly maxTileAnchorShifted: boolean;
  /**
   * 직전 턴 시작 보드보다 전역 max 레벨 숫자가 커졌으면 true.
   * `prevTurnStartBoard == null`이면 false.
   */
  readonly maxLevelIncreasedSincePrevTurn: boolean;
  readonly nearDead: boolean;
  readonly deadish: boolean;
};

/** 전역 max 레벨을 가진 칸 인덱스 집합 */
export function indicesOfGlobalMax(board: Board): ReadonlySet<number> {
  const mx = maxTileLevel(board);
  const s = new Set<number>();
  if (mx === 0) return s;
  for (let i = 0; i < LEN; i++) {
    if (board[i] === mx) s.add(i);
  }
  return s;
}

function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** 동일 max 레벨일 때 최댓값 타일이 놓인 칸 집합이 바뀌었는지 */
export function isMaxTileAnchorShifted(prev: Board, curr: Board): boolean {
  const mp = maxTileLevel(prev);
  const mc = maxTileLevel(curr);
  if (mp === 0 || mc === 0) return false;
  if (mp !== mc) return false;
  return !setsEqual(indicesOfGlobalMax(prev), indicesOfGlobalMax(curr));
}

function hasAdjacentEqualAtLeastLevel(board: Board, minLevel: number): boolean {
  for (let L = minLevel; L <= 9; L++) {
    if (hasAdjacentPair(board, L)) return true;
  }
  return false;
}

/**
 * tail NDJSON deadish 프록시와 비교용: empty=0, scoring mergePairs≤1, 전역 max 레벨 인접 쌍 없음.
 * (여기서 mergePairs는 countMergePairs — 즉시 슬라이드 머지 가능한 간선 수)
 */
export function isDeadishTailStyle(board: Board, mergePairs: number): boolean {
  if (emptyCount(board) !== 0) return false;
  if (mergePairs > 1) return false;
  const mx = maxTileLevel(board);
  return !hasAdjacentPair(board, mx);
}

/**
 * 요청 정의: empty==0, immediateMerge<=1, 레벨≥6 인접 동일값 쌍 없음.
 * (고레벨 “연결” 단절을 보는 프록시; tail의 max-인접 정의와 다를 수 있음)
 */
export function isDeadish(board: Board): boolean {
  if (emptyCount(board) !== 0) return false;
  if (countImmediateMergePairs(board) > 1) return false;
  return !hasAdjacentEqualAtLeastLevel(board, 6);
}

export function isNearDeadFromFeatures(f: SurvivalFeatures): boolean {
  return f.nearDead;
}

export function extractSurvivalFeatures(
  board: Board,
  prevTurnStartBoard: Board | null = null
): SurvivalFeatures {
  const legalActionCount = legalActions(board).length;
  const emptyC = emptyCount(board);
  const immediateMergeCount = countImmediateMergePairs(board);
  const oneStepSurvivalCount = countOneStepSurvivors(board);
  const maxT = maxTileLevel(board);
  const secondM = secondMaxTile(board);
  const prevMax = prevTurnStartBoard !== null ? maxTileLevel(prevTurnStartBoard) : 0;
  const maxLevelIncreasedSincePrevTurn =
    prevTurnStartBoard !== null && maxT > prevMax;
  const maxTileAnchorShifted_ =
    prevTurnStartBoard !== null && isMaxTileAnchorShifted(prevTurnStartBoard, board);
  const nearDead =
    legalActionCount > 0 &&
    isNearDeadFromComponents(legalActionCount, emptyC, immediateMergeCount, oneStepSurvivalCount);

  return {
    legalActionCount,
    emptyCount: emptyC,
    immediateMergeCount,
    oneStepSurvivalCount,
    maxTile: maxT,
    secondMaxTile: secondM,
    maxTileGap: top2Gap(board),
    hasAdjacentPairAtOrAbove6: hasAdjacentEqualAtLeastLevel(board, 6),
    hasAdjacentPairAtOrAbove7: hasAdjacentEqualAtLeastLevel(board, 7),
    maxTileAnchorShifted: maxTileAnchorShifted_,
    maxLevelIncreasedSincePrevTurn,
    nearDead,
    deadish: isDeadish(board),
  };
}

/** A,B: 합법 수 고르기 직전(턴 시작). C,D: 해당 턴 slide+spawn 직후. */
export type SurvivalCheckpointKind = "pre_move" | "post_turn";

export type SurvivalCheckpoint = {
  /** 스냅샷 시점: pre_move=턴 시작(슬라이드 직전), post_turn=그 턴 slide+spawn 처리 직후 */
  snapshotKind: SurvivalCheckpointKind;
  turn: number;
  boardCells: readonly number[];
  chosenAction: Direction;
  legalActionCount: number;
  emptyCount: number;
  immediateMergeCount: number;
  oneStepSurvivalCount: number;
  maxTile: number;
  secondMaxTile: number;
  maxTileGap: number;
  hasAdjacentPairAtOrAbove6: boolean;
  hasAdjacentPairAtOrAbove7: boolean;
  maxTileAnchorShifted: boolean;
  maxLevelIncreasedSincePrevTurn: boolean;
  nearDead: boolean;
  deadish: boolean;
};

export function toSurvivalCheckpoint(
  snapshotKind: SurvivalCheckpointKind,
  turn: number,
  board: Board,
  chosenAction: Direction,
  f: SurvivalFeatures
): SurvivalCheckpoint {
  return {
    snapshotKind,
    turn,
    boardCells: [...board],
    chosenAction,
    legalActionCount: f.legalActionCount,
    emptyCount: f.emptyCount,
    immediateMergeCount: f.immediateMergeCount,
    oneStepSurvivalCount: f.oneStepSurvivalCount,
    maxTile: f.maxTile,
    secondMaxTile: f.secondMaxTile,
    maxTileGap: f.maxTileGap,
    hasAdjacentPairAtOrAbove6: f.hasAdjacentPairAtOrAbove6,
    hasAdjacentPairAtOrAbove7: f.hasAdjacentPairAtOrAbove7,
    maxTileAnchorShifted: f.maxTileAnchorShifted,
    maxLevelIncreasedSincePrevTurn: f.maxLevelIncreasedSincePrevTurn,
    nearDead: f.nearDead,
    deadish: f.deadish,
  };
}

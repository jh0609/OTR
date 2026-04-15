/** 1D board: index = row * 3 + col. 0 = empty, levels >= 1. */
export type Board = readonly number[];

export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

export type SlideResult = {
  readonly next: Board;
  readonly moved: boolean;
  readonly win: boolean;
};

export type Policy = (board: Board, actions: Direction[]) => Direction;

export type TerminalMode = "standard" | "strict";

/** Episode 종료 사유 (Monte Carlo 집계용). */
export const TERMINAL_REASONS = [
  "win",
  "no_legal_moves",
  "strict_rule_failed",
  "policy_illegal_move",
  "max_steps",
] as const;

export type TerminalReason = (typeof TERMINAL_REASONS)[number];

/**
 * 종료 직전 최대 10수: 각 항목은 "그 수를 두기 직전" 국면 + 선택한 방향.
 * `movesFromEnd`: 1 = 패배/승리 직전 마지막으로 둔 한 수 직전, 10 = 그보다 9수 앞(에피소드가 짧으면 최대 길이만큼만 존재).
 */
export type EpisodeTailMoveSnapshot = {
  readonly movesFromEnd: number;
  readonly legalCount: number;
  readonly emptyCount: number;
  readonly maxLevel: number;
  readonly secondMax: number;
  readonly mergePairs: number;
  readonly mp7: number;
  /** 전역 최댓값이 네 구석 중 하나에 있으면 1 */
  readonly maxAtAnyCorner: number;
  readonly chosenDirection: Direction;
  /** 슬라이드 직전 보드 (row-major 인덱스 0..8, 길이 9). */
  readonly boardCells: readonly number[];
};

export type EpisodeResult = {
  readonly win: boolean;
  readonly steps: number;
  readonly terminalReason: TerminalReason;
  /** 에피소드 중 관측된 타일 레벨의 최댓값(스폰·슬라이드 후 모든 스냅샷) */
  readonly maxLevelReached: number;
  /** 종료 직후 보드의 최고 레벨 */
  readonly finalMaxLevel: number;
  readonly everHadGte6: boolean;
  readonly everHadGte7: boolean;
  readonly everHadGte8: boolean;

  readonly peakSecondMaxTile: number;
  readonly finalSecondMaxTile: number;
  readonly finalTop2Gap: number;
  readonly finalCountTilesEq8: number;
  readonly finalCountTilesGe7: number;
  readonly peakCount8: number;

  readonly everHadTwoSevensSimultaneous: boolean;
  readonly everHadOne8AndOne7Simultaneous: boolean;
  readonly everHadTwo8sSimultaneous: boolean;

  /** 종료 보드에 8≥1 이고 7≥1 */
  readonly finalHasOne8AndOne7: boolean;
  /** 스냅샷 중 count(레벨≥7)의 최댓값 */
  readonly peakCountGe7: number;
  /** 스냅샷 중 (상위 두 타일 레벨 합)의 최댓값 */
  readonly peakTopTwoSum: number;
  /** 한 번이라도 max==8 && secondMax==6 인 상태 */
  readonly everHadMax8Second6: boolean;
  /** 한 번이라도 max==8 && secondMax==7 인 상태 */
  readonly everHadMax8Second7: boolean;

  /** 스냅샷 중 mergePotentialAtLevel(7) 최댓값 */
  readonly peakMergePotential7: number;
  readonly finalMergePotential7: number;
  /** 한 번이라도 max≥8 이고 mp7>0 */
  readonly everHadMp7PositiveWhileMaxGte8: boolean;
  /** 한 번이라도 max8+second7 이고 mp7>0 */
  readonly everHadMax8Second7WithMp7Positive: boolean;
  /** 한 번이라도 max8+second7 이고 mp7==0 */
  readonly everHadMax8Second7WithMp7Zero: boolean;

  /** 한 턴이라도 인접한 7+7 (merge 직전) */
  readonly everHadAdjacent77: boolean;
  /** 한 턴이라도 인접한 8+7 */
  readonly everHadAdjacent87: boolean;
  /** 한 턴이라도 인접한 8+8 */
  readonly everHadAdjacent88: boolean;
  readonly finalHasAdjacent77: boolean;
  readonly finalHasAdjacent87: boolean;
  readonly finalHasAdjacent88: boolean;

  readonly everHadImmediateMerge7: boolean;
  readonly everHadImmediateMerge8: boolean;
  /** 인접 7+7은 있는데 한 수로 7머지는 불가 */
  readonly everHadAdjacent77ButNoImmediateMerge7: boolean;
  readonly everHadAdjacent88ButNoImmediateMerge8: boolean;
  readonly finalCanMerge7Now: boolean;
  readonly finalCanMerge8Now: boolean;

  /** 최대 10개, 시간순(오래된 것이 앞). */
  readonly tailMoves: readonly EpisodeTailMoveSnapshot[];
};

export type MonteCarloStats = {
  readonly winRate: number;
  readonly avgSteps: number;
  readonly maxLevelDistribution: Readonly<Record<number, number>>;
  readonly finalMaxLevelDistribution: Readonly<Record<number, number>>;
  readonly episodesWithEverGte6: number;
  readonly episodesWithEverGte7: number;
  readonly episodesWithEverGte8: number;
  readonly terminalReasons: Readonly<Record<TerminalReason, number>>;

  readonly finalSecondMaxDistribution: Readonly<Record<number, number>>;
  readonly peakSecondMaxDistribution: Readonly<Record<number, number>>;
  readonly finalCount8Distribution: Readonly<Record<number, number>>;
  readonly finalCountGe7Distribution: Readonly<Record<number, number>>;

  readonly meanFinalTop2Gap: number;

  readonly episodesEverTwoSevens: number;
  readonly episodesEverOne8AndOne7: number;
  readonly episodesEverTwo8s: number;
  readonly episodesPeakCount8AtLeast2: number;

  /** 종료 시점에 8≥1 & 7≥1 */
  readonly episodesFinalOne8AndOne7: number;
  readonly meanPeakCountGe7: number;
  readonly meanPeakTopTwoSum: number;
  readonly peakCountGe7Distribution: Readonly<Record<number, number>>;
  readonly episodesEverMax8Second6: number;
  readonly episodesEverMax8Second7: number;

  readonly episodesEverMp7PositiveWhileMaxGte8: number;
  readonly episodesEverMax8Second7Mp7Positive: number;
  readonly episodesEverMax8Second7Mp7Zero: number;
  readonly meanPeakMergePotential7: number;
  readonly meanFinalMergePotential7: number;

  readonly episodesEverAdjacent77: number;
  readonly episodesEverAdjacent87: number;
  readonly episodesEverAdjacent88: number;
  readonly episodesFinalAdjacent77: number;
  readonly episodesFinalAdjacent87: number;
  readonly episodesFinalAdjacent88: number;

  readonly episodesEverImmediateMerge7: number;
  readonly episodesEverImmediateMerge8: number;
  readonly episodesEverAdjacent77NoImmediate7: number;
  readonly episodesEverAdjacent88NoImmediate8: number;
  readonly episodesFinalCanMerge7Now: number;
  readonly episodesFinalCanMerge8Now: number;

  /**
   * 극후반(마지막 10수 구간) 집계. `lateTail*` 인덱스 i = `movesFromEnd === i+1` (i=0 → 1수 전, i=9 → 10수 전).
   */
  readonly lateTailSampleCount: readonly number[];
  readonly lateTailAvgLegal: readonly number[];
  readonly lateTailAvgEmpty: readonly number[];
  readonly lateTailAvgMergePairs: readonly number[];
  readonly lateTailAvgMp7: readonly number[];
  readonly lateTailFracMaxCorner: readonly number[];
  /** 마지막 수 직전 스냅샷이 있는 에피소드 수 */
  readonly lateLastMoveSampleCount: number;
  readonly lateLastMoveLegalLe1: number;
  readonly lateLastMoveEmptyLe1: number;
  readonly lateLastMoveMergePairsZero: number;
  readonly lateLastMoveMp7LtPoint5: number;
  readonly lateLastMoveMaxNotCorner: number;
  readonly lateLastMoveChosenDir: Readonly<Record<Direction, number>>;
};

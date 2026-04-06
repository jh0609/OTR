import type { Board, EpisodeResult, MonteCarloStats, Policy, TerminalMode, TerminalReason } from "./types";
import { TERMINAL_REASONS } from "./types";
import { freezeBoard, toUint8, LEN, maxTileLevel } from "./board";
import {
  secondMaxTile,
  top2Gap,
  topTwoTileSum,
  countTilesEqual,
  countTilesAtLeast,
  hasSimultaneousOne8AndOne7,
  hasSimultaneousTwo8s,
  hasTwoOrMoreTilesEqual,
  hasMax8AndSecond6,
  hasMax8AndSecond7,
  mergePotentialAtLevel,
} from "./boardStats";
import { slide } from "./slide";
import { legalActions } from "./legal";
import { spawnRandom } from "./spawn";
import { createRng } from "./rng";

const EMPTY: Board = Object.freeze(new Array(9).fill(0)) as Board;

type MutableEpisodeStats = {
  maxLevelReached: number;
  everHadGte6: boolean;
  everHadGte7: boolean;
  everHadGte8: boolean;
  peakSecondMaxTile: number;
  peakMaxCount8: number;
  peakCountGe7: number;
  peakTopTwoSum: number;
  everTwoSevens: boolean;
  everOne8One7: boolean;
  everTwo8s: boolean;
  everMax8Second6: boolean;
  everMax8Second7: boolean;
  peakMp7: number;
  everMp7PosGte8: boolean;
  everM8S7Mp7Pos: boolean;
  everM8S7Mp7Zero: boolean;
};

function makeStats(): MutableEpisodeStats {
  return {
    maxLevelReached: 0,
    everHadGte6: false,
    everHadGte7: false,
    everHadGte8: false,
    peakSecondMaxTile: 0,
    peakMaxCount8: 0,
    peakCountGe7: 0,
    peakTopTwoSum: 0,
    everTwoSevens: false,
    everOne8One7: false,
    everTwo8s: false,
    everMax8Second6: false,
    everMax8Second7: false,
    peakMp7: 0,
    everMp7PosGte8: false,
    everM8S7Mp7Pos: false,
    everM8S7Mp7Zero: false,
  };
}

function observeBoard(board: Board, s: MutableEpisodeStats): void {
  for (let i = 0; i < LEN; i++) {
    const v = board[i];
    if (v > s.maxLevelReached) s.maxLevelReached = v;
    if (v >= 6) s.everHadGte6 = true;
    if (v >= 7) s.everHadGte7 = true;
    if (v >= 8) s.everHadGte8 = true;
  }
  const sm = secondMaxTile(board);
  if (sm > s.peakSecondMaxTile) s.peakSecondMaxTile = sm;
  const c8 = countTilesEqual(board, 8);
  if (c8 > s.peakMaxCount8) s.peakMaxCount8 = c8;
  const cge7 = countTilesAtLeast(board, 7);
  if (cge7 > s.peakCountGe7) s.peakCountGe7 = cge7;
  const t2 = topTwoTileSum(board);
  if (t2 > s.peakTopTwoSum) s.peakTopTwoSum = t2;
  if (hasTwoOrMoreTilesEqual(board, 7)) s.everTwoSevens = true;
  if (hasSimultaneousOne8AndOne7(board)) s.everOne8One7 = true;
  if (hasSimultaneousTwo8s(board)) s.everTwo8s = true;
  if (hasMax8AndSecond6(board)) s.everMax8Second6 = true;
  if (hasMax8AndSecond7(board)) s.everMax8Second7 = true;

  const mp7 = mergePotentialAtLevel(board, 7);
  if (mp7 > s.peakMp7) s.peakMp7 = mp7;
  const mx = maxTileLevel(board);
  if (mx >= 8 && mp7 > 0) s.everMp7PosGte8 = true;
  if (hasMax8AndSecond7(board)) {
    if (mp7 > 0) s.everM8S7Mp7Pos = true;
    else s.everM8S7Mp7Zero = true;
  }
}

function finalize(
  win: boolean,
  steps: number,
  reason: TerminalReason,
  s: MutableEpisodeStats,
  terminalBoard: Board
): EpisodeResult {
  return {
    win,
    steps,
    terminalReason: reason,
    maxLevelReached: s.maxLevelReached,
    finalMaxLevel: maxTileLevel(terminalBoard),
    everHadGte6: s.everHadGte6,
    everHadGte7: s.everHadGte7,
    everHadGte8: s.everHadGte8,
    peakSecondMaxTile: s.peakSecondMaxTile,
    finalSecondMaxTile: secondMaxTile(terminalBoard),
    finalTop2Gap: top2Gap(terminalBoard),
    finalCountTilesEq8: countTilesEqual(terminalBoard, 8),
    finalCountTilesGe7: countTilesAtLeast(terminalBoard, 7),
    peakCount8: s.peakMaxCount8,
    everHadTwoSevensSimultaneous: s.everTwoSevens,
    everHadOne8AndOne7Simultaneous: s.everOne8One7,
    everHadTwo8sSimultaneous: s.everTwo8s,
    finalHasOne8AndOne7: hasSimultaneousOne8AndOne7(terminalBoard),
    peakCountGe7: s.peakCountGe7,
    peakTopTwoSum: s.peakTopTwoSum,
    everHadMax8Second6: s.everMax8Second6,
    everHadMax8Second7: s.everMax8Second7,
    peakMergePotential7: s.peakMp7,
    finalMergePotential7: mergePotentialAtLevel(terminalBoard, 7),
    everHadMp7PositiveWhileMaxGte8: s.everMp7PosGte8,
    everHadMax8Second7WithMp7Positive: s.everM8S7Mp7Pos,
    everHadMax8Second7WithMp7Zero: s.everM8S7Mp7Zero,
  };
}

function initialBoard(rng: () => number): Board {
  let b: Board = EMPTY;
  b = spawnRandom(b, rng);
  b = spawnRandom(b, rng);
  return b;
}

const MAX_STEPS = 500_000;

function emptyTerminalReasons(): Record<TerminalReason, number> {
  const o = {} as Record<TerminalReason, number>;
  for (const k of TERMINAL_REASONS) o[k] = 0;
  return o;
}

/**
 * One full episode. `rng` drives spawn positions (and should be used with seeded policies).
 * Strict: `extraRule` is checked after each spawn (including the two initial spawns).
 */
export function simulateOne(
  policy: Policy,
  rng: () => number,
  mode: TerminalMode = "standard",
  extraRule?: (board: Board) => boolean
): EpisodeResult {
  const s = makeStats();
  let board = initialBoard(rng);
  observeBoard(board, s);
  let steps = 0;

  if (mode === "strict" && extraRule !== undefined && !extraRule(board)) {
    return finalize(false, 0, "strict_rule_failed", s, board);
  }

  while (steps < MAX_STEPS) {
    const actions = legalActions(board);
    if (actions.length === 0) {
      return finalize(false, steps, "no_legal_moves", s, board);
    }
    if (mode === "strict" && extraRule !== undefined && !extraRule(board)) {
      return finalize(false, steps, "strict_rule_failed", s, board);
    }

    const dir = policy(board, actions);
    const { next, moved, win } = slide(board, dir);
    observeBoard(next, s);
    steps++;

    if (win) return finalize(true, steps, "win", s, next);
    if (!moved) {
      return finalize(false, steps, "policy_illegal_move", s, next);
    }

    board = spawnRandom(next, rng);
    observeBoard(board, s);

    if (mode === "strict" && extraRule !== undefined && !extraRule(board)) {
      return finalize(false, steps, "strict_rule_failed", s, board);
    }
  }

  return finalize(false, MAX_STEPS, "max_steps", s, board);
}

export function runMonteCarlo(
  policy: Policy,
  n: number,
  seed: number,
  mode: TerminalMode = "standard",
  extraRule?: (board: Board) => boolean
): MonteCarloStats {
  const rng = createRng(seed);
  let wins = 0;
  let stepSum = 0;
  let sumTop2Gap = 0;
  let sumPeakCountGe7 = 0;
  let sumPeakTopTwoSum = 0;
  const maxLevelDistribution: Record<number, number> = {};
  const finalMaxLevelDistribution: Record<number, number> = {};
  const finalSecondMaxDistribution: Record<number, number> = {};
  const peakSecondMaxDistribution: Record<number, number> = {};
  const finalCount8Distribution: Record<number, number> = {};
  const finalCountGe7Distribution: Record<number, number> = {};
  const peakCountGe7Distribution: Record<number, number> = {};
  let episodesWithEverGte6 = 0;
  let episodesWithEverGte7 = 0;
  let episodesWithEverGte8 = 0;
  let episodesEverTwoSevens = 0;
  let episodesEverOne8AndOne7 = 0;
  let episodesEverTwo8s = 0;
  let episodesPeakCount8AtLeast2 = 0;
  let episodesFinalOne8AndOne7 = 0;
  let episodesEverMax8Second6 = 0;
  let episodesEverMax8Second7 = 0;
  let episodesEverMp7PositiveWhileMaxGte8 = 0;
  let episodesEverMax8Second7Mp7Positive = 0;
  let episodesEverMax8Second7Mp7Zero = 0;
  let sumPeakMp7 = 0;
  let sumFinalMp7 = 0;
  const terminalReasons = emptyTerminalReasons();

  for (let i = 0; i < n; i++) {
    const r = simulateOne(policy, rng, mode, extraRule);
    if (r.win) wins++;
    stepSum += r.steps;
    sumTop2Gap += r.finalTop2Gap;
    sumPeakCountGe7 += r.peakCountGe7;
    sumPeakTopTwoSum += r.peakTopTwoSum;

    maxLevelDistribution[r.maxLevelReached] = (maxLevelDistribution[r.maxLevelReached] ?? 0) + 1;
    finalMaxLevelDistribution[r.finalMaxLevel] = (finalMaxLevelDistribution[r.finalMaxLevel] ?? 0) + 1;
    finalSecondMaxDistribution[r.finalSecondMaxTile] = (finalSecondMaxDistribution[r.finalSecondMaxTile] ?? 0) + 1;
    peakSecondMaxDistribution[r.peakSecondMaxTile] = (peakSecondMaxDistribution[r.peakSecondMaxTile] ?? 0) + 1;
    finalCount8Distribution[r.finalCountTilesEq8] = (finalCount8Distribution[r.finalCountTilesEq8] ?? 0) + 1;
    finalCountGe7Distribution[r.finalCountTilesGe7] = (finalCountGe7Distribution[r.finalCountTilesGe7] ?? 0) + 1;
    peakCountGe7Distribution[r.peakCountGe7] = (peakCountGe7Distribution[r.peakCountGe7] ?? 0) + 1;

    if (r.everHadGte6) episodesWithEverGte6++;
    if (r.everHadGte7) episodesWithEverGte7++;
    if (r.everHadGte8) episodesWithEverGte8++;
    if (r.everHadTwoSevensSimultaneous) episodesEverTwoSevens++;
    if (r.everHadOne8AndOne7Simultaneous) episodesEverOne8AndOne7++;
    if (r.everHadTwo8sSimultaneous) episodesEverTwo8s++;
    if (r.peakCount8 >= 2) episodesPeakCount8AtLeast2++;
    if (r.finalHasOne8AndOne7) episodesFinalOne8AndOne7++;
    if (r.everHadMax8Second6) episodesEverMax8Second6++;
    if (r.everHadMax8Second7) episodesEverMax8Second7++;
    if (r.everHadMp7PositiveWhileMaxGte8) episodesEverMp7PositiveWhileMaxGte8++;
    if (r.everHadMax8Second7WithMp7Positive) episodesEverMax8Second7Mp7Positive++;
    if (r.everHadMax8Second7WithMp7Zero) episodesEverMax8Second7Mp7Zero++;
    sumPeakMp7 += r.peakMergePotential7;
    sumFinalMp7 += r.finalMergePotential7;
    terminalReasons[r.terminalReason]++;
  }

  return {
    winRate: n > 0 ? wins / n : 0,
    avgSteps: n > 0 ? stepSum / n : 0,
    maxLevelDistribution,
    finalMaxLevelDistribution,
    episodesWithEverGte6,
    episodesWithEverGte7,
    episodesWithEverGte8,
    terminalReasons,
    finalSecondMaxDistribution,
    peakSecondMaxDistribution,
    finalCount8Distribution,
    finalCountGe7Distribution,
    meanFinalTop2Gap: n > 0 ? sumTop2Gap / n : 0,
    episodesEverTwoSevens,
    episodesEverOne8AndOne7,
    episodesEverTwo8s,
    episodesPeakCount8AtLeast2,
    episodesFinalOne8AndOne7,
    meanPeakCountGe7: n > 0 ? sumPeakCountGe7 / n : 0,
    meanPeakTopTwoSum: n > 0 ? sumPeakTopTwoSum / n : 0,
    peakCountGe7Distribution,
    episodesEverMax8Second6,
    episodesEverMax8Second7,
    episodesEverMp7PositiveWhileMaxGte8,
    episodesEverMax8Second7Mp7Positive,
    episodesEverMax8Second7Mp7Zero,
    meanPeakMergePotential7: n > 0 ? sumPeakMp7 / n : 0,
    meanFinalMergePotential7: n > 0 ? sumFinalMp7 / n : 0,
  };
}

/** Exposed for tests: empty board frozen. */
export function emptyBoard(): Board {
  return EMPTY;
}

/** Deterministic board from nine cell values (test helper). */
export function boardFrom(vals: readonly number[]): Board {
  if (vals.length !== 9) throw new Error("boardFrom: expected 9 values");
  const u = new Uint8Array(9);
  for (let i = 0; i < 9; i++) u[i] = vals[i]!;
  return freezeBoard(u);
}

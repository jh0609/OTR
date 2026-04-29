import fs from "node:fs";
import path from "node:path";

import {
  createRng,
  emptyCount,
  maxTileLevel,
  score_toplevel_move,
  type Board,
  type Direction,
  type TerminalReason,
} from "../src/sim/index.ts";
import {
  countTilesEqual,
  hasAdjacentPair,
  hasImmediateMerge,
  mergePotentialAtLevel,
  secondMaxTile,
} from "../src/sim/boardStats.ts";
import { legalActions } from "../src/sim/legal.ts";
import { slide } from "../src/sim/slide.ts";
import { spawnRandom } from "../src/sim/spawn.ts";
import { boardFrom } from "../src/sim/simulate.ts";

const N = Math.max(1, Math.floor(Number(process.env.REF_D8_ANALYZE_N ?? "5")));
const BASE_SEED = Math.floor(Number(process.env.REF_D8_ANALYZE_SEED ?? "20260424"));
const MAX_STEPS = Math.max(1, Math.floor(Number(process.env.REF_D8_ANALYZE_MAX_STEPS ?? "500000")));
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_PATH = path.resolve(process.env.REF_D8_ANALYZE_OUT ?? `out/reference-depth8-failures-${STAMP}.jsonl`);

const REFERENCE_MOVE_ORDER: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];

type MoveScore = {
  readonly move: Direction;
  readonly legal: boolean;
  readonly d6: number;
  readonly d8: number;
};

type Depth8Decision = {
  readonly turn: number;
  readonly board: readonly number[];
  readonly legalActions: readonly Direction[];
  readonly chosenD6: Direction;
  readonly chosenD8: Direction;
  readonly chosen: Direction;
  readonly d6Ms: number;
  readonly d8Ms: number;
  readonly d6d8Disagree: boolean;
  readonly chosenFuses8: boolean;
  readonly immediateFusion8Available: boolean;
  readonly scores: readonly MoveScore[];
  readonly maxTile: number;
  readonly secondMax: number;
  readonly empty: number;
  readonly count8: number;
  readonly count7: number;
  readonly adjacent88: boolean;
  readonly immediateMerge7: boolean;
  readonly mp7: number;
  readonly mp8: number;
};

type EpisodeSummary = {
  readonly type: "episode";
  readonly seed: number;
  readonly result: "win" | "fail";
  readonly terminalReason: TerminalReason;
  readonly steps: number;
  readonly first8Turn: number | null;
  readonly firstImmediateFusion8Turn: number | null;
  readonly depth8DecisionCount: number;
  readonly d6d8DisagreementCount: number;
  readonly missedImmediateFusion8Count: number;
  readonly maxLevelReached: number;
  readonly peakSecondMax: number;
  readonly peakCount8: number;
  readonly finalBoard: readonly number[];
  readonly finalMax: number;
  readonly finalSecondMax: number;
  readonly finalCanMerge8Now: boolean;
  readonly depth8Tail: readonly Depth8Decision[];
};

function fmtBoard(board: Board): readonly number[] {
  return Array.from(board);
}

function initialBoard(rng: () => number): Board {
  let board = boardFrom([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  board = spawnRandom(board, rng);
  board = spawnRandom(board, rng);
  return board;
}

function chooseBest(scores: readonly MoveScore[], key: "d6" | "d8"): Direction {
  let bestMove: Direction = "UP";
  let best = 0;
  for (const score of scores) {
    const value = score[key];
    if (value > best) {
      best = value;
      bestMove = score.move;
    }
  }
  return bestMove;
}

function scoreBoardAtDepth(board: Board, depthLimit: 6 | 8): { scores: MoveScore[]; elapsedMs: number } {
  const startedAt = process.hrtime.bigint();
  const legal = new Set(legalActions(board));
  const scores = REFERENCE_MOVE_ORDER.map((move, index) => ({
    move,
    legal: legal.has(move),
    d6: depthLimit === 6 ? score_toplevel_move(board, index, { depthLimit }) : Number.NaN,
    d8: depthLimit === 8 ? score_toplevel_move(board, index, { depthLimit }) : Number.NaN,
  }));
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  return { scores, elapsedMs };
}

function mergeScores(d6: readonly MoveScore[], d8: readonly MoveScore[]): MoveScore[] {
  return d6.map((left, index) => ({
    move: left.move,
    legal: left.legal,
    d6: left.d6,
    d8: d8[index]?.d8 ?? Number.NaN,
  }));
}

function chosenFusesLevel8(board: Board, dir: Direction): boolean {
  const { next, moved, win } = slide(board, dir);
  if (!moved) return false;
  return win && !next.includes(9);
}

function makeDepth8Decision(turn: number, board: Board): Depth8Decision {
  const d6 = scoreBoardAtDepth(board, 6);
  const d8 = scoreBoardAtDepth(board, 8);
  const scores = mergeScores(d6.scores, d8.scores);
  const chosenD6 = chooseBest(scores, "d6");
  const chosenD8 = chooseBest(scores, "d8");
  const immediateFusion8Available = hasImmediateMerge(board, 8);
  return {
    turn,
    board: fmtBoard(board),
    legalActions: legalActions(board),
    chosenD6,
    chosenD8,
    chosen: chosenD8,
    d6Ms: d6.elapsedMs,
    d8Ms: d8.elapsedMs,
    d6d8Disagree: chosenD6 !== chosenD8,
    chosenFuses8: chosenFusesLevel8(board, chosenD8),
    immediateFusion8Available,
    scores,
    maxTile: maxTileLevel(board),
    secondMax: secondMaxTile(board),
    empty: emptyCount(board),
    count8: countTilesEqual(board, 8),
    count7: countTilesEqual(board, 7),
    adjacent88: countTilesEqual(board, 8) >= 2 && hasAdjacentPair(board, 8),
    immediateMerge7: hasImmediateMerge(board, 7),
    mp7: mergePotentialAtLevel(board, 7),
    mp8: mergePotentialAtLevel(board, 8),
  };
}

function runEpisode(seed: number): EpisodeSummary {
  const rng = createRng(seed);
  let board = initialBoard(rng);
  let steps = 0;
  let terminalReason: TerminalReason = "max_steps";
  let first8Turn: number | null = null;
  let firstImmediateFusion8Turn: number | null = null;
  let won = false;
  let maxLevelReached = maxTileLevel(board);
  let peakSecondMax = secondMaxTile(board);
  let peakCount8 = countTilesEqual(board, 8);
  const depth8Decisions: Depth8Decision[] = [];

  while (steps < MAX_STEPS) {
    const actions = legalActions(board);
    if (actions.length === 0) {
      terminalReason = "no_legal_moves";
      break;
    }

    const maxTile = maxTileLevel(board);
    if (maxTile > maxLevelReached) maxLevelReached = maxTile;
    const second = secondMaxTile(board);
    if (second > peakSecondMax) peakSecondMax = second;
    const count8 = countTilesEqual(board, 8);
    if (count8 > peakCount8) peakCount8 = count8;
    if (maxTile >= 8 && first8Turn == null) first8Turn = steps;
    if (hasImmediateMerge(board, 8) && firstImmediateFusion8Turn == null) {
      firstImmediateFusion8Turn = steps;
    }

    const decision =
      maxTile >= 8
        ? makeDepth8Decision(steps, board)
        : null;
    if (decision != null) depth8Decisions.push(decision);
    const dir = decision?.chosen ?? chooseBest(scoreBoardAtDepth(board, 6).scores, "d6");

    const { next, moved, win } = slide(board, dir);
    steps++;
    if (!moved) {
      terminalReason = "policy_illegal_move";
      board = next;
      break;
    }
    if (win) {
      won = true;
    }

    board = spawnRandom(next, rng);
    if (win) {
      maxLevelReached = Math.max(maxLevelReached, maxTileLevel(board));
      peakSecondMax = Math.max(peakSecondMax, secondMaxTile(board));
      peakCount8 = Math.max(peakCount8, countTilesEqual(board, 8));
      continue;
    }
  }

  const missedImmediateFusion8Count = depth8Decisions.filter(
    (d) => d.immediateFusion8Available && !d.chosenFuses8
  ).length;

  return {
    type: "episode",
    seed,
    result: won ? "win" : "fail",
    terminalReason,
    steps,
    first8Turn,
    firstImmediateFusion8Turn,
    depth8DecisionCount: depth8Decisions.length,
    d6d8DisagreementCount: depth8Decisions.filter((d) => d.d6d8Disagree).length,
    missedImmediateFusion8Count,
    maxLevelReached,
    peakSecondMax,
    peakCount8,
    finalBoard: fmtBoard(board),
    finalMax: maxTileLevel(board),
    finalSecondMax: secondMaxTile(board),
    finalCanMerge8Now: hasImmediateMerge(board, 8),
    depth8Tail: depth8Decisions.slice(-20),
  };
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
const stream = fs.createWriteStream(OUT_PATH, "utf8");
const summaries: EpisodeSummary[] = [];

for (let i = 0; i < N; i++) {
  const summary = runEpisode(BASE_SEED + i);
  summaries.push(summary);
  stream.write(`${JSON.stringify(summary)}\n`);
  console.log(
    `seed=${summary.seed} result=${summary.result} steps=${summary.steps} first8=${summary.first8Turn ?? "-"} depth8=${summary.depth8DecisionCount} disagree=${summary.d6d8DisagreementCount} missedFusion8=${summary.missedImmediateFusion8Count}`
  );
}

stream.end();

const reached8 = summaries.filter((s) => s.first8Turn != null);
const failuresAfter8 = reached8.filter((s) => s.result !== "win");
const depth8DecisionCount = summaries.reduce((sum, s) => sum + s.depth8DecisionCount, 0);
const disagreementCount = summaries.reduce((sum, s) => sum + s.d6d8DisagreementCount, 0);
const missedImmediate8 = summaries.reduce((sum, s) => sum + s.missedImmediateFusion8Count, 0);

console.log("");
console.log(`out=${OUT_PATH}`);
console.log(`episodes=${N} baseSeed=${BASE_SEED}`);
console.log(`wins=${summaries.filter((s) => s.result === "win").length}/${N}`);
console.log(`reached8=${reached8.length}/${N}`);
console.log(`failuresAfter8=${failuresAfter8.length}/${N}`);
console.log(`depth8Decisions=${depth8DecisionCount}`);
console.log(`d6d8Disagreements=${disagreementCount}`);
console.log(`missedImmediateFusion8=${missedImmediate8}`);

import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { emptyCount, maxTileLevel } from "../src/sim/board.ts";
import { countTilesEqual, secondMaxTile } from "../src/sim/boardStats.ts";
import { legalActions } from "../src/sim/legal.ts";
import {
  createEarlyPost7LiftMinimalPolicy,
  resetMinimalPolicyExperimentDebugCounters,
  snapshotMinimalPolicyExperimentDebugCounters,
  type MinimalPolicyExperimentDebugCounters,
} from "../src/sim/minimalSurvival.ts";
import { createRng } from "../src/sim/rng.ts";
import { boardFrom } from "../src/sim/simulate.ts";
import { slide } from "../src/sim/slide.ts";
import { spawnRandomDetailed, type SpawnPlacement } from "../src/sim/spawn.ts";
import type { Board, Direction } from "../src/sim/types.ts";

type ReplayResult = "win" | "lose" | "policy_illegal_move" | "max_steps";

type CliOptions = {
  file: string;
  turn: number;
  steps: number;
  seed: number;
};

type LogRecord = {
  type?: string;
  turn?: number;
  sessionId?: string;
  seed?: number;
  move?: Direction;
  boardBefore?: readonly number[];
  board?: readonly number[];
  initialBoard?: readonly number[];
};

type ReplaySource = {
  sessionId: string | null;
  seed: number | null;
  sourceTurn: number;
  board: Board;
};

type ReplayStartRecord = {
  type: "oracle_replay_start";
  replayId: string;
  startedAt: string;
  sourceFile: string;
  sourceTurn: number;
  sourceSessionId: string | null;
  sourceSeed: number | null;
  replaySeed: number;
  oracleSearch: boolean;
  stepsRequested: number;
  board: readonly number[];
};

type ReplayTurnRecord = {
  type: "oracle_replay_turn";
  replayId: string;
  sourceTurn: number;
  turn: number;
  replayStep: number;
  boardBefore: readonly number[];
  move: Direction;
  moved: boolean;
  boardAfterSlide: readonly number[];
  boardAfterSpawn: readonly number[] | null;
  spawn: SpawnPlacement | null;
  finalBoard: readonly number[];
  legalActions: readonly Direction[];
  legalMoveCount: number;
  emptyCount: number;
  maxTileBefore: number;
  secondMaxBefore: number;
  maxTileAfter: number;
  secondMaxAfter: number;
  win: boolean;
  lose: boolean;
};

type ReplayEndRecord = {
  type: "oracle_replay_end";
  replayId: string;
  finishedAt: string;
  result: ReplayResult;
  stepsReplayed: number;
  reachedFirst7: boolean;
  reachedSecondMax6: boolean;
  reachedSecondMax7: boolean;
  finalBoard: readonly number[];
  finalMaxTile: number;
  finalSecondMax: number;
  runtimeMs: number;
  counters: MinimalPolicyExperimentDebugCounters;
};

type StageReport = {
  label: "early" | "critical" | "post7";
  decisionCount: number;
  moveTimeMs: number;
  searchTimeMs: number;
  reachabilityTimeMs: number;
  summaryCount: number;
  spawnChildCount: number;
  meanSpawnChildCount: number;
  rootEvaluationCount: number;
  expandedNodes: number;
  meanPerRootExpandedNodes: number;
  generatedNodes: number;
  enqueuedNodes: number;
  meanPerRootEnqueuedNodes: number;
  enqueueDuplicateSkipped: number;
  enqueueDominatedSkipped: number;
  popDuplicateSkipped: number;
  meanBestDepthReached: number;
  bestDepthReachedPeak: number;
  cacheHitCount: number;
  cacheMissCount: number;
  duplicatePrunedCount: number;
  noLegalMovePrunedCount: number;
  nodeCapHitCount: number;
  maxFrontierSizePeak: number;
  frontierPeakSizePeak: number;
};

const DEFAULT_STEPS = 30;
const DEFAULT_SEED = 20260424;

function usage(): never {
  console.error(
    "usage: CLOSURE_AB_ORACLE_SEARCH=1 npx tsx tools/oracle-replay.ts --file <episode.jsonl> --turn <n> --steps <k> [--seed <n>]"
  );
  process.exit(1);
}

function parseArgs(argv: readonly string[]): CliOptions {
  let file: string | null = null;
  let turn: number | null = null;
  let steps = DEFAULT_STEPS;
  let seed = Number(process.env.ORACLE_REPLAY_SEED ?? DEFAULT_SEED);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === "--file") {
      file = next ?? null;
      i++;
      continue;
    }
    if (arg === "--turn") {
      turn = Number(next);
      i++;
      continue;
    }
    if (arg === "--steps") {
      steps = Number(next);
      i++;
      continue;
    }
    if (arg === "--seed") {
      seed = Number(next);
      i++;
      continue;
    }
    usage();
  }

  if (file == null || !Number.isFinite(turn ?? NaN)) usage();
  if (!Number.isFinite(steps) || steps < 1) usage();
  if (!Number.isFinite(seed)) usage();

  return {
    file: path.resolve(file),
    turn: Math.floor(turn!),
    steps: Math.floor(steps),
    seed: Math.floor(seed),
  };
}

function makeStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
}

function boardCells(board: Board): readonly number[] {
  return Array.from(board) as readonly number[];
}

function fmtBoard(board: Board): string {
  const labels = board.map((value) => (value === 0 ? "." : String(value)));
  const width = Math.max(1, ...labels.map((value) => value.length));
  const rows: string[] = [];

  for (let r = 0; r < 3; r++) {
    const row = labels.slice(r * 3, r * 3 + 3).map((value) => value.padStart(width, " "));
    rows.push(` ${row.join(" | ")} `);
  }

  const separator = rows[0]!.replace(/[^\|]/g, "-");
  return [rows[0]!, separator, rows[1]!, separator, rows[2]!].join("\n");
}

function fmtMs(value: number): string {
  return value.toFixed(2);
}

function pctCount(hit: number, total: number): string {
  if (total <= 0) return "0.00%";
  return `${((hit / total) * 100).toFixed(2)}%`;
}

function asBoardCells(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || value.length !== 9) return null;
  if (!value.every((cell) => typeof cell === "number" && Number.isFinite(cell))) return null;
  return value as readonly number[];
}

function loadReplaySource(file: string, turn: number): ReplaySource {
  const text = fs.readFileSync(file, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let sessionId: string | null = null;
  let seed: number | null = null;
  let initialBoard: Board | null = null;

  for (const line of lines) {
    const parsed = JSON.parse(line) as LogRecord;

    if (parsed.type === "session_start") {
      sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : sessionId;
      seed = typeof parsed.seed === "number" ? parsed.seed : seed;
      const startBoard = asBoardCells(parsed.initialBoard);
      if (startBoard != null) initialBoard = boardFrom(startBoard);
      continue;
    }

    if (parsed.turn !== turn) continue;
    const selectedBoard = asBoardCells(parsed.boardBefore) ?? asBoardCells(parsed.board);
    if (selectedBoard == null) {
      throw new Error(`turn ${turn} in ${file} does not contain boardBefore/board`);
    }
    return {
      sessionId,
      seed,
      sourceTurn: turn,
      board: boardFrom(selectedBoard),
    };
  }

  if (turn === 0 && initialBoard != null) {
    return {
      sessionId,
      seed,
      sourceTurn: 0,
      board: initialBoard,
    };
  }

  throw new Error(`turn ${turn} not found in ${file}`);
}

function printStageReport(stage: StageReport): void {
  console.log(
    `${stage.label}: decisions=${stage.decisionCount} searchTimeMs=${fmtMs(stage.searchTimeMs)} reachabilityTimeMs=${fmtMs(stage.reachabilityTimeMs)} expandedNodes=${stage.expandedNodes} generatedNodes=${stage.generatedNodes} enqueuedNodes=${stage.enqueuedNodes} meanPerRootExpanded=${stage.meanPerRootExpandedNodes.toFixed(2)} meanPerRootEnqueued=${stage.meanPerRootEnqueuedNodes.toFixed(2)} meanBestDepth=${stage.meanBestDepthReached.toFixed(2)} peakBestDepth=${stage.bestDepthReachedPeak} cacheHitRate=${pctCount(stage.cacheHitCount, stage.cacheHitCount + stage.cacheMissCount)}`
  );

  if (stage.decisionCount <= 0) return;

  console.log(
    `  frontier: roots=${stage.rootEvaluationCount} spawnChildren=${stage.spawnChildCount} summaries=${stage.summaryCount} meanSpawnChildren=${stage.meanSpawnChildCount.toFixed(2)} frontierPeakSize=${stage.frontierPeakSizePeak} heapPeakSize=${stage.maxFrontierSizePeak} enqueueDuplicateSkipped=${stage.enqueueDuplicateSkipped} enqueueDominatedSkipped=${stage.enqueueDominatedSkipped} popDuplicateSkipped=${stage.popDuplicateSkipped} duplicatePruned=${stage.duplicatePrunedCount} noLegalPruned=${stage.noLegalMovePrunedCount} nodeCapHitCount=${stage.nodeCapHitCount}`
  );

  if (stage.bestDepthReachedPeak >= 3) return;

  console.log(`  shallow-depth diagnostic: maxPathLength=${stage.bestDepthReachedPeak}`);
}

function collectStageReports(counters: MinimalPolicyExperimentDebugCounters): readonly StageReport[] {
  return [
    {
      label: "early",
      decisionCount: counters.earlySearchDecisionCount,
      moveTimeMs: counters.earlySearchMeanMoveTimeMs,
      searchTimeMs: counters.earlySearchMeanSearchTimeMs,
      reachabilityTimeMs: counters.earlySearchMeanReachabilityTimeMs,
      summaryCount: counters.earlySearchSummaryCount,
      spawnChildCount: counters.earlySearchSpawnChildCount,
      meanSpawnChildCount: counters.earlySearchMeanSpawnChildCount,
      rootEvaluationCount: counters.earlySearchRootEvaluationCount,
      expandedNodes: counters.earlySearchExpandedNodeCount,
      meanPerRootExpandedNodes: counters.earlySearchMeanPerRootExpandedNodes,
      generatedNodes: counters.earlySearchGeneratedNodeCount,
      enqueuedNodes: counters.earlySearchEnqueuedNodeCount,
      meanPerRootEnqueuedNodes: counters.earlySearchMeanPerRootEnqueuedNodes,
      enqueueDuplicateSkipped: counters.earlySearchEnqueueDuplicateSkippedCount,
      enqueueDominatedSkipped: counters.earlySearchEnqueueDominatedSkippedCount,
      popDuplicateSkipped: counters.earlySearchPopDuplicateSkippedCount,
      meanBestDepthReached: counters.earlySearchMeanBestDepthReached,
      bestDepthReachedPeak: counters.earlySearchBestDepthReachedPeak,
      cacheHitCount: counters.earlySearchCacheHitCount,
      cacheMissCount: counters.earlySearchCacheMissCount,
      duplicatePrunedCount: counters.earlySearchDuplicatePrunedCount,
      noLegalMovePrunedCount: counters.earlySearchNoLegalMovePrunedCount,
      nodeCapHitCount: counters.earlySearchNodeCapHitCount,
      maxFrontierSizePeak: counters.earlySearchMaxFrontierSizePeak,
      frontierPeakSizePeak: counters.earlySearchFrontierPeakSizePeak,
    },
    {
      label: "critical",
      decisionCount: counters.criticalSearchDecisionCount,
      moveTimeMs: counters.criticalSearchMeanMoveTimeMs,
      searchTimeMs: counters.criticalSearchMeanSearchTimeMs,
      reachabilityTimeMs: counters.criticalSearchMeanReachabilityTimeMs,
      summaryCount: counters.criticalSearchSummaryCount,
      spawnChildCount: counters.criticalSearchSpawnChildCount,
      meanSpawnChildCount: counters.criticalSearchMeanSpawnChildCount,
      rootEvaluationCount: counters.criticalSearchRootEvaluationCount,
      expandedNodes: counters.criticalSearchExpandedNodeCount,
      meanPerRootExpandedNodes: counters.criticalSearchMeanPerRootExpandedNodes,
      generatedNodes: counters.criticalSearchGeneratedNodeCount,
      enqueuedNodes: counters.criticalSearchEnqueuedNodeCount,
      meanPerRootEnqueuedNodes: counters.criticalSearchMeanPerRootEnqueuedNodes,
      enqueueDuplicateSkipped: counters.criticalSearchEnqueueDuplicateSkippedCount,
      enqueueDominatedSkipped: counters.criticalSearchEnqueueDominatedSkippedCount,
      popDuplicateSkipped: counters.criticalSearchPopDuplicateSkippedCount,
      meanBestDepthReached: counters.criticalSearchMeanBestDepthReached,
      bestDepthReachedPeak: counters.criticalSearchBestDepthReachedPeak,
      cacheHitCount: counters.criticalSearchCacheHitCount,
      cacheMissCount: counters.criticalSearchCacheMissCount,
      duplicatePrunedCount: counters.criticalSearchDuplicatePrunedCount,
      noLegalMovePrunedCount: counters.criticalSearchNoLegalMovePrunedCount,
      nodeCapHitCount: counters.criticalSearchNodeCapHitCount,
      maxFrontierSizePeak: counters.criticalSearchMaxFrontierSizePeak,
      frontierPeakSizePeak: counters.criticalSearchFrontierPeakSizePeak,
    },
    {
      label: "post7",
      decisionCount: counters.post7SearchDecisionCount,
      moveTimeMs: counters.post7SearchMeanMoveTimeMs,
      searchTimeMs: counters.post7SearchMeanSearchTimeMs,
      reachabilityTimeMs: counters.post7SearchMeanReachabilityTimeMs,
      summaryCount: counters.post7SearchSummaryCount,
      spawnChildCount: counters.post7SearchSpawnChildCount,
      meanSpawnChildCount: counters.post7SearchMeanSpawnChildCount,
      rootEvaluationCount: counters.post7SearchRootEvaluationCount,
      expandedNodes: counters.post7SearchExpandedNodeCount,
      meanPerRootExpandedNodes: counters.post7SearchMeanPerRootExpandedNodes,
      generatedNodes: counters.post7SearchGeneratedNodeCount,
      enqueuedNodes: counters.post7SearchEnqueuedNodeCount,
      meanPerRootEnqueuedNodes: counters.post7SearchMeanPerRootEnqueuedNodes,
      enqueueDuplicateSkipped: counters.post7SearchEnqueueDuplicateSkippedCount,
      enqueueDominatedSkipped: counters.post7SearchEnqueueDominatedSkippedCount,
      popDuplicateSkipped: counters.post7SearchPopDuplicateSkippedCount,
      meanBestDepthReached: counters.post7SearchMeanBestDepthReached,
      bestDepthReachedPeak: counters.post7SearchBestDepthReachedPeak,
      cacheHitCount: counters.post7SearchCacheHitCount,
      cacheMissCount: counters.post7SearchCacheMissCount,
      duplicatePrunedCount: counters.post7SearchDuplicatePrunedCount,
      noLegalMovePrunedCount: counters.post7SearchNoLegalMovePrunedCount,
      nodeCapHitCount: counters.post7SearchNodeCapHitCount,
      maxFrontierSizePeak: counters.post7SearchMaxFrontierSizePeak,
      frontierPeakSizePeak: counters.post7SearchFrontierPeakSizePeak,
    },
  ] as const;
}

function writeJsonl(fd: number, record: object): void {
  fs.writeSync(fd, `${JSON.stringify(record)}\n`);
}

function main(): void {
  if (process.env.CLOSURE_AB_ORACLE_SEARCH !== "1") {
    throw new Error("oracle replay requires CLOSURE_AB_ORACLE_SEARCH=1");
  }

  const options = parseArgs(process.argv.slice(2));
  const source = loadReplaySource(options.file, options.turn);
  const policy = createEarlyPost7LiftMinimalPolicy();
  const rng = createRng(options.seed);

  resetMinimalPolicyExperimentDebugCounters();

  const startedAt = new Date();
  const startedPerf = performance.now();
  const stamp = makeStamp(startedAt);
  const replayId = `oracle-replay-${stamp}-${options.seed}`;
  const outPath = path.resolve(`out/${replayId}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const fd = fs.openSync(outPath, "w");

  let board = source.board;
  let stepsReplayed = 0;
  let result: ReplayResult = "max_steps";
  let reachedFirst7 = maxTileLevel(board) >= 7;
  let reachedSecondMax6 = secondMaxTile(board) >= 6;
  let reachedSecondMax7 = secondMaxTile(board) >= 7;

  try {
    const startRecord: ReplayStartRecord = {
      type: "oracle_replay_start",
      replayId,
      startedAt: startedAt.toISOString(),
      sourceFile: options.file,
      sourceTurn: source.sourceTurn,
      sourceSessionId: source.sessionId,
      sourceSeed: source.seed,
      replaySeed: options.seed,
      oracleSearch: true,
      stepsRequested: options.steps,
      board: boardCells(board),
    };
    writeJsonl(fd, startRecord);

    while (stepsReplayed < options.steps) {
      const actions = legalActions(board);
      if (actions.length === 0) {
        result = "lose";
        break;
      }

      const move = policy(board, actions);
      const maxTileBefore = maxTileLevel(board);
      const secondMaxBefore = secondMaxTile(board);
      const { next, moved, win } = slide(board, move);
      const spawned = win || !moved ? null : spawnRandomDetailed(next, rng);
      const boardAfterSpawn = spawned?.board ?? null;
      const finalBoard = boardAfterSpawn ?? next;
      const lose = !win && moved && legalActions(finalBoard).length === 0;

      const turnRecord: ReplayTurnRecord = {
        type: "oracle_replay_turn",
        replayId,
        sourceTurn: source.sourceTurn,
        turn: source.sourceTurn + stepsReplayed,
        replayStep: stepsReplayed + 1,
        boardBefore: boardCells(board),
        move,
        moved,
        boardAfterSlide: boardCells(next),
        boardAfterSpawn: boardAfterSpawn == null ? null : boardCells(boardAfterSpawn),
        spawn: spawned?.spawn ?? null,
        finalBoard: boardCells(finalBoard),
        legalActions: actions,
        legalMoveCount: actions.length,
        emptyCount: emptyCount(board),
        maxTileBefore,
        secondMaxBefore,
        maxTileAfter: maxTileLevel(finalBoard),
        secondMaxAfter: secondMaxTile(finalBoard),
        win,
        lose,
      };
      writeJsonl(fd, turnRecord);

      stepsReplayed++;
      reachedFirst7 ||= maxTileLevel(finalBoard) >= 7;
      reachedSecondMax6 ||= secondMaxTile(finalBoard) >= 6;
      reachedSecondMax7 ||= secondMaxTile(finalBoard) >= 7;

      if (win) {
        result = "win";
        board = next;
        break;
      }

      if (!moved) {
        result = "policy_illegal_move";
        board = next;
        break;
      }

      board = finalBoard;
      if (lose) {
        result = "lose";
        break;
      }
    }

    const counters = snapshotMinimalPolicyExperimentDebugCounters();
    const runtimeMs = performance.now() - startedPerf;
    const endRecord: ReplayEndRecord = {
      type: "oracle_replay_end",
      replayId,
      finishedAt: new Date().toISOString(),
      result,
      stepsReplayed,
      reachedFirst7,
      reachedSecondMax6,
      reachedSecondMax7,
      finalBoard: boardCells(board),
      finalMaxTile: maxTileLevel(board),
      finalSecondMax: secondMaxTile(board),
      runtimeMs,
      counters,
    };
    writeJsonl(fd, endRecord);
    fs.closeSync(fd);

    const startMaxTile = maxTileLevel(source.board);
    const startSecondMax = secondMaxTile(source.board);
    const startMaxTileCount = countTilesEqual(source.board, startMaxTile);

    console.log(`source: ${options.file}`);
    console.log(`out: ${outPath}`);
    console.log(`start turn: ${source.sourceTurn}`);
    console.log(`seed: ${options.seed}`);
    console.log(`start maxTile: ${startMaxTile}`);
    console.log(`start secondMax: ${startSecondMax}`);
    console.log(`start maxTileCount: ${startMaxTileCount}`);
    console.log(`steps replayed: ${stepsReplayed}/${options.steps}`);
    console.log(`result: ${result}`);
    console.log(`reachedFirst7: ${reachedFirst7 ? "yes" : "no"}`);
    console.log(`reachedSecondMax6: ${reachedSecondMax6 ? "yes" : "no"}`);
    console.log(`reachedSecondMax7: ${reachedSecondMax7 ? "yes" : "no"}`);
    console.log(`final maxTile: ${maxTileLevel(board)}`);
    console.log(`final secondMax: ${secondMaxTile(board)}`);
    console.log(`runtimeMs: ${fmtMs(runtimeMs)}`);
    console.log("start board:");
    console.log(fmtBoard(source.board));
    console.log("final board:");
    console.log(fmtBoard(board));

    console.log("per-stage search stats:");
    for (const stage of collectStageReports(counters)) {
      printStageReport(stage);
    }
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

main();

import * as fs from "node:fs";
import * as path from "node:path";
import { emptyCount, maxTileLevel } from "../src/sim/board.ts";
import { secondMaxTile } from "../src/sim/boardStats.ts";
import { detectCornerWithMax } from "../src/sim/closureMode.ts";
import { countViableMoves } from "../src/sim/closureSearch.ts";
import {
  analyzeStateRootMoves,
  summarizeActualContinuation,
  type DebugLine,
  type DivergenceSearchConfig,
  type RootMoveDebugSummary,
} from "../src/sim/debugDivergence.ts";
import { legalActions } from "../src/sim/legal.ts";
import { boardFrom } from "../src/sim/simulate.ts";
import type { Board, Direction } from "../src/sim/types.ts";

type ManualSessionStartRecord = {
  type: "session_start";
  sessionId: string;
  startedAt: string;
  seed: number;
  logPath: string;
};

type ManualTurnRecord = {
  type: "turn";
  sessionId: string;
  turn: number;
  boardBefore: readonly number[];
  move: Direction;
  moved: boolean;
  boardAfterSlide: readonly number[];
  boardAfterSpawn: readonly number[] | null;
  maxTile: number;
  secondMaxTile: number;
  legalActions: readonly Direction[];
  win: boolean;
  lose: boolean;
};

type ManualSessionEndRecord = {
  type: "session_end";
  sessionId: string;
  finishedAt: string;
  result: string;
  turns: number;
  finalBoard: readonly number[];
  finalMaxTile: number;
  finalSecondMaxTile: number;
};

type ManualLog = {
  start: ManualSessionStartRecord | null;
  turns: ManualTurnRecord[];
  end: ManualSessionEndRecord | null;
};

type CliOptions = {
  file: string;
  turn: number;
  beamWidth: number;
  horizon: number;
  plateauWindow: number;
};

const DEFAULT_BEAM_WIDTH = 3;
const DEFAULT_HORIZON = 15;
const DEFAULT_PLATEAU_WINDOW = 4;

function usage(): never {
  console.error(
    "usage: npx tsx tools/debug-divergence.ts --file <manual-play.jsonl> --turn <n> [--beam <n>] [--horizon <n>] [--plateau-window <n>]"
  );
  process.exit(1);
}

function parseArgs(argv: readonly string[]): CliOptions {
  let file: string | null = null;
  let turn: number | null = null;
  let beamWidth = DEFAULT_BEAM_WIDTH;
  let horizon = DEFAULT_HORIZON;
  let plateauWindow = DEFAULT_PLATEAU_WINDOW;

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
    if (arg === "--beam") {
      beamWidth = Number(next);
      i++;
      continue;
    }
    if (arg === "--horizon") {
      horizon = Number(next);
      i++;
      continue;
    }
    if (arg === "--plateau-window") {
      plateauWindow = Number(next);
      i++;
      continue;
    }
    usage();
  }

  if (file == null || !Number.isFinite(turn ?? NaN)) usage();
  if (!Number.isFinite(beamWidth) || beamWidth < 1) usage();
  if (!Number.isFinite(horizon) || horizon < 1) usage();
  if (!Number.isFinite(plateauWindow) || plateauWindow < 1) usage();

  return {
    file: path.resolve(file),
    turn: Math.floor(turn!),
    beamWidth: Math.floor(beamWidth),
    horizon: Math.floor(horizon),
    plateauWindow: Math.floor(plateauWindow),
  };
}

function loadManualLog(file: string): ManualLog {
  const text = fs.readFileSync(file, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let start: ManualSessionStartRecord | null = null;
  let end: ManualSessionEndRecord | null = null;
  const turns: ManualTurnRecord[] = [];

  for (const line of lines) {
    const parsed = JSON.parse(line) as { type?: string };
    if (parsed.type === "session_start") {
      start = parsed as ManualSessionStartRecord;
      continue;
    }
    if (parsed.type === "turn") {
      turns.push(parsed as ManualTurnRecord);
      continue;
    }
    if (parsed.type === "session_end") {
      end = parsed as ManualSessionEndRecord;
    }
  }

  if (turns.length === 0) {
    throw new Error(`unsupported log format: no manual-play turn records found in ${file}`);
  }

  return { start, turns, end };
}

function fmtBoard(board: Board): string {
  const labels = board.map((v) => (v === 0 ? "." : String(v)));
  const width = Math.max(1, ...labels.map((v) => v.length));
  const rows: string[] = [];

  for (let r = 0; r < 3; r++) {
    const row = labels.slice(r * 3, r * 3 + 3).map((v) => v.padStart(width, " "));
    rows.push(` ${row.join(" | ")} `);
  }

  const separator = rows[0]!.replace(/[^\|]/g, "-");
  return [rows[0]!, separator, rows[1]!, separator, rows[2]!].join("\n");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtMaybe(value: number | null): string {
  return value == null ? "-" : String(value);
}

function arrayProgress(values: readonly number[]): string {
  return values.join(" -> ");
}

function actualContinuationBoards(turns: readonly ManualTurnRecord[], selectedTurn: number, horizon: number): Board[] {
  return turns
    .filter((record) => record.turn >= selectedTurn && record.turn < selectedTurn + horizon)
    .map((record) => boardFrom(record.boardAfterSpawn ?? record.boardAfterSlide));
}

function actualContinuationMoves(turns: readonly ManualTurnRecord[], selectedTurn: number, horizon: number): Direction[] {
  return turns
    .filter((record) => record.turn >= selectedTurn && record.turn < selectedTurn + horizon)
    .map((record) => record.move);
}

function strongestAlternative(
  summaries: readonly RootMoveDebugSummary[],
  actualMove: Direction
): RootMoveDebugSummary | null {
  const alternatives = summaries.filter((summary) => summary.move !== actualMove && summary.reachableSecondMax6);
  return alternatives[0] ?? null;
}

function findSummaryByMove(
  summaries: readonly RootMoveDebugSummary[],
  move: Direction
): RootMoveDebugSummary | null {
  return summaries.find((summary) => summary.move === move) ?? null;
}

function printExampleLine(label: string, line: DebugLine | undefined): void {
  if (line == null) {
    console.log(`${label}: none`);
    return;
  }

  console.log(`${label}:`);
  console.log(`  moves after root spawn: ${line.moves.join(" -> ") || "(none)"}`);
  console.log(`  secondMaxByDepth: ${arrayProgress(line.secondMaxByDepth)}`);
  console.log(`  viableByDepth: ${arrayProgress(line.viableCountByDepth)}`);
  console.log(
    `  summary: bestSecond=${line.summary.bestSecondMax} finalSecond=${line.summary.finalSecondMax} reached6=${line.summary.reached6 ? "yes" : "no"} deathDepth=${fmtMaybe(line.summary.deathDepth)} plateauByEnd=${line.summary.plateauByEnd ? "yes" : "no"}`
  );
  console.log("  spawn child board:");
  console.log(fmtBoard(line.spawnStartBoard));
  console.log("  line final board:");
  console.log(fmtBoard(line.boards[line.boards.length - 1] ?? line.spawnStartBoard));
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const log = loadManualLog(options.file);
  const selected = log.turns.find((record) => record.turn === options.turn);
  if (selected == null) {
    throw new Error(`turn ${options.turn} not found in ${options.file}`);
  }

  const selectedBoard = boardFrom(selected.boardBefore);
  const config: DivergenceSearchConfig = {
    beamWidth: options.beamWidth,
    horizon: options.horizon,
    plateauWindow: options.plateauWindow,
  };

  const startedAt = Date.now();
  const analysis = analyzeStateRootMoves(selectedBoard, config);
  const elapsedMs = Date.now() - startedAt;

  const actualBoards = actualContinuationBoards(log.turns, selected.turn, options.horizon);
  const actualMoves = actualContinuationMoves(log.turns, selected.turn, options.horizon);
  const actual = summarizeActualContinuation(selectedBoard, selected.move, actualBoards, config);

  const actualRootSummary = findSummaryByMove(analysis.rootSummaries, selected.move);
  const bestAlternative = strongestAlternative(analysis.rootSummaries, selected.move);
  const anyReach6 = analysis.rootSummaries.some((summary) => summary.reachableSecondMax6);
  const strongRootDivergence =
    !actual.reached6 &&
    bestAlternative != null &&
    (actualRootSummary == null || !actualRootSummary.reachableSecondMax6);

  const selectedAnchor = detectCornerWithMax(selectedBoard);
  const selectedViable = countViableMoves(selectedBoard, selectedAnchor);

  console.log("Debug Divergence Report");
  console.log(`file: ${options.file}`);
  console.log(
    `session: ${log.start?.sessionId ?? "-"} | seed=${log.start?.seed ?? "-"} | selected turn=${selected.turn} | beam=${options.beamWidth} | horizon=${options.horizon}`
  );
  console.log(`runtime: ${elapsedMs} ms`);
  console.log("");

  console.log("Episode Summary");
  console.log(
    `turns recorded: ${log.turns.length} | final second=${log.end?.finalSecondMaxTile ?? log.turns[log.turns.length - 1]?.secondMaxTile ?? "-"} | final max=${log.end?.finalMaxTile ?? log.turns[log.turns.length - 1]?.maxTile ?? "-"} | result=${log.end?.result ?? "incomplete"}`
  );
  console.log("");

  console.log("Selected State");
  console.log(
    `turn=${selected.turn} | actual move=${selected.move} | legal=${analysis.legalMoves.join(", ")} | max=${maxTileLevel(selectedBoard)} | second=${secondMaxTile(selectedBoard)} | empty=${emptyCount(selectedBoard)} | viable=${selectedViable}`
  );
  console.log(fmtBoard(selectedBoard));
  console.log("");

  console.log("Actual Continuation");
  console.log(`moves: ${actualMoves.join(" -> ") || "(none)"}`);
  console.log(`secondMaxByDepth: ${arrayProgress(actual.secondMaxByDepth)}`);
  console.log(`viableByDepth: ${arrayProgress(actual.viableCountByDepth)}`);
  console.log(
    `reached6=${actual.reached6 ? "yes" : "no"} | reached7=${actual.reached7 ? "yes" : "no"} | bestSecond=${actual.bestSecondMax} | finalSecond=${actual.finalSecondMax} | deathDepth=${fmtMaybe(actual.deathDepth)} | plateauByEnd=${actual.plateauByEnd ? "yes" : "no"} | plateauEntryDepth=${fmtMaybe(actual.plateauEntryDepth)}`
  );
  console.log("");

  console.log("Root Move Comparison");
  console.log("move  actual  spawns  reach6  reach7  best2nd  bestFinal  early6  dead%   plateau%");
  for (const summary of analysis.rootSummaries) {
    const actualMarker = summary.move === selected.move ? "*" : " ";
    const paddedMove = summary.move.padEnd(5, " ");
    const paddedActual = actualMarker.padEnd(6, " ");
    const spawns = String(summary.exploredSpawnCount).padStart(6, " ");
    const reach6 = (summary.reachableSecondMax6 ? "yes" : "no").padStart(6, " ");
    const reach7 = (summary.reachableSecondMax7 ? "yes" : "no").padStart(6, " ");
    const best2nd = String(summary.bestReachableSecondMax).padStart(8, " ");
    const bestFinal = String(summary.bestFinalSecondMax).padStart(9, " ");
    const early6 = fmtMaybe(summary.earliestReach6Depth).padStart(6, " ");
    const dead = pct(summary.deadLineShare).padStart(7, " ");
    const plateau = pct(summary.plateauLineShare).padStart(9, " ");
    console.log(`${paddedMove}${paddedActual}${spawns}${reach6}${reach7}${best2nd}${bestFinal}${early6}${dead}${plateau}`);
  }
  console.log("");

  console.log("Reachability");
  console.log(`secondMax>=6 reachable within horizon: ${anyReach6 ? "yes" : "no"}`);
  if (anyReach6) {
    const reachMoves = analysis.rootSummaries
      .filter((summary) => summary.reachableSecondMax6)
      .map((summary) => `${summary.move}@${fmtMaybe(summary.earliestReach6Depth)}`)
      .join(", ");
    console.log(`root moves with beam-supported reach6: ${reachMoves}`);
  }
  console.log("");

  printExampleLine("Best alternative line", bestAlternative?.bestExampleLine);
  console.log("");

  console.log("Interpretation");
  if (strongRootDivergence && bestAlternative != null) {
    console.log(
      `Turn ${selected.turn} is a strong divergence candidate: actual move ${selected.move} did not have a beam-supported path to second>=6 within depth ${options.horizon}, while ${bestAlternative.move} did by depth ${fmtMaybe(bestAlternative.earliestReach6Depth)}.`
    );
  } else if (!actual.reached6 && bestAlternative != null && actualRootSummary?.reachableSecondMax6) {
    console.log(
      `Turn ${selected.turn} is a weaker divergence candidate: actual continuation failed to reach second>=6, and alternative move ${bestAlternative.move} also had a beam-supported route, but the chosen move ${selected.move} still retained some reachable-6 lines. Divergence may be later or spawn-dependent.`
    );
  } else if (!actual.reached6 && !anyReach6) {
    console.log(
      `Turn ${selected.turn} is not a root-move divergence candidate under this debug search: no legal root move produced a beam-supported path to second>=6 within depth ${options.horizon}.`
    );
  } else {
    console.log(
      `Turn ${selected.turn} does not show a clear failed-episode divergence under this debug search. The selected state and alternatives should be treated as diagnostic evidence, not proof of optimal play.`
    );
  }
}

main();

import * as fs from "node:fs";
import * as path from "node:path";
import type { Board, Direction } from "../src/sim/types.ts";
import { emptyCount, maxTileLevel } from "../src/sim/board.ts";
import { secondMaxTile } from "../src/sim/boardStats.ts";
import { detectCornerWithMax } from "../src/sim/closureMode.ts";
import { countViableMoves } from "../src/sim/closureSearch.ts";
import { legalActions } from "../src/sim/legal.ts";
import {
  createEarlyPost7LiftMinimalPolicy,
  createInitialBoardMinimal,
  scoreBoardMinimal,
} from "../src/sim/minimalSurvival.ts";
import { createRng } from "../src/sim/rng.ts";
import { slide } from "../src/sim/slide.ts";
import { spawnRandomDetailed, type SpawnPlacement } from "../src/sim/spawn.ts";
import { createsHighLevelMerge } from "../src/sim/topEndPairability.ts";

type SessionResult = "win" | "lose" | "policy_illegal_move" | "max_steps";

type SessionStartRecord = {
  type: "session_start";
  sessionId: string;
  startedAt: string;
  seed: number;
  policy: string;
  logPath: string;
  latestLogPath: string;
  initialBoard: readonly number[];
  initialBoardMatrix: readonly (readonly number[])[];
};

type TurnRecord = {
  type: "turn";
  sessionId: string;
  policy: string;
  turn: number;
  boardBefore: readonly number[];
  boardBeforeMatrix: readonly (readonly number[])[];
  move: Direction;
  moved: boolean;
  boardAfterSlide: readonly number[];
  boardAfterSlideMatrix: readonly (readonly number[])[];
  spawn: SpawnPlacement | null;
  boardAfterSpawn: readonly number[] | null;
  boardAfterSpawnMatrix: readonly (readonly number[])[] | null;
  maxTile: number;
  secondMaxTile: number;
  legalActions: readonly Direction[];
  legalMoveCount: number;
  viableMoveCount: number;
  emptyCount: number;
  scoreLikeValue: number;
  createsHighLevelMerge: boolean;
  win: boolean;
  lose: boolean;
};

type SessionEndRecord = {
  type: "session_end";
  sessionId: string;
  policy: string;
  finishedAt: string;
  result: SessionResult;
  steps: number;
  finalBoard: readonly number[];
  finalBoardMatrix: readonly (readonly number[])[];
  finalMaxTile: number;
  finalSecondMaxTile: number;
  peakMaxTile: number;
  peakSecondMaxTile: number;
  firstPost7Turn: number | null;
  post7SurvivalTurns: number;
  reachedSecondMax6: boolean;
  reachedSecondMax7: boolean;
  deathTurn: number | null;
  researchGrade: boolean;
};

const POLICY_NAME = "createEarlyPost7LiftMinimalPolicy";
const MAX_STEPS = 500_000;
const RESEARCH_GRADE_MIN_PEAK_MAX = 7;
const RESEARCH_GRADE_MIN_PEAK_SECOND = 5;
const RESEARCH_GRADE_MIN_POST7_SURVIVAL_TURNS = 8;

function boardCells(board: Board): readonly number[] {
  return Array.from(board) as readonly number[];
}

function boardMatrix(board: Board): readonly (readonly number[])[] {
  return [board.slice(0, 3), board.slice(3, 6), board.slice(6, 9)] as const;
}

function writeJsonl(fd: number, record: object): void {
  fs.writeSync(fd, `${JSON.stringify(record)}\n`);
}

function makeSessionStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
}

function main(): void {
  const startedAt = new Date();
  const seedRaw = Number(process.env.POLICY_PLAY_SEED ?? Date.now());
  const seed = Number.isFinite(seedRaw) ? Math.floor(seedRaw) : Date.now();
  const rng = createRng(seed);
  const stamp = makeSessionStamp(startedAt);
  const sessionId = `policy-play-${stamp}-${seed}`;
  const sessionPath = path.resolve(`out/policy-play-${stamp}.jsonl`);
  const sessionTempPath = `${sessionPath}.tmp`;
  const latestPath = path.resolve("out/policy-play-latest.jsonl");
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });

  const sessionFd = fs.openSync(sessionTempPath, "w");
  const policy = createEarlyPost7LiftMinimalPolicy();

  let board = createInitialBoardMinimal(rng);
  let steps = 0;
  let turn = 1;
  let peakMaxTile = maxTileLevel(board);
  let peakSecondMaxTile = secondMaxTile(board);
  let firstPost7Turn: number | null = maxTileLevel(board) >= 7 ? 1 : null;
  let post7SurvivalTurns = 0;
  let reachedSecondMax6 = secondMaxTile(board) >= 6;
  let reachedSecondMax7 = secondMaxTile(board) >= 7;
  let result: SessionResult = "lose";
  let deathTurn: number | null = null;

  try {
    const startRecord: SessionStartRecord = {
      type: "session_start",
      sessionId,
      startedAt: startedAt.toISOString(),
      seed,
      policy: POLICY_NAME,
      logPath: sessionPath,
      latestLogPath: latestPath,
      initialBoard: boardCells(board),
      initialBoardMatrix: boardMatrix(board),
    };
    writeJsonl(sessionFd, startRecord);

    while (steps < MAX_STEPS) {
      const actions = legalActions(board);
      if (actions.length === 0) {
        result = "lose";
        deathTurn = turn;
        break;
      }

      const boardBeforeMax = maxTileLevel(board);
      if (boardBeforeMax >= 7) {
        if (firstPost7Turn === null) firstPost7Turn = turn;
        post7SurvivalTurns++;
      }

      const anchor = detectCornerWithMax(board);
      const viableMoveCount = countViableMoves(board, anchor);
      const move = policy(board, actions);
      const { next, moved, win } = slide(board, move);
      const spawned = win || !moved ? null : spawnRandomDetailed(next, rng);
      const boardAfterSpawn = spawned?.board ?? null;
      const finalBoardThisTurn = boardAfterSpawn ?? next;
      const lose = !win && moved && legalActions(finalBoardThisTurn).length === 0;

      const turnRecord: TurnRecord = {
        type: "turn",
        sessionId,
        policy: POLICY_NAME,
        turn,
        boardBefore: boardCells(board),
        boardBeforeMatrix: boardMatrix(board),
        move,
        moved,
        boardAfterSlide: boardCells(next),
        boardAfterSlideMatrix: boardMatrix(next),
        spawn: spawned?.spawn ?? null,
        boardAfterSpawn: boardAfterSpawn == null ? null : boardCells(boardAfterSpawn),
        boardAfterSpawnMatrix: boardAfterSpawn == null ? null : boardMatrix(boardAfterSpawn),
        maxTile: maxTileLevel(board),
        secondMaxTile: secondMaxTile(board),
        legalActions: actions,
        legalMoveCount: actions.length,
        viableMoveCount,
        emptyCount: emptyCount(board),
        scoreLikeValue: scoreBoardMinimal(board),
        createsHighLevelMerge: createsHighLevelMerge(board, next),
        win,
        lose,
      };
      writeJsonl(sessionFd, turnRecord);

      steps++;

      const endOfTurnMax = maxTileLevel(finalBoardThisTurn);
      const endOfTurnSecond = secondMaxTile(finalBoardThisTurn);
      peakMaxTile = Math.max(peakMaxTile, endOfTurnMax);
      peakSecondMaxTile = Math.max(peakSecondMaxTile, endOfTurnSecond);
      reachedSecondMax6 ||= endOfTurnSecond >= 6;
      reachedSecondMax7 ||= endOfTurnSecond >= 7;

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

      board = finalBoardThisTurn;
      turn++;
    }

    if (steps >= MAX_STEPS && result !== "win" && result !== "policy_illegal_move") {
      result = "max_steps";
    }

    const researchGrade =
      peakMaxTile >= RESEARCH_GRADE_MIN_PEAK_MAX &&
      peakSecondMaxTile >= RESEARCH_GRADE_MIN_PEAK_SECOND &&
      post7SurvivalTurns >= RESEARCH_GRADE_MIN_POST7_SURVIVAL_TURNS;

    const endRecord: SessionEndRecord = {
      type: "session_end",
      sessionId,
      policy: POLICY_NAME,
      finishedAt: new Date().toISOString(),
      result,
      steps,
      finalBoard: boardCells(board),
      finalBoardMatrix: boardMatrix(board),
      finalMaxTile: maxTileLevel(board),
      finalSecondMaxTile: secondMaxTile(board),
      peakMaxTile,
      peakSecondMaxTile,
      firstPost7Turn,
      post7SurvivalTurns,
      reachedSecondMax6,
      reachedSecondMax7,
      deathTurn,
      researchGrade,
    };
    writeJsonl(sessionFd, endRecord);

    fs.closeSync(sessionFd);

    if (researchGrade) {
      fs.renameSync(sessionTempPath, sessionPath);
      fs.copyFileSync(sessionPath, latestPath);
    } else {
      fs.rmSync(sessionTempPath, { force: true });
    }

    console.log(researchGrade ? "Episode complete." : "Episode discarded (non-research-grade).");
    if (researchGrade) {
      console.log(`Output: ${sessionPath}`);
    }
    console.log(`Steps: ${steps}`);
    console.log(`Final maxTile: ${endRecord.finalMaxTile}`);
    console.log(`Final secondMax: ${endRecord.finalSecondMaxTile}`);
    console.log(`Peak maxTile: ${endRecord.peakMaxTile}`);
    console.log(`Peak secondMax: ${endRecord.peakSecondMaxTile}`);
    console.log(`Post7 survival turns: ${endRecord.post7SurvivalTurns}`);
    console.log(`Reached secondMax>=6: ${endRecord.reachedSecondMax6}`);
    console.log(`Reached secondMax>=7: ${endRecord.reachedSecondMax7}`);
    console.log(`Result: ${result}`);
    console.log(`Seed: ${seed}`);
  } finally {
    try {
      fs.closeSync(sessionFd);
    } catch {}
    fs.rmSync(sessionTempPath, { force: true });
  }
}

main();

/**
 * 최소 생존 목표: legal / empty / 인접 동일쌍 / 1스폰 생존 분기 수만 사용.
 * scoreBoardV3·expectimax와 독립.
 */
import type { Board, Direction, TerminalReason } from "./types";
import { LEN, emptyCount } from "./board";
import { legalActions } from "./legal";
import { slide } from "./slide";
import { spawnAll, spawnRandom } from "./spawn";
import { hlConversionBonus } from "./topEndPairability";

const DIR_ORDER: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];

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

/** greedy: slide 직후 보드에 대해 scoreBoardMinimal 최대인 방향. 승리 수는 즉시 선택. */
export function minimalPolicy(board: Board, actions: Direction[]): Direction {
  let bestScore = Number.NEGATIVE_INFINITY;
  const tied: Direction[] = [];
  for (const d of actions) {
    const { next, win, moved } = slide(board, d);
    if (win) return d;
    if (!moved) continue;
    const s = scoreBoardMinimal(next) + hlConversionBonus(board, next);
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

import {
  createRng,
  emptyCount,
  legalActions,
  maxTileLevel,
  score_toplevel_move,
  slide,
  type Board,
  type Direction,
} from "../src/sim/index.ts";
import { countTilesAtLeast, countTilesEqual, secondMaxTile } from "../src/sim/boardStats.ts";
import { spawnRandomDetailed } from "../src/sim/spawn.ts";

const FAILED_SEEDS = (process.env.D8_TRIGGER_SEEDS ?? "20260429,20260436,20260440,20260441,20260446")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const MAX_STEPS = Math.max(1, Math.floor(Number(process.env.D8_TRIGGER_MAX_STEPS ?? "5000")));
const BRANCH_STEPS = Math.max(1, Math.floor(Number(process.env.D8_TRIGGER_BRANCH_STEPS ?? "5000")));

const MOVE_ORDER: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];
const EMPTY: Board = Object.freeze(new Array(9).fill(0)) as Board;

type MilestoneName =
  | "firstMax6"
  | "firstMax7"
  | "firstMax8"
  | "firstSecond5"
  | "firstSecond6"
  | "firstTwoGe6"
  | "first76"
  | "first77"
  | "first86"
  | "first87";

type TriggerName = "current" | "max7" | "second6" | "ge6x2" | "max7OrEmpty3" | "max7OrSecond6";

type RootScore = {
  move: Direction;
  legal: boolean;
  d6: number;
  d8: number;
};

type Milestone = {
  name: MilestoneName;
  turn: number;
  board: Board;
  scores: RootScore[];
  d6Move: Direction;
  d8Move: Direction;
  disagree: boolean;
  d6Replay: ReplayResult | null;
  d8Replay: ReplayResult | null;
};

type ReplayResult = {
  steps: number;
  terminal: "fusion" | "no_legal_moves" | "policy_illegal_move" | "max_steps";
  reachedFusion: boolean;
  finalMax: number;
  finalSecond: number;
};

type Trace = {
  seed: number;
  terminal: "fusion" | "no_legal_moves" | "policy_illegal_move" | "max_steps";
  steps: number;
  fusionTurn: number | null;
  rngValues: number[];
  milestones: Map<MilestoneName, { turn: number; board: Board; rngOffset: number }>;
};

type BenchResult = {
  trigger: TriggerName;
  episodes: number;
  fusionCount: number;
  noFirstFusion: number;
  avgTurns: number;
  avgDecisionMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  depth8Usage: number;
};

function boardLine(board: Board): string {
  return `${board.slice(0, 3).join(" ")} / ${board.slice(3, 6).join(" ")} / ${board.slice(6, 9).join(" ")}`;
}

function initialBoard(rng: () => number, rngValues?: number[]): Board {
  let board = EMPTY;
  board = spawnWithRecording(board, rng, rngValues);
  board = spawnWithRecording(board, rng, rngValues);
  return board;
}

function spawnWithRecording(board: Board, rng: () => number, rngValues?: number[]): Board {
  const result = spawnRandomDetailed(board, () => {
    const v = rng();
    rngValues?.push(v);
    return v;
  });
  return result.board;
}

function spawnWithValue(board: Board, rngValue: number): Board {
  return spawnRandomDetailed(board, () => rngValue).board;
}

function relation(board: Board, hi: number, lo: number): boolean {
  return countTilesEqual(board, hi) >= 1 && countTilesEqual(board, lo) >= 1;
}

function milestoneSatisfied(name: MilestoneName, board: Board): boolean {
  switch (name) {
    case "firstMax6":
      return maxTileLevel(board) >= 6;
    case "firstMax7":
      return maxTileLevel(board) >= 7;
    case "firstMax8":
      return maxTileLevel(board) >= 8;
    case "firstSecond5":
      return secondMaxTile(board) >= 5;
    case "firstSecond6":
      return secondMaxTile(board) >= 6;
    case "firstTwoGe6":
      return countTilesAtLeast(board, 6) >= 2;
    case "first76":
      return relation(board, 7, 6);
    case "first77":
      return countTilesEqual(board, 7) >= 2;
    case "first86":
      return relation(board, 8, 6);
    case "first87":
      return relation(board, 8, 7);
  }
}

function triggerUsesDepth8(trigger: TriggerName, board: Board): boolean {
  const max = maxTileLevel(board);
  const second = secondMaxTile(board);
  switch (trigger) {
    case "current":
      return max >= 8;
    case "max7":
      return max >= 7;
    case "second6":
      return second >= 6;
    case "ge6x2":
      return countTilesAtLeast(board, 6) >= 2;
    case "max7OrEmpty3":
      return max >= 7 || emptyCount(board) <= 3;
    case "max7OrSecond6":
      return max >= 7 || second >= 6;
  }
}

function scoreRoot(board: Board): RootScore[] {
  const legal = new Set(legalActions(board));
  return MOVE_ORDER.map((move, i) => ({
    move,
    legal: legal.has(move),
    d6: score_toplevel_move(board, i, { depthLimit: 6 }),
    d8: score_toplevel_move(board, i, { depthLimit: 8 }),
  }));
}

function choose(scores: readonly RootScore[], depth: 6 | 8): Direction {
  let best = 0;
  let bestMove: Direction = "UP";
  for (const s of scores) {
    const value = depth === 6 ? s.d6 : s.d8;
    if (value > best) {
      best = value;
      bestMove = s.move;
    }
  }
  return bestMove;
}

function chooseAtDepth(board: Board, depth: 6 | 8): Direction {
  let best = 0;
  let bestMove: Direction = "UP";
  for (let i = 0; i < MOVE_ORDER.length; i++) {
    const value = score_toplevel_move(board, i, { depthLimit: depth });
    if (value > best) {
      best = value;
      bestMove = MOVE_ORDER[i]!;
    }
  }
  return bestMove;
}

function traceCurrent(seed: number): Trace {
  const rngValues: number[] = [];
  const rng = createRng(seed);
  let board = initialBoard(rng, rngValues);
  const milestones = new Map<MilestoneName, { turn: number; board: Board; rngOffset: number }>();
  const names: MilestoneName[] = [
    "firstMax6",
    "firstMax7",
    "firstMax8",
    "firstSecond5",
    "firstSecond6",
    "firstTwoGe6",
    "first76",
    "first77",
    "first86",
    "first87",
  ];

  for (let turn = 0; turn < MAX_STEPS; turn++) {
    for (const name of names) {
      if (!milestones.has(name) && milestoneSatisfied(name, board)) {
        milestones.set(name, { turn, board, rngOffset: rngValues.length });
      }
    }

    const actions = legalActions(board);
    if (actions.length === 0) {
      return { seed, terminal: "no_legal_moves", steps: turn, fusionTurn: null, rngValues, milestones };
    }

    const depth = maxTileLevel(board) >= 8 ? 8 : 6;
    const move = chooseAtDepth(board, depth);
    if (!actions.includes(move)) {
      return { seed, terminal: "policy_illegal_move", steps: turn, fusionTurn: null, rngValues, milestones };
    }
    const result = slide(board, move);
    if (!result.moved) {
      return { seed, terminal: "policy_illegal_move", steps: turn + 1, fusionTurn: null, rngValues, milestones };
    }
    board = spawnWithRecording(result.next, rng, rngValues);
    if (result.win) {
      return { seed, terminal: "fusion", steps: turn + 1, fusionTurn: turn + 1, rngValues, milestones };
    }
  }
  return { seed, terminal: "max_steps", steps: MAX_STEPS, fusionTurn: null, rngValues, milestones };
}

function replayForcedFirst(
  board: Board,
  firstMove: Direction,
  rngValues: readonly number[],
  rngOffset: number
): ReplayResult {
  let cur = board;
  let offset = rngOffset;
  for (let stepIndex = 0; stepIndex < BRANCH_STEPS; stepIndex++) {
    const actions = legalActions(cur);
    if (actions.length === 0) {
      return {
        steps: stepIndex,
        terminal: "no_legal_moves",
        reachedFusion: false,
        finalMax: maxTileLevel(cur),
        finalSecond: secondMaxTile(cur),
      };
    }
    const move =
      stepIndex === 0 ? firstMove : chooseAtDepth(cur, maxTileLevel(cur) >= 8 ? 8 : 6);
    if (!actions.includes(move)) {
      return {
        steps: stepIndex,
        terminal: "policy_illegal_move",
        reachedFusion: false,
        finalMax: maxTileLevel(cur),
        finalSecond: secondMaxTile(cur),
      };
    }
    const result = slide(cur, move);
    if (!result.moved) {
      return {
        steps: stepIndex + 1,
        terminal: "policy_illegal_move",
        reachedFusion: false,
        finalMax: maxTileLevel(result.next),
        finalSecond: secondMaxTile(result.next),
      };
    }
    const rngValue = rngValues[offset] ?? createRng(900000 + offset)();
    offset++;
    cur = spawnWithValue(result.next, rngValue);
    if (result.win) {
      return {
        steps: stepIndex + 1,
        terminal: "fusion",
        reachedFusion: true,
        finalMax: maxTileLevel(cur),
        finalSecond: secondMaxTile(cur),
      };
    }
  }
  return {
    steps: BRANCH_STEPS,
    terminal: "max_steps",
    reachedFusion: false,
    finalMax: maxTileLevel(cur),
    finalSecond: secondMaxTile(cur),
  };
}

function analyzeMilestones(trace: Trace): Milestone[] {
  const out: Milestone[] = [];
  for (const [name, hit] of trace.milestones.entries()) {
    const scores = scoreRoot(hit.board);
    const d6Move = choose(scores, 6);
    const d8Move = choose(scores, 8);
    const disagree = d6Move !== d8Move;
    out.push({
      name,
      turn: hit.turn,
      board: hit.board,
      scores,
      d6Move,
      d8Move,
      disagree,
      d6Replay: disagree ? replayForcedFirst(hit.board, d6Move, trace.rngValues, hit.rngOffset) : null,
      d8Replay: disagree ? replayForcedFirst(hit.board, d8Move, trace.rngValues, hit.rngOffset) : null,
    });
  }
  return out.sort((a, b) => a.turn - b.turn || a.name.localeCompare(b.name));
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

function benchmark(trigger: TriggerName, seeds: readonly number[]): BenchResult {
  let fusionCount = 0;
  let noFirstFusion = 0;
  let stepSum = 0;
  let decisionMsSum = 0;
  let decisionCount = 0;
  let depth8Usage = 0;
  const decisionTimes: number[] = [];

  for (const seed of seeds) {
    const rng = createRng(seed);
    let board = initialBoard(rng);
    let fused = false;
    let steps = 0;

    for (; steps < MAX_STEPS; steps++) {
      const actions = legalActions(board);
      if (actions.length === 0) break;
      const useD8 = triggerUsesDepth8(trigger, board);
      if (useD8) depth8Usage++;
      const startedAt = process.hrtime.bigint();
      const move = chooseAtDepth(board, useD8 ? 8 : 6);
      const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      decisionTimes.push(elapsed);
      decisionMsSum += elapsed;
      decisionCount++;
      if (!actions.includes(move)) break;
      const result = slide(board, move);
      if (!result.moved) break;
      board = spawnRandomDetailed(result.next, rng).board;
      if (result.win) {
        fused = true;
        steps++;
        break;
      }
    }

    if (fused) fusionCount++;
    else noFirstFusion++;
    stepSum += steps;
  }

  return {
    trigger,
    episodes: seeds.length,
    fusionCount,
    noFirstFusion,
    avgTurns: seeds.length === 0 ? 0 : stepSum / seeds.length,
    avgDecisionMs: decisionCount === 0 ? 0 : decisionMsSum / decisionCount,
    p95Ms: percentile(decisionTimes, 0.95),
    p99Ms: percentile(decisionTimes, 0.99),
    maxMs: decisionTimes.length === 0 ? 0 : Math.max(...decisionTimes),
    depth8Usage,
  };
}

function scoreString(score: number): string {
  if (!Number.isFinite(score)) return String(score);
  if (Math.abs(score) >= 1_000_000) return score.toFixed(0);
  return score.toFixed(2);
}

const traces = FAILED_SEEDS.map(traceCurrent);
console.log(`depth8 early trigger analysis`);
console.log(`failedSeeds=${FAILED_SEEDS.join(",")} maxSteps=${MAX_STEPS}`);
console.log("");

for (const trace of traces) {
  const milestones = analyzeMilestones(trace);
  console.log(`seed=${trace.seed} currentTerminal=${trace.terminal} steps=${trace.steps}`);
  for (const m of milestones) {
    const status = m.disagree ? "DISAGREE" : "same";
    const replay =
      m.disagree && m.d6Replay && m.d8Replay
        ? ` replay d6=${m.d6Replay.terminal}/${m.d6Replay.steps}/max${m.d6Replay.finalMax}/s${m.d6Replay.finalSecond} d8=${m.d8Replay.terminal}/${m.d8Replay.steps}/max${m.d8Replay.finalMax}/s${m.d8Replay.finalSecond}`
        : "";
    console.log(
      `  ${m.name} turn=${m.turn} max=${maxTileLevel(m.board)} second=${secondMaxTile(m.board)} ge6=${countTilesAtLeast(
        m.board,
        6
      )} empty=${emptyCount(m.board)} d6=${m.d6Move} d8=${m.d8Move} ${status}${replay} board=[${boardLine(m.board)}]`
    );
    for (const s of m.scores.filter((x) => x.legal)) {
      console.log(`    ${s.move.padEnd(5)} d6=${scoreString(s.d6).padStart(14)} d8=${scoreString(s.d8).padStart(14)}`);
    }
  }
  console.log("");
}

const triggers: TriggerName[] = ["current", "max7", "second6", "ge6x2", "max7OrEmpty3", "max7OrSecond6"];
console.log("benchmark on failed no-first-fusion seeds");
console.log(
  ["trigger", "fusion", "noFirst", "avgTurns", "avgMs", "p95", "p99", "maxMs", "depth8"].join(" | ")
);
for (const trigger of triggers) {
  const r = benchmark(trigger, FAILED_SEEDS);
  console.log(
    [
      r.trigger.padEnd(14),
      `${r.fusionCount}/${r.episodes}`.padEnd(8),
      `${r.noFirstFusion}/${r.episodes}`.padEnd(8),
      r.avgTurns.toFixed(1).padStart(8),
      r.avgDecisionMs.toFixed(2).padStart(8),
      r.p95Ms.toFixed(2).padStart(8),
      r.p99Ms.toFixed(2).padStart(8),
      r.maxMs.toFixed(2).padStart(8),
      String(r.depth8Usage).padStart(6),
    ].join(" | ")
  );
}

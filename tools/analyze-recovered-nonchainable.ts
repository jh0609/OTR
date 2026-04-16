import fs from "node:fs";
import path from "node:path";
import type { Board, Direction, Policy } from "../src/sim/types.ts";
import { spawnRandom } from "../src/sim/spawn.ts";
import { slide } from "../src/sim/slide.ts";
import { legalActions } from "../src/sim/legal.ts";
import { createRng } from "../src/sim/rng.ts";
import { makeRandomPolicy, greedyEmptyPolicy } from "../src/sim/policies.ts";
import { minimalPolicy } from "../src/sim/minimalSurvival.ts";
import { emptyBoard } from "../src/sim/simulate.ts";
import { emptyCount, maxTileLevel } from "../src/sim/board.ts";
import { secondMaxTile, areAdjacent } from "../src/sim/boardStats.ts";
import { SNAKE_PATH_INDICES } from "../src/sim/scoring.ts";
import { extractSurvivalFeatures } from "../src/sim/survivalFeatures.ts";

const IN_PATH = path.resolve(process.env.HL_REBUILD_IN ?? "out/hl-rebuild-events-full.json");
const OUT_PATH = path.resolve(
  process.env.RECOVERED_NONCHAINABLE_OUT ?? "out/recovered-nonchainable-analysis.json"
);
const PATH = SNAKE_PATH_INDICES;
const DIRS: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];
const H = 20;
const ENTROPY_THRESHOLD = Number(process.env.BRANCH_ENTROPY_THRESHOLD ?? "0.35");

type RawEvent = {
  seed: number;
  episodeId: number;
  hlLevel: number;
  start: { turn: number };
  events: {
    secondMaxIncreasedTurn: number | null;
    nextHLTurn: number | null;
    deadishTurn: number | null;
  };
};

type Replay = { posts: Board[]; slides: Board[]; pre0: Board };

function salt(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return Math.abs(h) % 10000;
}

function policyFor(label: string, rng: () => number): Policy {
  if (label === "P0-random") return makeRandomPolicy(rng);
  if (label === "P1-greedyEmpty") return greedyEmptyPolicy;
  return minimalPolicy;
}

function initialBoard(rng: () => number): Board {
  let b = emptyBoard();
  b = spawnRandom(b, rng);
  b = spawnRandom(b, rng);
  return b;
}

function replayEpisode(seed: number, episodeId: number, policyLabel: string): Replay {
  const rng = createRng(seed + episodeId * 100_003 + salt(policyLabel));
  const policy = policyFor(policyLabel, rng);
  let board: Board = initialBoard(rng);
  const pre0 = board.slice() as Board;
  const posts: Board[] = [];
  const slides: Board[] = [];
  while (true) {
    const actions = legalActions(board);
    if (actions.length === 0) break;
    const dir = policy(board, actions);
    const { next, moved, win } = slide(board, dir);
    if (win) break;
    if (!moved) break;
    slides.push(next.slice() as Board);
    board = spawnRandom(next, rng);
    posts.push(board.slice() as Board);
    if (posts.length > 500_000) break;
  }
  return { posts, slides, pre0 };
}

function preForTurn(posts: Board[], pre0: Board, turn: number): Board {
  return turn === 0 ? pre0 : posts[turn - 1]!;
}

function pathOrd(cell: number): number {
  for (let i = 0; i < PATH.length; i++) if (PATH[i] === cell) return i;
  return -1;
}

function cellsAtLevel(board: Board, L: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 9; i++) if (board[i] === L) out.push(i);
  return out;
}

function top2OrthogonalAdjacent(board: Board): boolean {
  const mx = maxTileLevel(board);
  const sm = secondMaxTile(board);
  const maxCells = cellsAtLevel(board, mx);
  const secondCells = sm === 0 || sm === mx ? maxCells : cellsAtLevel(board, sm);
  if (sm === mx && maxCells.length >= 2) {
    for (let i = 0; i < maxCells.length; i++) {
      for (let j = i + 1; j < maxCells.length; j++) {
        if (areAdjacent(maxCells[i]!, maxCells[j]!)) return true;
      }
    }
    return false;
  }
  for (const a of maxCells) {
    for (const b of secondCells) {
      if (a !== b && areAdjacent(a, b)) return true;
    }
  }
  return false;
}

function top2OneSlideOrthAdjacent(board: Board): boolean {
  for (const d of DIRS) {
    const { next, moved } = slide(board, d);
    if (!moved) continue;
    if (top2OrthogonalAdjacent(next)) return true;
  }
  return false;
}

function secondMaxNearHead(board: Board): boolean {
  const sm = secondMaxTile(board);
  if (sm === 0) return false;
  for (const i of cellsAtLevel(board, sm)) {
    if (pathOrd(i) <= 2) return true;
  }
  return false;
}

function levelCounts(b: Board): number[] {
  const c = new Array(10).fill(0);
  for (let i = 0; i < 9; i++) {
    const v = b[i]!;
    if (v >= 1 && v <= 9) c[v]++;
  }
  return c;
}

function hasMergeAtLeastLevel(pre: Board, slideBoard: Board, minL: number): boolean {
  const cp = levelCounts(pre);
  const cs = levelCounts(slideBoard);
  for (let L = minL; L <= 8; L++) {
    if (cs[L] <= cp[L] - 2 && cs[L + 1] >= cp[L + 1] + 1) return true;
  }
  return false;
}

function hasLowLevelMerge(pre: Board, slideBoard: Board): boolean {
  const cp = levelCounts(pre);
  const cs = levelCounts(slideBoard);
  for (let L = 1; L <= 4; L++) {
    if (cs[L] <= cp[L] - 2 && cs[L + 1] >= cp[L + 1] + 1) return true;
  }
  return false;
}

function isHighLevelMergeEvent(pre: Board, slideBoard: Board, post: Board): boolean {
  if (hasMergeAtLeastLevel(pre, slideBoard, 5)) return true;
  return maxTileLevel(post) > maxTileLevel(pre) && maxTileLevel(post) >= 6;
}

function branchingMetrics(board: Board): { bf: number; entropy: number } {
  const acts = legalActions(board);
  if (acts.length === 0) return { bf: 0, entropy: 0 };
  const outCnt = new Map<string, number>();
  for (const d of acts) {
    const { next, moved } = slide(board, d);
    if (!moved) continue;
    const sig = next.join(",");
    outCnt.set(sig, (outCnt.get(sig) ?? 0) + 1);
  }
  const bf = outCnt.size;
  if (bf <= 1) return { bf, entropy: 0 };
  const total = acts.length;
  let h = 0;
  for (const c of outCnt.values()) {
    const p = c / total;
    h -= p * Math.log(p);
  }
  return { bf, entropy: h / Math.log(bf) };
}

type TurnObs = {
  k: number;
  bf: number;
  entropy: number;
  emptyCount: number;
  oneStepSurvivalCount: number;
  immediateMergeCount: number;
  pairableOrth: boolean;
  pairableOneSlide: boolean;
  secondMaxTile: number;
  maxTileGap: number;
  secondMaxNearHead: boolean;
  opportunity: boolean;
  chosenLowMerge: boolean;
  chosenHighMerge: boolean;
};

type EventObs = {
  seed: number;
  episodeId: number;
  hlLevel: number;
  turn: number;
  nextHLTurn: number | null;
  deadishTurn: number | null;
  secondMaxIncreasedTurn: number | null;
  collapseTurn: number | null;
  recoveryTurn: number | null;
  recovered: boolean;
  turns: TurnObs[];
};

const raw = JSON.parse(fs.readFileSync(IN_PATH, "utf8")) as RawEvent[];
const cache = new Map<string, Replay>();
const obs: EventObs[] = [];

for (const e of raw) {
  const key = `${e.seed}:${e.episodeId}`;
  let rep = cache.get(key);
  if (!rep) {
    rep = replayEpisode(e.seed, e.episodeId, "P2-minimal");
    cache.set(key, rep);
  }
  const { posts, slides, pre0 } = rep;
  const tau = e.start.turn;
  if (tau < 0 || tau >= posts.length) continue;

  const turns: TurnObs[] = [];
  let collapseTurn: number | null = null;
  let recoveryTurn: number | null = null;

  for (let k = 1; k <= H; k++) {
    const t = tau + k;
    if (t >= posts.length) break;
    const pre = preForTurn(posts, pre0, t);
    const chosenSlide = slides[t]!;
    const chosenPost = posts[t]!;

    const { bf, entropy } = branchingMetrics(pre);
    if (collapseTurn === null && (bf <= 2 || entropy < ENTROPY_THRESHOLD)) collapseTurn = k;
    if (
      collapseTurn !== null &&
      recoveryTurn === null &&
      k > collapseTurn &&
      bf > 2 &&
      entropy >= ENTROPY_THRESHOLD
    ) {
      recoveryTurn = k;
    }

    let opportunity = false;
    for (const d of legalActions(pre)) {
      const { next, moved } = slide(pre, d);
      if (!moved) continue;
      if (isHighLevelMergeEvent(pre, next, next)) {
        opportunity = true;
        break;
      }
    }

    const sf = extractSurvivalFeatures(pre, null);
    turns.push({
      k,
      bf,
      entropy,
      emptyCount: emptyCount(pre),
      oneStepSurvivalCount: sf.oneStepSurvivalCount,
      immediateMergeCount: sf.immediateMergeCount,
      pairableOrth: top2OrthogonalAdjacent(pre),
      pairableOneSlide: top2OneSlideOrthAdjacent(pre),
      secondMaxTile: secondMaxTile(pre),
      maxTileGap: maxTileLevel(pre) - secondMaxTile(pre),
      secondMaxNearHead: secondMaxNearHead(pre),
      opportunity,
      chosenLowMerge: hasLowLevelMerge(pre, chosenSlide),
      chosenHighMerge: isHighLevelMergeEvent(pre, chosenSlide, chosenPost),
    });
  }

  obs.push({
    seed: e.seed,
    episodeId: e.episodeId,
    hlLevel: e.hlLevel,
    turn: tau,
    nextHLTurn: e.events.nextHLTurn,
    deadishTurn: e.events.deadishTurn,
    secondMaxIncreasedTurn: e.events.secondMaxIncreasedTurn,
    collapseTurn,
    recoveryTurn,
    recovered: recoveryTurn !== null,
    turns,
  });
}

const collapsed = obs.filter((e) => e.collapseTurn !== null);
const recovered = collapsed.filter((e) => e.recovered);
const nonRecovered = collapsed.filter((e) => !e.recovered);
const recoveredFailed = recovered.filter((e) => e.nextHLTurn === null);
const successful = obs.filter((e) => e.nextHLTurn !== null);

function mean(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function avgBoolRate(arr: boolean[]): number | null {
  return mean(arr.map((v) => (v ? 1 : 0)));
}

function windowFromCollapse(e: EventObs): TurnObs[] {
  if (e.collapseTurn === null) return [];
  return e.turns.filter((t) => t.k >= e.collapseTurn!);
}

function summarizeState(arr: EventObs[]) {
  const rows = arr.flatMap(windowFromCollapse);
  return {
    nEvents: arr.length,
    nStates: rows.length,
    emptyCount: mean(rows.map((r) => r.emptyCount)),
    oneStepSurvivalCount: mean(rows.map((r) => r.oneStepSurvivalCount)),
    immediateMergeCount: mean(rows.map((r) => r.immediateMergeCount)),
    pairableOrthRate: avgBoolRate(rows.map((r) => r.pairableOrth)),
    pairableOneSlideRate: avgBoolRate(rows.map((r) => r.pairableOneSlide)),
    secondMaxTile: mean(rows.map((r) => r.secondMaxTile)),
    maxTileGap: mean(rows.map((r) => r.maxTileGap)),
    secondMaxNearHeadRate: avgBoolRate(rows.map((r) => r.secondMaxNearHead)),
  };
}

function maxRunLen(bits: boolean[]): number {
  let best = 0;
  let cur = 0;
  for (const b of bits) {
    if (b) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

function allRunLens(bits: boolean[]): number[] {
  const out: number[] = [];
  let cur = 0;
  for (const b of bits) {
    if (b) cur++;
    else if (cur > 0) {
      out.push(cur);
      cur = 0;
    }
  }
  if (cur > 0) out.push(cur);
  return out;
}

function closureMetrics(arr: EventObs[]) {
  const perEvent = arr.map((e) => {
    const bitsOpp = e.turns.map((t) => t.opportunity);
    const bitsOrth = e.turns.map((t) => t.pairableOrth);
    const firstOpp = e.turns.find((t) => t.opportunity)?.k ?? null;
    const delayRecoveryToOpp =
      e.recoveryTurn !== null && firstOpp !== null && firstOpp >= e.recoveryTurn
        ? firstOpp - e.recoveryTurn
        : null;
    const runs = allRunLens(bitsOpp);
    const maxW = runs.length ? Math.max(...runs) : 0;
    return {
      oppRate: bitsOpp.filter(Boolean).length / Math.max(1, bitsOpp.length),
      orthRate: bitsOrth.filter(Boolean).length / Math.max(1, bitsOrth.length),
      maxOppWindow: maxW,
      hasW2: maxW >= 2 ? 1 : 0,
      hasW3: maxW >= 3 ? 1 : 0,
      meanRunLen: runs.length ? mean(runs)! : 0,
      pairableOrthMaxRun: maxRunLen(bitsOrth),
      delayRecoveryToOpp,
      flickerCount: bitsOpp.reduce((s, b, i) => (i > 0 && b !== bitsOpp[i - 1] ? s + 1 : s), 0),
    };
  });
  return {
    nEvents: arr.length,
    top2AdjacentRate: mean(perEvent.map((x) => x.orthRate)),
    mergeOpportunityRate: mean(perEvent.map((x) => x.oppRate)),
    pairableOrthMaxRun: mean(perEvent.map((x) => x.pairableOrthMaxRun)),
    opportunityMeanRunLen: mean(perEvent.map((x) => x.meanRunLen)),
    opportunityWindowGe2Prob: mean(perEvent.map((x) => x.hasW2)),
    opportunityWindowGe3Prob: mean(perEvent.map((x) => x.hasW3)),
    delayRecoveryToOpportunity: mean(
      perEvent
        .map((x) => x.delayRecoveryToOpp)
        .filter((x): x is number => x !== null)
    ),
    opportunityFlickerCount: mean(perEvent.map((x) => x.flickerCount)),
  };
}

type FailureMode = "A" | "B" | "C" | "D" | "E";

function classifyRecoveredFailure(e: EventObs): FailureMode {
  const oppTurns = e.turns.filter((t) => t.opportunity);
  const firstOpp = oppTurns[0]?.k ?? null;
  const deadish = e.deadishTurn;
  if (oppTurns.length === 0) return "A";

  if (deadish !== null && (firstOpp === null || deadish <= firstOpp + 2)) return "E";

  const oppLowInterfRate =
    oppTurns.filter((t) => t.chosenLowMerge).length / Math.max(1, oppTurns.length);
  if (oppLowInterfRate >= 0.5) return "D";

  const maxW = maxRunLen(e.turns.map((t) => t.opportunity));
  if (maxW <= 1) return "B";

  return "C";
}

const modeCnt: Record<FailureMode, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
for (const e of recoveredFailed) modeCnt[classifyRecoveredFailure(e)]++;

function pct(n: number, d: number): number | null {
  if (!d) return null;
  return n / d;
}

const recoveredVsNonRecovered = {
  recovered: summarizeState(recovered),
  nonRecovered: summarizeState(nonRecovered),
};

const closureCompare = {
  recoveredButFailed: closureMetrics(recoveredFailed),
  successful: closureMetrics(successful),
};

const closureViability = {
  recoveredButFailed: closureCompare.recoveredButFailed,
  successful: closureCompare.successful,
};

const out = {
  definitions: {
    collapsed: `first k where BF<=2 or entropy<${ENTROPY_THRESHOLD}`,
    recovered: `collapsed and later BF>2 and entropy>=${ENTROPY_THRESHOLD}`,
    recoveredButFailed: "recovered and nextHLTurn == null",
    successful: "nextHLTurn != null",
  },
  counts: {
    total: obs.length,
    collapsed: collapsed.length,
    recovered: recovered.length,
    nonRecovered: nonRecovered.length,
    recoveredButFailed: recoveredFailed.length,
    successful: successful.length,
  },
  recoveredVsNonRecovered,
  recoveredFailedVsSuccessful: closureCompare,
  failureModesRecoveredButFailed: {
    counts: modeCnt,
    rates: {
      A: pct(modeCnt.A, recoveredFailed.length),
      B: pct(modeCnt.B, recoveredFailed.length),
      C: pct(modeCnt.C, recoveredFailed.length),
      D: pct(modeCnt.D, recoveredFailed.length),
      E: pct(modeCnt.E, recoveredFailed.length),
    },
  },
  closureViability,
  causalChain: [
    "recovery",
    "short_or_flickering_closure_window",
    "low_or_unstable_closure_execution",
    "no_next_HL",
  ],
  finalSentence:
    "Recovered states fail to produce HL because recovered branching does not convert into sustained closure windows with executable high-level opportunities before absorption/interference.",
};

fs.writeFileSync(OUT_PATH, JSON.stringify(out));
process.stdout.write(JSON.stringify(out));

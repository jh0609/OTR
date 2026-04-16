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
import { maxTileLevel } from "../src/sim/board.ts";
import { secondMaxTile, areAdjacent } from "../src/sim/boardStats.ts";
import { SNAKE_PATH_INDICES } from "../src/sim/scoring.ts";

const IN_PATH = path.resolve(process.env.HL_REBUILD_IN ?? "out/hl-rebuild-events-full.json");
const OUT_PATH = path.resolve(process.env.BRANCH_SERIAL_OUT ?? "out/branch-serialization-analysis.json");
const ENTROPY_THRESHOLD = Number(process.env.BRANCH_ENTROPY_THRESHOLD ?? "0.35");
const PATH = SNAKE_PATH_INDICES;
const DIRS: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];

type RawEvent = {
  episodeId: number;
  seed: number;
  hlLevel: number;
  start: { turn: number };
  events: {
    secondMaxIncreasedTurn: number | null;
    nextHLTurn: number | null;
    deadishTurn: number | null;
  };
};

type Replay = {
  posts: Board[];
  slides: Board[];
  pre0: Board;
};

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

function pathOrd(cell: number): number {
  for (let k = 0; k < PATH.length; k++) if (PATH[k] === cell) return k;
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

function pairabilityType(board: Board): "orthogonal" | "one-slide" | "both" | "none" {
  const orth = top2OrthogonalAdjacent(board);
  const one = top2OneSlideOrthAdjacent(board);
  if (orth && one) return "both";
  if (orth) return "orthogonal";
  if (one) return "one-slide";
  return "none";
}

function levelCounts(b: Board): number[] {
  const c = new Array(10).fill(0);
  for (let i = 0; i < 9; i++) {
    const v = b[i]!;
    if (v >= 1 && v <= 9) c[v]++;
  }
  return c;
}

function mergePattern(pre: Board, postSlide: Board): string {
  const cp = levelCounts(pre);
  const cs = levelCounts(postSlide);
  const levels: number[] = [];
  for (let L = 1; L <= 8; L++) {
    if (cs[L] <= cp[L] - 2 && cs[L + 1] >= cp[L + 1] + 1) levels.push(L);
  }
  return levels.length ? levels.join("+") : "none";
}

type BoardBranchMetrics = {
  branchingFactor: number;
  mergePathDiversity: number;
  pairabilityDiversity: number;
  actionEntropy: number;
};

function metricsAtBoard(board: Board): BoardBranchMetrics {
  const acts = legalActions(board);
  if (acts.length === 0) {
    return {
      branchingFactor: 0,
      mergePathDiversity: 0,
      pairabilityDiversity: 0,
      actionEntropy: 0,
    };
  }

  const nextCount = new Map<string, number>();
  const mergeSet = new Set<string>();
  const pairSet = new Set<string>();

  for (const d of acts) {
    const { next, moved } = slide(board, d);
    if (!moved) continue;
    const sig = next.join(",");
    nextCount.set(sig, (nextCount.get(sig) ?? 0) + 1);
    mergeSet.add(mergePattern(board, next));
    pairSet.add(pairabilityType(next));
  }

  const branchingFactor = nextCount.size;
  const mergePathDiversity = mergeSet.size;
  const pairabilityDiversity = pairSet.size;

  if (branchingFactor <= 1) {
    return {
      branchingFactor,
      mergePathDiversity,
      pairabilityDiversity,
      actionEntropy: 0,
    };
  }

  const total = acts.length;
  let h = 0;
  for (const c of nextCount.values()) {
    const p = c / total;
    h -= p * Math.log(p);
  }
  const hNorm = h / Math.log(branchingFactor);

  return {
    branchingFactor,
    mergePathDiversity,
    pairabilityDiversity,
    actionEntropy: hNorm,
  };
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

type EventMetrics = {
  seed: number;
  episodeId: number;
  turn: number;
  hlLevel: number;
  group: "success" | "failure";
  collapseTurn: number | null;
  secondMaxIncreasedTurn: number | null;
  nextHLTurn: number | null;
  deadishTurn: number | null;
  serializationScore: number;
  recoveredAfterCollapse: boolean;
  perK: Array<
    {
      k: number;
    } & BoardBranchMetrics
  >;
};

const raw = JSON.parse(fs.readFileSync(IN_PATH, "utf8")) as RawEvent[];
const replayCache = new Map<string, Replay>();
const events: EventMetrics[] = [];

for (const e of raw) {
  const key = `${e.seed}:${e.episodeId}`;
  let rep = replayCache.get(key);
  if (!rep) {
    rep = replayEpisode(e.seed, e.episodeId, "P2-minimal");
    replayCache.set(key, rep);
  }
  const { posts } = rep;
  const tau = e.start.turn;
  if (tau < 0 || tau >= posts.length) continue;

  const startBoard = posts[tau]!;
  const m0 = metricsAtBoard(startBoard);

  const perK: EventMetrics["perK"] = [];
  let serializationScore = 0;
  let prev = m0.branchingFactor;
  let collapseTurn: number | null = null;
  for (let k = 1; k <= 20; k++) {
    const idx = tau + k;
    if (idx >= posts.length) break;
    const mk = metricsAtBoard(posts[idx]!);
    perK.push({ k, ...mk });
    serializationScore += Math.max(0, prev - mk.branchingFactor);
    prev = mk.branchingFactor;
    if (
      collapseTurn === null &&
      (mk.branchingFactor <= 2 || mk.actionEntropy < ENTROPY_THRESHOLD)
    ) {
      collapseTurn = k;
    }
  }

  let recoveredAfterCollapse = false;
  if (collapseTurn !== null) {
    for (const p of perK) {
      if (
        p.k > collapseTurn &&
        p.branchingFactor > 2 &&
        p.actionEntropy >= ENTROPY_THRESHOLD
      ) {
        recoveredAfterCollapse = true;
        break;
      }
    }
  }

  const group =
    e.events.secondMaxIncreasedTurn !== null || e.events.nextHLTurn !== null
      ? "success"
      : "failure";

  events.push({
    seed: e.seed,
    episodeId: e.episodeId,
    turn: tau,
    hlLevel: e.hlLevel,
    group,
    collapseTurn,
    secondMaxIncreasedTurn: e.events.secondMaxIncreasedTurn,
    nextHLTurn: e.events.nextHLTurn,
    deadishTurn: e.events.deadishTurn,
    serializationScore,
    recoveredAfterCollapse,
    perK,
  });
}

function groupBy<T>(arr: T[], keyFn: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of arr) {
    const k = keyFn(x);
    (out[k] ??= []).push(x);
  }
  return out;
}

function mean(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function perKSummary(arr: EventMetrics[]) {
  const out: Array<{
    k: number;
    n: number;
    branchingFactor: number | null;
    mergePathDiversity: number | null;
    pairabilityDiversity: number | null;
    actionEntropy: number | null;
    branchingDelta: number | null;
    entropyDelta: number | null;
    pairabilityDiversityDelta: number | null;
  }> = [];
  for (let k = 1; k <= 20; k++) {
    const rows = arr.map((e) => e.perK.find((x) => x.k === k)).filter(Boolean) as Array<
      EventMetrics["perK"][number]
    >;
    const prevRows = arr.map((e) => e.perK.find((x) => x.k === k - 1)).filter(Boolean) as Array<
      EventMetrics["perK"][number]
    >;
    const n = rows.length;
    const bf = mean(rows.map((r) => r.branchingFactor));
    const md = mean(rows.map((r) => r.mergePathDiversity));
    const pd = mean(rows.map((r) => r.pairabilityDiversity));
    const en = mean(rows.map((r) => r.actionEntropy));
    const prevBf = mean(prevRows.map((r) => r.branchingFactor));
    const prevEn = mean(prevRows.map((r) => r.actionEntropy));
    const prevPd = mean(prevRows.map((r) => r.pairabilityDiversity));
    out.push({
      k,
      n,
      branchingFactor: bf,
      mergePathDiversity: md,
      pairabilityDiversity: pd,
      actionEntropy: en,
      branchingDelta: bf !== null && prevBf !== null ? bf - prevBf : null,
      entropyDelta: en !== null && prevEn !== null ? en - prevEn : null,
      pairabilityDiversityDelta: pd !== null && prevPd !== null ? pd - prevPd : null,
    });
  }
  return out;
}

function collapseStats(arr: EventMetrics[]) {
  const turns = arr.map((e) => e.collapseTurn).filter((x): x is number => x !== null);
  const byTurn: Record<string, number> = {};
  for (const t of turns) byTurn[String(t)] = (byTurn[String(t)] ?? 0) + 1;
  const xsDead: number[] = [];
  const ysDead: number[] = [];
  const xsGrow: number[] = [];
  const ysGrow: number[] = [];
  for (const e of arr) {
    if (e.collapseTurn !== null && e.deadishTurn !== null) {
      xsDead.push(e.collapseTurn);
      ysDead.push(e.deadishTurn);
    }
    if (e.collapseTurn !== null && e.secondMaxIncreasedTurn !== null) {
      xsGrow.push(e.collapseTurn);
      ysGrow.push(e.secondMaxIncreasedTurn);
    }
  }
  return {
    n: arr.length,
    collapsed: turns.length,
    collapseRate: arr.length ? turns.length / arr.length : null,
    collapseTurnDistribution: byTurn,
    collapseTurnMean: mean(turns),
    corrCollapseDeadishTurn: pearson(xsDead, ysDead),
    corrCollapseSecondMaxGrowthTurn: pearson(xsGrow, ysGrow),
  };
}

function serializationSummary(arr: EventMetrics[]) {
  return {
    n: arr.length,
    serializationScoreMean: mean(arr.map((e) => e.serializationScore)),
    serializationScoreP95: (() => {
      if (!arr.length) return null;
      const s = arr.map((e) => e.serializationScore).sort((a, b) => a - b);
      return s[Math.floor((s.length - 1) * 0.95)] ?? null;
    })(),
  };
}

function recoveryTest(arr: EventMetrics[]) {
  const collapsed = arr.filter((e) => e.collapseTurn !== null);
  const recovered = collapsed.filter((e) => e.recoveredAfterCollapse);
  const notRecovered = collapsed.filter((e) => !e.recoveredAfterCollapse);
  const strong = (xs: EventMetrics[]) => xs.filter((e) => e.nextHLTurn !== null).length;
  return {
    collapsedN: collapsed.length,
    recoveredN: recovered.length,
    recoveredRate: collapsed.length ? recovered.length / collapsed.length : null,
    strongAmongRecovered: recovered.length ? strong(recovered) / recovered.length : null,
    strongAmongNotRecovered: notRecovered.length ? strong(notRecovered) / notRecovered.length : null,
  };
}

const byGroup = groupBy(events, (e) => e.group);
const byHL = groupBy(events, (e) => String(e.hlLevel));
const out = {
  metricDefinitions: {
    effectiveBranchingFactor: "count(distinct slide-next boards across legal actions)",
    mergePathDiversity: "count(distinct merge pattern signatures across legal actions)",
    pairabilityDiversity: "count(distinct pairability classes among next boards: orthogonal/one-slide/both/none)",
    actionEntropy:
      "normalized entropy over distinct-next-board outcome probabilities from legal actions",
    collapseTurn:
      `first k where branchingFactor<=2 OR actionEntropy<${ENTROPY_THRESHOLD}`,
    serializationScore:
      "sum_{k=1..20} max(0, branchingFactor(k-1)-branchingFactor(k)), with k=0 at HL start",
  },
  totals: {
    events: events.length,
    success: byGroup.success?.length ?? 0,
    failure: byGroup.failure?.length ?? 0,
  },
  trajectoryComparison: {
    success: perKSummary(byGroup.success ?? []),
    failure: perKSummary(byGroup.failure ?? []),
  },
  collapseStatistics: {
    success: collapseStats(byGroup.success ?? []),
    failure: collapseStats(byGroup.failure ?? []),
  },
  serializationSeverity: {
    success: serializationSummary(byGroup.success ?? []),
    failure: serializationSummary(byGroup.failure ?? []),
    byHL: Object.fromEntries(
      Object.entries(byHL).map(([k, v]) => [k, serializationSummary(v)])
    ),
  },
  recoveryCausalTest: {
    success: recoveryTest(byGroup.success ?? []),
    failure: recoveryTest(byGroup.failure ?? []),
    all: recoveryTest(events),
  },
};

fs.writeFileSync(OUT_PATH, JSON.stringify(out));
process.stdout.write(JSON.stringify(out));

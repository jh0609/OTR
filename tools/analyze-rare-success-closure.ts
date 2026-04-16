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
const OUT_PATH = path.resolve(process.env.RARE_SUCCESS_OUT ?? "out/rare-success-closure-analysis.json");
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

function minTop2PathDistance(board: Board): number {
  const mx = maxTileLevel(board);
  const sm = secondMaxTile(board);
  const maxCells = cellsAtLevel(board, mx);
  if (maxCells.length === 0 || sm === 0) return 0;
  if (sm === mx && maxCells.length >= 2) {
    let best = 99;
    for (let i = 0; i < maxCells.length; i++) {
      for (let j = i + 1; j < maxCells.length; j++) {
        const d = Math.abs(pathOrd(maxCells[i]!) - pathOrd(maxCells[j]!));
        if (d < best) best = d;
      }
    }
    return best === 99 ? 0 : best;
  }
  const secondCells = cellsAtLevel(board, sm);
  if (secondCells.length === 0) return 0;
  let best = 99;
  for (const a of maxCells) {
    for (const b of secondCells) {
      if (a === b) continue;
      const d = Math.abs(pathOrd(a) - pathOrd(b));
      if (d < best) best = d;
    }
  }
  return best === 99 ? 0 : best;
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

function isHighLevelMergeEvent(pre: Board, slideBoard: Board, post: Board): boolean {
  if (hasMergeAtLeastLevel(pre, slideBoard, 5)) return true;
  return maxTileLevel(post) > maxTileLevel(pre) && maxTileLevel(post) >= 6;
}

function branchingMetrics(board: Board): { bf: number; entropy: number } {
  const acts = legalActions(board);
  if (!acts.length) return { bf: 0, entropy: 0 };
  const nextCount = new Map<string, number>();
  for (const d of acts) {
    const { next, moved } = slide(board, d);
    if (!moved) continue;
    const sig = next.join(",");
    nextCount.set(sig, (nextCount.get(sig) ?? 0) + 1);
  }
  const bf = nextCount.size;
  if (bf <= 1) return { bf, entropy: 0 };
  let h = 0;
  for (const c of nextCount.values()) {
    const p = c / acts.length;
    h -= p * Math.log(p);
  }
  return { bf, entropy: h / Math.log(bf) };
}

type Step = {
  k: number;
  emptyCount: number;
  oneStepSurvivalCount: number;
  immediateMergeCount: number;
  secondMaxTile: number;
  maxTileGap: number;
  secondMaxNearHead: boolean;
  top2PathDistance: number;
  pairableOrth: boolean;
  pairableOneSlide: boolean;
  mergeOpportunity: boolean;
  bf: number;
  entropy: number;
};

type Obs = {
  seed: number;
  episodeId: number;
  hlLevel: number;
  turn: number;
  nextHLTurn: number | null;
  deadishTurn: number | null;
  collapseTurn: number | null;
  recoveryTurn: number | null;
  recovered: boolean;
  steps: Step[];
};

const raw = JSON.parse(fs.readFileSync(IN_PATH, "utf8")) as RawEvent[];
const cache = new Map<string, Replay>();
const obs: Obs[] = [];

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

  let collapseTurn: number | null = null;
  let recoveryTurn: number | null = null;
  const steps: Step[] = [];
  for (let k = 1; k <= H; k++) {
    const t = tau + k;
    if (t >= posts.length) break;
    const pre = preForTurn(posts, pre0, t);
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

    let mergeOpportunity = false;
    for (const d of legalActions(pre)) {
      const { next, moved } = slide(pre, d);
      if (!moved) continue;
      if (isHighLevelMergeEvent(pre, next, next)) {
        mergeOpportunity = true;
        break;
      }
    }

    const sf = extractSurvivalFeatures(pre, null);
    steps.push({
      k,
      emptyCount: emptyCount(pre),
      oneStepSurvivalCount: sf.oneStepSurvivalCount,
      immediateMergeCount: sf.immediateMergeCount,
      secondMaxTile: secondMaxTile(pre),
      maxTileGap: maxTileLevel(pre) - secondMaxTile(pre),
      secondMaxNearHead: secondMaxNearHead(pre),
      top2PathDistance: minTop2PathDistance(pre),
      pairableOrth: top2OrthogonalAdjacent(pre),
      pairableOneSlide: top2OneSlideOrthAdjacent(pre),
      mergeOpportunity,
      bf,
      entropy,
    });
  }

  obs.push({
    seed: e.seed,
    episodeId: e.episodeId,
    hlLevel: e.hlLevel,
    turn: tau,
    nextHLTurn: e.events.nextHLTurn,
    deadishTurn: e.events.deadishTurn,
    collapseTurn,
    recoveryTurn,
    recovered: recoveryTurn !== null,
    steps,
  });
}

const successfulRecovered = obs.filter(
  (e) => e.nextHLTurn !== null && e.recoveryTurn !== null && e.recoveryTurn < e.nextHLTurn
);
const recoveredFailed = obs.filter(
  (e) => e.recoveryTurn !== null && e.nextHLTurn === null
);

type CaseSummary = {
  caseId: string;
  seed: number;
  episodeId: number;
  hlLevel: number;
  t_HL: number;
  recoveryTurn: number;
  window: Step[];
  triggerStep: number | null;
  triggerDelta: Record<string, number | boolean | null>;
};

function extractWindow(e: Obs): Step[] {
  const tHL = e.nextHLTurn!;
  const s = Math.max(1, tHL - 5);
  return e.steps.filter((x) => x.k >= s && x.k <= tHL);
}

function triggerInfo(e: Obs): { step: number | null; delta: Record<string, number | boolean | null> } {
  const tHL = e.nextHLTurn!;
  let trig: number | null = null;
  for (let k = 1; k <= tHL; k++) {
    const cur = e.steps.find((x) => x.k === k);
    if (!cur) continue;
    const prev = e.steps.find((x) => x.k === k - 1);
    const prevOpp = prev ? prev.mergeOpportunity : false;
    if (!prevOpp && cur.mergeOpportunity) {
      trig = k;
      break;
    }
  }
  if (trig === null) return { step: null, delta: {} };
  const cur = e.steps.find((x) => x.k === trig)!;
  const prev = e.steps.find((x) => x.k === trig - 1);
  if (!prev) return { step: trig, delta: {} };
  return {
    step: trig,
    delta: {
      emptyCount: cur.emptyCount - prev.emptyCount,
      oneStepSurvivalCount: cur.oneStepSurvivalCount - prev.oneStepSurvivalCount,
      immediateMergeCount: cur.immediateMergeCount - prev.immediateMergeCount,
      secondMaxTile: cur.secondMaxTile - prev.secondMaxTile,
      maxTileGap: cur.maxTileGap - prev.maxTileGap,
      secondMaxNearHeadFlip:
        cur.secondMaxNearHead !== prev.secondMaxNearHead ? cur.secondMaxNearHead : null,
      top2PathDistance: cur.top2PathDistance - prev.top2PathDistance,
      pairableOrthFlip: cur.pairableOrth !== prev.pairableOrth ? cur.pairableOrth : null,
      pairableOneSlideFlip:
        cur.pairableOneSlide !== prev.pairableOneSlide ? cur.pairableOneSlide : null,
    },
  };
}

const preClosurePatterns: CaseSummary[] = successfulRecovered.map((e) => {
  const t = triggerInfo(e);
  return {
    caseId: `${e.seed}:${e.episodeId}:${e.turn}`,
    seed: e.seed,
    episodeId: e.episodeId,
    hlLevel: e.hlLevel,
    t_HL: e.nextHLTurn!,
    recoveryTurn: e.recoveryTurn!,
    window: extractWindow(e),
    triggerStep: t.step,
    triggerDelta: t.delta,
  };
});

function supportRate<T>(arr: T[], pred: (x: T) => boolean): number {
  if (!arr.length) return 0;
  return arr.filter(pred).length / arr.length;
}

// 후보 threshold: 성공 케이스 trigger step에서 70% 이상
type TriggerPoint = { e: Obs; s: Step; triggerK: number };
const triggers: TriggerPoint[] = [];
for (const e of successfulRecovered) {
  const t = triggerInfo(e).step;
  if (t === null) continue;
  const s = e.steps.find((x) => x.k === t);
  if (!s) continue;
  triggers.push({ e, s, triggerK: t });
}

function quantileInts(xs: number[], q: number): number {
  const ys = xs.slice().sort((a, b) => a - b);
  if (!ys.length) return 0;
  const idx = Math.floor((ys.length - 1) * q);
  return ys[idx]!;
}

const cand = {
  empty_ge: quantileInts(triggers.map((x) => x.s.emptyCount), 0.3),
  oneStep_ge: quantileInts(triggers.map((x) => x.s.oneStepSurvivalCount), 0.3),
  top2Dist_le: quantileInts(triggers.map((x) => x.s.top2PathDistance), 0.7),
  gap_le: quantileInts(triggers.map((x) => x.s.maxTileGap), 0.7),
};

const invariants = [
  {
    name: `emptyCount >= ${cand.empty_ge}`,
    successRate: supportRate(triggers, (x) => x.s.emptyCount >= cand.empty_ge),
    failureRate: supportRate(recoveredFailed, (e) =>
      e.steps.some((s) => s.emptyCount >= cand.empty_ge)
    ),
  },
  {
    name: `oneStepSurvivalCount >= ${cand.oneStep_ge}`,
    successRate: supportRate(triggers, (x) => x.s.oneStepSurvivalCount >= cand.oneStep_ge),
    failureRate: supportRate(recoveredFailed, (e) =>
      e.steps.some((s) => s.oneStepSurvivalCount >= cand.oneStep_ge)
    ),
  },
  {
    name: `top2PathDistance <= ${cand.top2Dist_le}`,
    successRate: supportRate(triggers, (x) => x.s.top2PathDistance <= cand.top2Dist_le),
    failureRate: supportRate(recoveredFailed, (e) =>
      e.steps.some((s) => s.top2PathDistance <= cand.top2Dist_le)
    ),
  },
  {
    name: `maxTileGap <= ${cand.gap_le}`,
    successRate: supportRate(triggers, (x) => x.s.maxTileGap <= cand.gap_le),
    failureRate: supportRate(recoveredFailed, (e) =>
      e.steps.some((s) => s.maxTileGap <= cand.gap_le)
    ),
  },
  {
    name: "secondMaxNearHead == true",
    successRate: supportRate(triggers, (x) => x.s.secondMaxNearHead),
    failureRate: supportRate(recoveredFailed, (e) => e.steps.some((s) => s.secondMaxNearHead)),
  },
  {
    name: "pairableOrth == true",
    successRate: supportRate(triggers, (x) => x.s.pairableOrth),
    failureRate: supportRate(recoveredFailed, (e) => e.steps.some((s) => s.pairableOrth)),
  },
  {
    name: "pairableOneSlide == true",
    successRate: supportRate(triggers, (x) => x.s.pairableOneSlide),
    failureRate: supportRate(recoveredFailed, (e) => e.steps.some((s) => s.pairableOneSlide)),
  },
  {
    name: "mergeOpportunity == true",
    successRate: supportRate(triggers, (x) => x.s.mergeOpportunity),
    failureRate: supportRate(recoveredFailed, (e) => e.steps.some((s) => s.mergeOpportunity)),
  },
];

const minimalInvariantSet = invariants
  .filter((x) => x.successRate >= 0.7)
  .sort((a, b) => (b.successRate - b.failureRate) - (a.successRate - a.failureRate));

const triggerAnalysis = preClosurePatterns.map((c) => ({
  caseId: c.caseId,
  triggerStep: c.triggerStep,
  triggerDelta: c.triggerDelta,
}));

const minimalRule = {
  condition:
    "pairableOrth==true AND mergeOpportunity==true AND oneStepSurvivalCount>=threshold",
  threshold: {
    oneStepSurvivalCount: cand.oneStep_ge,
  },
  supportInSuccessTriggers: supportRate(triggers, (x) =>
    x.s.pairableOrth &&
    x.s.mergeOpportunity &&
    x.s.oneStepSurvivalCount >= cand.oneStep_ge
  ),
  supportInRecoveredFailedAnyTurn: supportRate(recoveredFailed, (e) =>
    e.steps.some(
      (s) =>
        s.pairableOrth &&
        s.mergeOpportunity &&
        s.oneStepSurvivalCount >= cand.oneStep_ge
    )
  ),
};

const out = {
  counts: {
    successfulRecovered: successfulRecovered.length,
    recoveredFailed: recoveredFailed.length,
    triggerPoints: triggers.length,
  },
  preClosurePatterns,
  commonInvariants: {
    thresholdCandidates: cand,
    invariants,
    minimalInvariantSet,
  },
  differentiatorsVsFailure: invariants
    .map((x) => ({ ...x, gap: x.successRate - x.failureRate }))
    .sort((a, b) => b.gap - a.gap),
  closureTriggerStepAnalysis: triggerAnalysis,
  closureCondition: minimalRule,
  finalSentence:
    "HL closure opportunity emerges only when recovered states simultaneously satisfy executable orthogonal top2 alignment with sufficient one-step survival capacity at the trigger step.",
};

fs.writeFileSync(OUT_PATH, JSON.stringify(out));
process.stdout.write(JSON.stringify(out));

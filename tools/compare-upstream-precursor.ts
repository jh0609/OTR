import type { Board, Direction, Policy } from "../src/sim/types.ts";
import { createRng } from "../src/sim/rng.ts";
import { legalActions } from "../src/sim/legal.ts";
import { slide } from "../src/sim/slide.ts";
import { spawnRandom } from "../src/sim/spawn.ts";
import { emptyBoard } from "../src/sim/simulate.ts";
import { maxTileLevel } from "../src/sim/board.ts";
import { secondMaxTile } from "../src/sim/boardStats.ts";
import { isDeadish } from "../src/sim/survivalFeatures.ts";
import {
  adaptiveHlConversionBonus,
  getMaxTileGap,
  getTopEndPairability,
} from "../src/sim/topEndPairability.ts";
import {
  countOneStepSurvivors,
  minimalPolicy,
  scoreBoardMinimal,
} from "../src/sim/minimalSurvival.ts";

const DIR_ORDER: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];
const N = Math.max(1, Number(process.env.SIM_MINIMAL_N ?? "5000"));
const SEEDS = (process.env.SIM_MINIMAL_SEEDS ?? "42,43")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const POLICY_LABEL = "P2-minimal";
const H = 20;
const ENTROPY_THRESHOLD = 0.35;

const LOCK_ORTH_CREATE_BONUS = 1400;
const LOCK_ORTH_KEEP_BONUS = 900;
const LOCK_SURVIVAL_DROP_PENALTY = 1200;
const LOCK_GAP_BREAK_PENALTY = 1000;

function salt(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return Math.abs(h) % 10000;
}

function initialBoard(rng: () => number): Board {
  let b = emptyBoard();
  b = spawnRandom(b, rng);
  b = spawnRandom(b, rng);
  return b;
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
  let h = 0;
  for (const c of outCnt.values()) {
    const p = c / acts.length;
    h -= p * Math.log(p);
  }
  return { bf, entropy: h / Math.log(bf) };
}

function isClosureReadyArmedLegacy(board: Board): boolean {
  const pair = getTopEndPairability(board);
  return getMaxTileGap(board) <= 1 && pair.oneSlideTop2Adj && countOneStepSurvivors(board) >= 5;
}

function closureReadyAdjustmentLegacy(before: Board, afterSlide: Board): number {
  if (!isClosureReadyArmedLegacy(before)) return 0;
  const beforePair = getTopEndPairability(before);
  const afterPair = getTopEndPairability(afterSlide);
  const afterOneStep = countOneStepSurvivors(afterSlide);
  const afterGap = getMaxTileGap(afterSlide);
  let delta = 0;
  if (!beforePair.top2OrthAdj && afterPair.top2OrthAdj) delta += LOCK_ORTH_CREATE_BONUS;
  else if (beforePair.top2OrthAdj && afterPair.top2OrthAdj) delta += LOCK_ORTH_KEEP_BONUS;
  if (afterOneStep < 7) delta -= LOCK_SURVIVAL_DROP_PENALTY;
  if (afterGap > 1) delta -= LOCK_GAP_BREAK_PENALTY;
  return delta;
}

function pickGreedy(
  board: Board,
  actions: Direction[],
  scoreFn: (before: Board, after: Board) => number
): Direction {
  let bestScore = Number.NEGATIVE_INFINITY;
  const tied: Direction[] = [];
  for (const d of actions) {
    const { next, win, moved } = slide(board, d);
    if (win) return d;
    if (!moved) continue;
    const s = scoreFn(board, next);
    if (s > bestScore) {
      bestScore = s;
      tied.length = 0;
      tied.push(d);
    } else if (s === bestScore) {
      tied.push(d);
    }
  }
  for (const d of DIR_ORDER) if (tied.includes(d)) return d;
  return actions[0]!;
}

const baselinePolicy: Policy = (board, actions) =>
  pickGreedy(board, actions, (_b, next) => scoreBoardMinimal(next));

const adaptiveOnlyPolicy: Policy = (board, actions) =>
  pickGreedy(board, actions, (b, next) => scoreBoardMinimal(next) + adaptiveHlConversionBonus(b, next));

const closureLockFailedPolicy: Policy = (board, actions) =>
  pickGreedy(
    board,
    actions,
    (b, next) => scoreBoardMinimal(next) + adaptiveHlConversionBonus(b, next) + closureReadyAdjustmentLegacy(b, next)
  );

type EpisodeTrace = {
  posts: Board[];
  slides: Board[];
  pre0: Board;
  turns: number;
  win: boolean;
};

function simulateTrace(seed: number, episode: number, policy: Policy): EpisodeTrace {
  const rng = createRng(seed + episode * 100_003 + salt(POLICY_LABEL));
  let board: Board = initialBoard(rng);
  const pre0 = board.slice() as Board;
  const posts: Board[] = [];
  const slides: Board[] = [];
  let turns = 0;
  let win = false;

  while (true) {
    const actions = legalActions(board);
    if (actions.length === 0) break;
    const d = policy(board, actions);
    const { next, moved, win: w } = slide(board, d);
    if (w) {
      win = true;
      turns++;
      break;
    }
    if (!moved) break;
    turns++;
    slides.push(next.slice() as Board);
    board = spawnRandom(next, rng);
    posts.push(board.slice() as Board);
    if (posts.length > 500_000) break;
  }
  return { posts, slides, pre0, turns, win };
}

function preForTurn(posts: Board[], pre0: Board, turn: number): Board {
  return turn === 0 ? pre0 : posts[turn - 1]!;
}

type Agg = {
  name: string;
  episodes: number;
  wins: number;
  turnsSum: number;
  maxSum: number;
  secondSum: number;
  firstDeadishSum: number;
  firstDeadishN: number;
  hlStarts: number;
  nextHl: number;
  strongRebuild: number;
  recoveredFailedN: number;
  recoveredFailedPrecursorHit: number;
  recoveredFailedOppHit: number;
};

function initAgg(name: string): Agg {
  return {
    name,
    episodes: 0,
    wins: 0,
    turnsSum: 0,
    maxSum: 0,
    secondSum: 0,
    firstDeadishSum: 0,
    firstDeadishN: 0,
    hlStarts: 0,
    nextHl: 0,
    strongRebuild: 0,
    recoveredFailedN: 0,
    recoveredFailedPrecursorHit: 0,
    recoveredFailedOppHit: 0,
  };
}

function runVariant(name: string, policy: Policy): Agg {
  const a = initAgg(name);
  for (const seed of SEEDS) {
    for (let ep = 0; ep < N; ep++) {
      const tr = simulateTrace(seed, ep, policy);
      a.episodes++;
      if (tr.win) a.wins++;
      a.turnsSum += tr.turns;

      const last = tr.posts.length ? tr.posts[tr.posts.length - 1]! : tr.pre0;
      a.maxSum += maxTileLevel(last);
      a.secondSum += secondMaxTile(last);

      let firstDead: number | null = null;
      for (let i = 0; i < tr.posts.length; i++) {
        if (isDeadish(tr.posts[i]!)) {
          firstDead = i + 1;
          break;
        }
      }
      if (firstDead !== null) {
        a.firstDeadishSum += firstDead;
        a.firstDeadishN++;
      }

      const T = tr.posts.length - 1;
      if (T < 0) continue;
      for (let tau = 0; tau <= T; tau++) {
        const pre = preForTurn(tr.posts, tr.pre0, tau);
        const sl = tr.slides[tau]!;
        const post = tr.posts[tau]!;
        if (!isHighLevelMergeEvent(pre, sl, post)) continue;
        a.hlStarts++;

        const tLim = Math.min(T, tau + H);
        let nextHlTurn: number | null = null;
        let collapseTurn: number | null = null;
        let recoveryTurn: number | null = null;
        let precursorHit = false;
        let oppHit = false;

        for (let t = tau + 1; t <= tLim; t++) {
          const preT = preForTurn(tr.posts, tr.pre0, t);
          const slT = tr.slides[t]!;
          const poT = tr.posts[t]!;
          const k = t - tau;

          if (nextHlTurn === null && isHighLevelMergeEvent(preT, slT, poT)) {
            nextHlTurn = k;
          }

          const { bf, entropy } = branchingMetrics(preT);
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

          const pair = getTopEndPairability(preT);
          if (getMaxTileGap(preT) <= 1 && pair.top2OrthAdj) precursorHit = true;

          let opp = false;
          for (const d of legalActions(preT)) {
            const { next, moved } = slide(preT, d);
            if (!moved) continue;
            if (isHighLevelMergeEvent(preT, next, next)) {
              opp = true;
              break;
            }
          }
          if (opp) oppHit = true;
        }

        if (nextHlTurn !== null) {
          a.nextHl++;
          a.strongRebuild++;
        } else if (collapseTurn !== null && recoveryTurn !== null) {
          a.recoveredFailedN++;
          if (precursorHit) a.recoveredFailedPrecursorHit++;
          if (oppHit) a.recoveredFailedOppHit++;
        }
      }
    }
  }
  return a;
}

function pct(n: number, d: number): number {
  return d > 0 ? (100 * n) / d : 0;
}

function summarize(a: Agg) {
  return {
    name: a.name,
    episodes: a.episodes,
    recoveredFailedN: a.recoveredFailedN,
    precursorRateRecoveredFailed: pct(a.recoveredFailedPrecursorHit, a.recoveredFailedN),
    mergeOpportunityRateRecoveredFailed: pct(a.recoveredFailedOppHit, a.recoveredFailedN),
    nextHlRate: pct(a.nextHl, a.hlStarts),
    strongRebuildRate: pct(a.strongRebuild, a.hlStarts),
    firstDeadishTurn: a.firstDeadishN ? a.firstDeadishSum / a.firstDeadishN : null,
    turns: a.episodes ? a.turnsSum / a.episodes : null,
    finalMaxTile: a.episodes ? a.maxSum / a.episodes : null,
    finalSecondMaxTile: a.episodes ? a.secondSum / a.episodes : null,
    winRate: pct(a.wins, a.episodes),
  };
}

console.log(`SIM_MINIMAL_N=${N} seeds=${SEEDS.join(",")} policy=${POLICY_LABEL}`);
const baseline = runVariant("baseline minimal", baselinePolicy);
console.log("finished baseline");
const adaptive = runVariant("adaptive bonus only", adaptiveOnlyPolicy);
console.log("finished adaptive");
const lockFailed = runVariant("closure-ready lock(failed)", closureLockFailedPolicy);
console.log("finished lockFailed");
const current = runVariant("adaptive + pre-closure shaping(current)", minimalPolicy);
console.log("finished current");

const out = {
  config: { N, seeds: SEEDS, horizon: H, entropyThreshold: ENTROPY_THRESHOLD },
  priorityMetrics: [
    summarize(baseline),
    summarize(adaptive),
    summarize(lockFailed),
    summarize(current),
  ],
};

process.stdout.write(JSON.stringify(out));

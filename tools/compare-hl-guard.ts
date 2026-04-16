/**
 * baseline minimal vs guarded minimal 비교 (P2-minimal 정책).
 * npx tsx tools/compare-hl-guard.ts
 */
import type { Board, Direction, Policy } from "../src/sim/types.ts";
import { createRng } from "../src/sim/rng.ts";
import { legalActions } from "../src/sim/legal.ts";
import { slide } from "../src/sim/slide.ts";
import { spawnRandom } from "../src/sim/spawn.ts";
import { emptyBoard } from "../src/sim/simulate.ts";
import {
  scoreBoardMinimal,
  minimalPolicy,
} from "../src/sim/minimalSurvival.ts";
import { maxTileLevel } from "../src/sim/board.ts";
import { secondMaxTile, areAdjacent } from "../src/sim/boardStats.ts";
import { isDeadish } from "../src/sim/survivalFeatures.ts";
import {
  adaptiveHlConversionBonus,
  createsHighLevelMerge,
  isHighLevelPairable,
} from "../src/sim/topEndPairability.ts";

const DIR_ORDER: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];
const N = Math.max(1, Number(process.env.SIM_MINIMAL_N ?? "5000"));
const SEEDS = (process.env.SIM_MINIMAL_SEEDS ?? "42,43,44,45")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const POLICY_LABEL = "P2-minimal";

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

function baselineMinimalPolicy(board: Board, actions: Direction[]): Direction {
  let bestScore = Number.NEGATIVE_INFINITY;
  const tied: Direction[] = [];
  for (const d of actions) {
    const { next, win } = slide(board, d);
    if (win) return d;
    const s = scoreBoardMinimal(next);
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

function fixedHlBonus(before: Board, afterSlide: Board, bonus: number): number {
  if (isHighLevelPairable(before) && createsHighLevelMerge(before, afterSlide)) return bonus;
  return 0;
}

function fixedBonusPolicyFactory(bonus: number): Policy {
  return (board, actions) => {
    let bestScore = Number.NEGATIVE_INFINITY;
    const tied: Direction[] = [];
    for (const d of actions) {
      const { next, win, moved } = slide(board, d);
      if (win) return d;
      if (!moved) continue;
      const s = scoreBoardMinimal(next) + fixedHlBonus(board, next, bonus);
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
  };
}

const adaptiveBonusPolicy: Policy = (board, actions) => {
  let bestScore = Number.NEGATIVE_INFINITY;
  const tied: Direction[] = [];
  for (const d of actions) {
    const { next, win, moved } = slide(board, d);
    if (win) return d;
    if (!moved) continue;
    const s = scoreBoardMinimal(next) + adaptiveHlConversionBonus(board, next);
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
};

function cellsAtLevel(board: Board, level: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] === level) out.push(i);
  }
  return out;
}

function top2OrthAdj(board: Board): boolean {
  const mx = maxTileLevel(board);
  const sm = secondMaxTile(board);
  const maxCells = cellsAtLevel(board, mx);
  if (maxCells.length === 0 || sm === 0) return false;
  const secondCells = sm === mx ? maxCells : cellsAtLevel(board, sm);
  if (sm === mx) {
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

function oneSlideTop2Adj(board: Board): boolean {
  for (const d of DIR_ORDER) {
    const { next, moved } = slide(board, d);
    if (!moved) continue;
    if (top2OrthAdj(next)) return true;
  }
  return false;
}

function pWeak(board: Board): boolean {
  return top2OrthAdj(board) || oneSlideTop2Adj(board);
}

function hasMergeAtLeastLevel(before: Board, afterSlide: Board, minL: number): boolean {
  const bCnt = new Array(10).fill(0);
  const aCnt = new Array(10).fill(0);
  for (let i = 0; i < 9; i++) {
    const b = before[i]!;
    const a = afterSlide[i]!;
    if (b >= 1 && b <= 9) bCnt[b]++;
    if (a >= 1 && a <= 9) aCnt[a]++;
  }
  for (let L = minL; L <= 8; L++) {
    if (aCnt[L] <= bCnt[L] - 2 && aCnt[L + 1] >= bCnt[L + 1] + 1) return true;
  }
  return false;
}

function isHighLevelMerge(before: Board, afterSlide: Board, post: Board): boolean {
  if (hasMergeAtLeastLevel(before, afterSlide, 6)) return true;
  return maxTileLevel(post) > maxTileLevel(before) && maxTileLevel(post) >= 6;
}

function isLowLevelMergeOnly(before: Board, afterSlide: Board): boolean {
  return hasMergeAtLeastLevel(before, afterSlide, 1) && !hasMergeAtLeastLevel(before, afterSlide, 6);
}

function preFor(posts: Board[], pre0: Board, k: number): Board {
  return k === 0 ? pre0 : posts[k - 1]!;
}

type ReplayResult = {
  turns: number;
  win: boolean;
  finalBoard: Board;
  firstDeadishTurn: number | null;
  posts: Board[];
  slides: Board[];
  pre0: Board;
};

function simulateDetailed(policy: Policy, rng: () => number): ReplayResult {
  let board = initialBoard(rng);
  const pre0 = board.slice() as Board;
  const posts: Board[] = [];
  const slides: Board[] = [];
  let steps = 0;
  let firstDeadishTurn: number | null = null;

  while (true) {
    const actions = legalActions(board);
    if (!actions.length) {
      return { turns: steps, win: false, finalBoard: board, firstDeadishTurn, posts, slides, pre0 };
    }
    if (firstDeadishTurn === null && isDeadish(board)) firstDeadishTurn = steps;
    const dir = policy(board, actions);
    const { next, moved, win } = slide(board, dir);
    steps++;
    if (win) {
      return { turns: steps, win: true, finalBoard: next, firstDeadishTurn, posts, slides, pre0 };
    }
    if (!moved) {
      return { turns: steps, win: false, finalBoard: next, firstDeadishTurn, posts, slides, pre0 };
    }
    slides.push(next.slice() as Board);
    board = spawnRandom(next, rng);
    posts.push(board.slice() as Board);
  }
}

type Agg = {
  episodes: number;
  wins: number;
  turnsSum: number;
  firstDeadishSum: number;
  firstDeadishCount: number;
  finalMaxSum: number;
  finalSecondSum: number;
  opp: number;
  oppConv: number;
  noneRuns: number;
  type2Runs: number;
};

function initAgg(): Agg {
  return {
    episodes: 0,
    wins: 0,
    turnsSum: 0,
    firstDeadishSum: 0,
    firstDeadishCount: 0,
    finalMaxSum: 0,
    finalSecondSum: 0,
    opp: 0,
    oppConv: 0,
    noneRuns: 0,
    type2Runs: 0,
  };
}

function collectRunsAndOpp(a: Agg, r: ReplayResult): void {
  const { posts, slides, pre0 } = r;
  let s: number | null = null;
  for (let i = 0; i < posts.length; i++) {
    const ok = pWeak(posts[i]!);
    if (ok && s === null) s = i;
    if (!ok && s !== null) {
      handleRun(a, posts, slides, pre0, s, i - 1);
      s = null;
    }
  }
  if (s !== null) handleRun(a, posts, slides, pre0, s, posts.length - 1);
}

function handleRun(a: Agg, posts: Board[], slides: Board[], pre0: Board, s: number, e: number): void {
  let convDuring = false;
  for (let k = s; k <= e; k++) {
    const pre = preFor(posts, pre0, k);
    if (isHighLevelMerge(pre, slides[k]!, posts[k]!)) {
      convDuring = true;
      break;
    }
  }
  const hlNext =
    !convDuring &&
    e + 1 < posts.length &&
    isHighLevelMerge(preFor(posts, pre0, e + 1), slides[e + 1]!, posts[e + 1]!);

  if (!convDuring && !hlNext) {
    a.noneRuns++;
    let type2 = false;
    for (let k = Math.max(s, e - 1); k <= e; k++) {
      const pre = preFor(posts, pre0, k);
      if (isLowLevelMergeOnly(pre, slides[k]!)) {
        type2 = true;
        break;
      }
    }
    if (type2) a.type2Runs++;
  }

  for (let k = s; k <= e; k++) {
    if (k + 1 >= posts.length) continue;
    if (!pWeak(posts[k]!)) continue;
    a.opp++;
    const conv = isHighLevelMerge(preFor(posts, pre0, k + 1), slides[k + 1]!, posts[k + 1]!);
    if (conv) a.oppConv++;
  }
}

function runVariant(name: string, policy: Policy): Agg {
  const a = initAgg();
  const s = salt(POLICY_LABEL);
  for (const seed of SEEDS) {
    for (let episode = 0; episode < N; episode++) {
      const rng = createRng(seed + episode * 100_003 + s);
      const r = simulateDetailed(policy, rng);
      a.episodes++;
      if (r.win) a.wins++;
      a.turnsSum += r.turns;
      if (r.firstDeadishTurn !== null) {
        a.firstDeadishCount++;
        a.firstDeadishSum += r.firstDeadishTurn;
      }
      a.finalMaxSum += maxTileLevel(r.finalBoard);
      a.finalSecondSum += secondMaxTile(r.finalBoard);
      collectRunsAndOpp(a, r);
    }
  }
  console.log(`finished ${name}: episodes=${a.episodes}`);
  return a;
}

function p(n: number, d: number): string {
  return d ? ((100 * n) / d).toFixed(4) + "%" : "n/a";
}

function line(label: string, base: number, guard: number, percent = false): string {
  const b = percent ? (base * 100).toFixed(4) + "%" : base.toFixed(4);
  const g = percent ? (guard * 100).toFixed(4) + "%" : guard.toFixed(4);
  const d = guard - base;
  const ds = percent ? (d * 100).toFixed(4) + "pp" : d.toFixed(4);
  return `${label}: baseline=${b} | guarded=${g} | delta=${ds}`;
}

function printVariant(name: string, base: Agg, v: Agg): void {
  const bConv = base.opp ? base.oppConv / base.opp : 0;
  const vConv = v.opp ? v.oppConv / v.opp : 0;
  const bType2 = base.noneRuns ? base.type2Runs / base.noneRuns : 0;
  const vType2 = v.noneRuns ? v.type2Runs / v.noneRuns : 0;
  const bFirstDeadish = base.firstDeadishCount ? base.firstDeadishSum / base.firstDeadishCount : 0;
  const vFirstDeadish = v.firstDeadishCount ? v.firstDeadishSum / v.firstDeadishCount : 0;
  const bTurns = base.turnsSum / base.episodes;
  const vTurns = v.turnsSum / v.episodes;
  const bMax = base.finalMaxSum / base.episodes;
  const vMax = v.finalMaxSum / v.episodes;
  const bSecond = base.finalSecondSum / base.episodes;
  const vSecond = v.finalSecondSum / v.episodes;
  const bWin = base.wins / base.episodes;
  const vWin = v.wins / v.episodes;

  console.log(`\n=== ${name} vs baseline ===`);
  console.log(line("opportunity당 HL conversion rate", bConv, vConv, true));
  console.log(line("Type2 interception 비율 (conv none run 기준)", bType2, vType2, true));
  console.log(line("firstDeadishTurn 평균(관측된 에피소드만)", bFirstDeadish, vFirstDeadish));
  console.log(line("turns 평균", bTurns, vTurns));
  console.log(line("final maxTile 평균", bMax, vMax));
  console.log(line("final secondMaxTile 평균", bSecond, vSecond));
  console.log(line("win rate", bWin, vWin, true));
  console.log(
    `raw ${name}: oppConv=${v.oppConv}/${v.opp} type2=${v.type2Runs}/${v.noneRuns} wins=${v.wins}/${v.episodes}`
  );
}

console.log(`SIM_MINIMAL_N=${N} seeds=${SEEDS.join(",")} policy=${POLICY_LABEL}`);
const baseline = runVariant("baseline", baselineMinimalPolicy);
const fixed1000 = runVariant("fixed1000", fixedBonusPolicyFactory(1000));
const fixed2000 = runVariant("fixed2000", fixedBonusPolicyFactory(2000));
const adaptive = runVariant("adaptive800_1200_1800", adaptiveBonusPolicy);
const minimalCurrent = runVariant("minimalPolicy(current)", minimalPolicy);

console.log("\n=== baseline raw ===");
console.log(
  `baseline: oppConv=${baseline.oppConv}/${baseline.opp} type2=${baseline.type2Runs}/${baseline.noneRuns} wins=${baseline.wins}/${baseline.episodes}`
);
printVariant("fixed1000", baseline, fixed1000);
printVariant("fixed2000", baseline, fixed2000);
printVariant("adaptive800_1200_1800", baseline, adaptive);
printVariant("minimalPolicy(current)", baseline, minimalCurrent);

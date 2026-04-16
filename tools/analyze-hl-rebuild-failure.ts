/**
 * HL merge 이후 rebuild 실패 분석.
 * npx tsx tools/analyze-hl-rebuild-failure.ts
 *
 * 핵심: HL merge 턴 τ의 post(τ)를 rebuild start로 보고, 이후 20턴 trajectory를 추적.
 */
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
import { extractSurvivalFeatures, isDeadish } from "../src/sim/survivalFeatures.ts";

const PATH = SNAKE_PATH_INDICES;
const TOP_K = 3;
const DIRS: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];

const N = Math.max(1, Number(process.env.SIM_MINIMAL_N ?? "2000"));
const SEEDS = (process.env.SIM_MINIMAL_SEEDS ?? "42,43")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const POLICY_LABEL = process.env.CHAIN_POLICY ?? "P2-minimal";
const H = 20; // rebuild horizon

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

function mergeLevelIfAny(pre: Board, slideBoard: Board): 5 | 6 | 7 | 8 | null {
  const cp = levelCounts(pre);
  const cs = levelCounts(slideBoard);
  for (let L = 8; L >= 5; L--) {
    if (cs[L] <= cp[L] - 2 && cs[L + 1] >= cp[L + 1] + 1) return L as 5 | 6 | 7 | 8;
  }
  return null;
}

function isHighLevelMergeEvent(pre: Board, slideBoard: Board, post: Board): boolean {
  if (hasMergeAtLeastLevel(pre, slideBoard, 6)) return true;
  return maxTileLevel(post) > maxTileLevel(pre) && maxTileLevel(post) >= 6;
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

function top2Pairable(board: Board): boolean {
  return top2OrthogonalAdjacent(board) || top2OneSlideOrthAdjacent(board);
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

function top3PathSpan(board: Board): number {
  const entries = PATH.map((cell, ord) => ({ cell, ord, v: board[cell]! })).filter((e) => e.v > 0);
  entries.sort((a, b) => b.v - a.v || a.ord - b.ord);
  const top = entries.slice(0, TOP_K);
  if (top.length === 0) return 0;
  const ords = top.map((e) => e.ord);
  return Math.max(...ords) - Math.min(...ords);
}

function top3Consistent(board: Board): boolean {
  const entries = PATH.map((cell, ord) => ({ cell, ord, v: board[cell]! })).filter((e) => e.v > 0);
  entries.sort((a, b) => b.v - a.v || a.ord - b.ord);
  const top = entries.slice(0, TOP_K);
  top.sort((a, b) => a.ord - b.ord);
  for (let i = 0; i < top.length - 1; i++) {
    if (top[i]!.v < top[i + 1]!.v) return false;
  }
  return true;
}

function secondNearHead(board: Board): boolean {
  const sm = secondMaxTile(board);
  if (sm === 0) return false;
  for (const i of cellsAtLevel(board, sm)) {
    if (pathOrd(i) <= 2) return true;
  }
  return false;
}

function gapOf(board: Board): number {
  return maxTileLevel(board) - secondMaxTile(board);
}

function preForTurn(posts: Board[], pre0: Board, turn: number): Board {
  return turn === 0 ? pre0 : posts[turn - 1]!;
}

function replayEpisode(seed: number, episode: number, policyLabel: string) {
  const rng = createRng(seed + episode * 100_003 + salt(policyLabel));
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

type Kind = "5to6" | "6to7" | "other";
type FailType = "A" | "B" | "C" | "D" | "E";

type Start = {
  maxTile: number;
  second: number;
  gap: number;
  empty: number;
  secondNear: boolean;
  dist: number;
  span3: number;
  top3ok: boolean;
  orth: boolean;
  oneSlide: boolean;
  deadish: boolean;
  immediateMergeCount: number;
  oneStepSurvivalCount: number;
};

type Event = {
  kind: Kind;
  weak: boolean;
  strong: boolean;
  fail: boolean;
  failType: FailType | null;
  start: Start;
  regrowSecond: boolean;
  regrowTurn: number | null;
  regrowThenStagnate: boolean;
  nearHeadRecoveredAfterRegrow: boolean;
};

const events: Event[] = [];

type TrajAcc = {
  n: number;
  empty: number;
  gap: number;
  second: number;
  secondNear: number;
  dist: number;
  span3: number;
  deadish: number;
  orth: number;
  oneSlide: number;
  llCum: number;
  immMerge: number;
  oneStep: number;
};

function makeTrajAcc(): TrajAcc {
  return {
    n: 0,
    empty: 0,
    gap: 0,
    second: 0,
    secondNear: 0,
    dist: 0,
    span3: 0,
    deadish: 0,
    orth: 0,
    oneSlide: 0,
    llCum: 0,
    immMerge: 0,
    oneStep: 0,
  };
}

const traj67All: TrajAcc[] = Array.from({ length: H }, makeTrajAcc);
const traj67Weak: TrajAcc[] = Array.from({ length: H }, makeTrajAcc);
const traj67Fail: TrajAcc[] = Array.from({ length: H }, makeTrajAcc);

function pushTraj(acc: TrajAcc, board: Board, llCum: number): void {
  const f = extractSurvivalFeatures(board, null);
  acc.n++;
  acc.empty += emptyCount(board);
  acc.gap += gapOf(board);
  acc.second += secondMaxTile(board);
  acc.secondNear += secondNearHead(board) ? 1 : 0;
  acc.dist += minTop2PathDistance(board);
  acc.span3 += top3PathSpan(board);
  acc.deadish += isDeadish(board) ? 1 : 0;
  acc.orth += top2OrthogonalAdjacent(board) ? 1 : 0;
  acc.oneSlide += top2OneSlideOrthAdjacent(board) ? 1 : 0;
  acc.llCum += llCum;
  acc.immMerge += f.immediateMergeCount;
  acc.oneStep += f.oneStepSurvivalCount;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function printStart(label: string, arr: Start[]): void {
  if (arr.length === 0) {
    console.log(`  ${label}: n=0`);
    return;
  }
  const p = (fn: (x: Start) => boolean) => (100 * arr.filter(fn).length) / arr.length;
  console.log(`  ${label}: n=${arr.length}`);
  console.log(
    `    max=${mean(arr.map((x) => x.maxTile)).toFixed(4)} second=${mean(arr.map((x) => x.second)).toFixed(4)} gap=${mean(arr.map((x) => x.gap)).toFixed(4)} empty=${mean(arr.map((x) => x.empty)).toFixed(4)}`
  );
  console.log(
    `    secondNear=${p((x) => x.secondNear).toFixed(2)}% dist=${mean(arr.map((x) => x.dist)).toFixed(4)} span3=${mean(arr.map((x) => x.span3)).toFixed(4)} top3ok=${p((x) => x.top3ok).toFixed(2)}%`
  );
  console.log(
    `    orth=${p((x) => x.orth).toFixed(2)}% oneSlide=${p((x) => x.oneSlide).toFixed(2)}% deadish=${p((x) => x.deadish).toFixed(2)}% immMerge=${mean(arr.map((x) => x.immediateMergeCount)).toFixed(4)} oneStep=${mean(arr.map((x) => x.oneStepSurvivalCount)).toFixed(4)}`
  );
}

function printRates(label: string, arr: Event[]): void {
  const n = arr.length;
  if (n === 0) {
    console.log(`${label}: n=0`);
    return;
  }
  const weak = arr.filter((e) => e.weak).length;
  const strong = arr.filter((e) => e.strong).length;
  const fail = arr.filter((e) => e.fail).length;
  console.log(
    `${label}: n=${n} weak=${weak} (${((100 * weak) / n).toFixed(2)}%) strong=${strong} (${((100 * strong) / n).toFixed(2)}%) failure=${fail} (${((100 * fail) / n).toFixed(2)}%)`
  );
}

function printTraj(name: string, traj: TrajAcc[]): void {
  console.log(`\n[${name}] k=1..${H}`);
  for (let k = 1; k <= H; k++) {
    const a = traj[k - 1]!;
    if (a.n === 0) continue;
    const d = (v: number) => (v / a.n).toFixed(3);
    console.log(
      `k=${String(k).padStart(2, "0")} n=${a.n} empty=${d(a.empty)} gap=${d(a.gap)} second=${d(a.second)} secondNear%=${d(100 * a.secondNear)} dist=${d(a.dist)} span3=${d(a.span3)} deadish%=${d(100 * a.deadish)} orth%=${d(100 * a.orth)} oneSlide%=${d(100 * a.oneSlide)} llCum=${d(a.llCum)} immMerge=${d(a.immMerge)} oneStep=${d(a.oneStep)}`
    );
  }
}

for (const seed of SEEDS) {
  for (let episode = 0; episode < N; episode++) {
    const { posts, slides, pre0 } = replayEpisode(seed, episode, POLICY_LABEL);
    const T = posts.length - 1;
    if (T < 0) continue;

    for (let tau = 0; tau <= T; tau++) {
      const pre = preForTurn(posts, pre0, tau);
      const sl = slides[tau]!;
      const post = posts[tau]!;
      if (!isHighLevelMergeEvent(pre, sl, post)) continue;

      const m = mergeLevelIfAny(pre, sl);
      const kind: Kind = m === 5 ? "5to6" : m === 6 ? "6to7" : "other";

      const sFeat = extractSurvivalFeatures(post, null);
      const start: Start = {
        maxTile: maxTileLevel(post),
        second: secondMaxTile(post),
        gap: gapOf(post),
        empty: emptyCount(post),
        secondNear: secondNearHead(post),
        dist: minTop2PathDistance(post),
        span3: top3PathSpan(post),
        top3ok: top3Consistent(post),
        orth: top2OrthogonalAdjacent(post),
        oneSlide: top2OneSlideOrthAdjacent(post),
        deadish: isDeadish(post),
        immediateMergeCount: sFeat.immediateMergeCount,
        oneStepSurvivalCount: sFeat.oneStepSurvivalCount,
      };

      const tLim = Math.min(T, tau + H);
      let strong = false;
      let weakSecond = false;
      let weakPairReformed = false;
      let hadPairPrev = top2Pairable(post);
      let llCount = 0;
      let pairCount = 0;
      let gapMax = start.gap;
      let gapSum = 0;
      let deadishSeen = false;
      let deadishCount = 0;
      let firstDeadishOffset: number | null = null;
      let regrowTurn: number | null = null;
      let regrowValue = start.second;
      let grewAgainAfterFirst = false;
      let nearHeadRecovered = false;

      for (let t = tau + 1; t <= tLim; t++) {
        const preT = preForTurn(posts, pre0, t);
        const slT = slides[t]!;
        const poT = posts[t]!;

        if (isHighLevelMergeEvent(preT, slT, poT)) strong = true;
        if (hasLowLevelMerge(preT, slT)) llCount++;

        const sec = secondMaxTile(poT);
        const pair = top2Pairable(poT);
        if (sec >= start.second + 1 && !weakSecond) {
          weakSecond = true;
          regrowTurn = t - tau;
          regrowValue = sec;
        } else if (regrowTurn !== null && sec > regrowValue) {
          grewAgainAfterFirst = true;
          regrowValue = sec;
        }
        if (!hadPairPrev && pair) weakPairReformed = true;
        hadPairPrev = pair;
        if (regrowTurn !== null && secondNearHead(poT)) nearHeadRecovered = true;

        pairCount += pair ? 1 : 0;
        const g = gapOf(poT);
        gapMax = Math.max(gapMax, g);
        gapSum += g;
        if (isDeadish(poT)) {
          deadishSeen = true;
          deadishCount++;
          if (firstDeadishOffset === null) firstDeadishOffset = t - tau;
        }

        if (kind === "6to7") {
          const k = t - tau;
          const llCum = llCount;
          pushTraj(traj67All[k - 1]!, poT, llCum);
        }
      }

      const weak = weakSecond || weakPairReformed;
      const fail = !weak && !strong;

      let failType: FailType | null = null;
      if (fail) {
        const nStep = Math.max(1, tLim - tau);
        const pairRate = pairCount / nStep;
        const gapAvg = gapSum / nStep;
        const deadishRate = deadishCount / nStep;
        if (pairRate < 0.15) failType = "D";
        else if (!weakSecond && llCount >= 6) failType = "A";
        else if (!weakSecond && (gapAvg >= start.gap + 0.5 || gapMax >= start.gap + 2)) failType = "B";
        else if (
          deadishSeen &&
          ((firstDeadishOffset !== null && firstDeadishOffset <= 6) || deadishRate >= 0.4)
        ) {
          failType = "C";
        }
        else failType = "E";
      }

      const ev: Event = {
        kind,
        weak,
        strong,
        fail,
        failType,
        start,
        regrowSecond: weakSecond,
        regrowTurn,
        regrowThenStagnate: regrowTurn !== null && !grewAgainAfterFirst,
        nearHeadRecoveredAfterRegrow: regrowTurn !== null && nearHeadRecovered,
      };
      events.push(ev);

      if (kind === "6to7") {
        for (let t = tau + 1; t <= tLim; t++) {
          const poT = posts[t]!;
          const llCum = (() => {
            let c = 0;
            for (let z = tau + 1; z <= t; z++) {
              const preZ = preForTurn(posts, pre0, z);
              if (hasLowLevelMerge(preZ, slides[z]!)) c++;
            }
            return c;
          })();
          const k = t - tau;
          if (weak) pushTraj(traj67Weak[k - 1]!, poT, llCum);
          if (fail) pushTraj(traj67Fail[k - 1]!, poT, llCum);
        }
      }
    }
  }
}

const ev56 = events.filter((e) => e.kind === "5to6");
const ev67 = events.filter((e) => e.kind === "6to7");
const evAll = events;

console.log(`SIM_MINIMAL_N=${N} SIM_MINIMAL_SEEDS=${SEEDS.join(",")} CHAIN_POLICY=${POLICY_LABEL} H=${H}`);
console.log("\n## 1) rebuild success rate (weak/strong)");
printRates("all HL starts", evAll);
printRates("5->6 starts", ev56);
printRates("6->7 starts", ev67);

console.log("\n## 2) 6->7 이후 trajectory (k=1..20)");
printTraj("6->7 all", traj67All);
printTraj("6->7 weak success only", traj67Weak);
printTraj("6->7 failure only", traj67Fail);

console.log("\n## 3) rebuild 성공/실패 start 상태 비교");
printStart("all weak success", evAll.filter((e) => e.weak).map((e) => e.start));
printStart("all failure", evAll.filter((e) => e.fail).map((e) => e.start));
printStart("6->7 weak success", ev67.filter((e) => e.weak).map((e) => e.start));
printStart("6->7 failure", ev67.filter((e) => e.fail).map((e) => e.start));

console.log("\n## 4) rebuild failure 원인 (Type A~E)");
const failAll = evAll.filter((e) => e.fail);
const fail67 = ev67.filter((e) => e.fail);
function printFailDist(label: string, arr: Event[]): void {
  const n = arr.length;
  if (n === 0) {
    console.log(`  ${label}: n=0`);
    return;
  }
  const cnt = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const e of arr) {
    if (e.failType) cnt[e.failType]++;
  }
  console.log(`  ${label}: n=${n}`);
  for (const k of ["A", "B", "C", "D", "E"] as const) {
    console.log(`    Type ${k}: ${cnt[k]} (${((100 * cnt[k]) / n).toFixed(2)}%)`);
  }
}
printFailDist("all failure", failAll);
printFailDist("6->7 failure", fail67);
console.log("  rule note: A=LL churn, B=gap lock-in, C=deadish absorption, D=pairability drought, E=other");

console.log("\n## 5) second branch regrowth (20턴 창)");
function printRegrowth(label: string, arr: Event[]): void {
  const n = arr.length;
  if (n === 0) {
    console.log(`  ${label}: n=0`);
    return;
  }
  const reg = arr.filter((e) => e.regrowSecond);
  const regRate = (100 * reg.length) / n;
  const turnMean = mean(reg.map((e) => e.regrowTurn ?? NaN).filter((x) => Number.isFinite(x)));
  const stagnate = reg.filter((e) => e.regrowThenStagnate).length;
  const nearRec = reg.filter((e) => e.nearHeadRecoveredAfterRegrow).length;
  console.log(
    `  ${label}: n=${n} regrow=${reg.length} (${regRate.toFixed(2)}%)` +
      (reg.length > 0
        ? ` | timeToFirstGrow=${turnMean.toFixed(3)} turns | regrowThenStagnate=${((100 * stagnate) / reg.length).toFixed(2)}% | nearHeadRecovered=${((100 * nearRec) / reg.length).toFixed(2)}%`
        : "")
  );
}
printRegrowth("all HL starts", evAll);
printRegrowth("5->6 starts", ev56);
printRegrowth("6->7 starts", ev67);

console.log("\n## 6) 핵심 결론 (해석용)");
console.log(
  "- weak rebuild(secondary regrowth/pairable 재형성)와 strong rebuild(다음 HL)를 분리해서 병목을 본다.\n" +
    "- 특히 6->7에서 strong이 0에 가깝고 weak도 낮으면 'HL 이후 rebuild 실패' 가설이 강해진다.\n" +
    "- 실패 타입은 근사 규칙 기반이므로 절대 인과가 아니라 지배 패턴 식별용으로 해석한다."
);

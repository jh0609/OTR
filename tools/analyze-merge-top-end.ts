/**
 * high-level merge 직후 1~3턴: top-end structure (전체 inversion보다 우선 해석용 지표).
 * npx tsx tools/analyze-merge-top-end.ts
 *
 * 이벤트·재시뮬·경로: analyze-merge-hamiltonian.ts 와 동일.
 * PATH = SNAKE_PATH_INDICES = [8,7,6,5,4,3,2,1,0]
 */
import * as fs from "node:fs";
import type { Board, Direction, Policy } from "../src/sim/types.ts";
import { spawnRandom } from "../src/sim/spawn.ts";
import { slide } from "../src/sim/slide.ts";
import { legalActions } from "../src/sim/legal.ts";
import { createRng } from "../src/sim/rng.ts";
import { makeRandomPolicy, greedyEmptyPolicy } from "../src/sim/policies.ts";
import { minimalPolicy } from "../src/sim/minimalSurvival.ts";
import { emptyBoard } from "../src/sim/simulate.ts";
import { maxTileLevel } from "../src/sim/board.ts";
import { maxTileAtAnchor, secondMaxTile, areAdjacent } from "../src/sim/boardStats.ts";
import { SNAKE_PATH_INDICES } from "../src/sim/scoring.ts";
import { isDeadish } from "../src/sim/survivalFeatures.ts";

const ANCHOR = 8 as const;
const PATH = SNAKE_PATH_INDICES;
const TOP_K = 3;
const DIRS: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];

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

function pathOrd(cell: number): number {
  for (let k = 0; k < PATH.length; k++) {
    if (PATH[k] === cell) return k;
  }
  return -1;
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

/** 슬라이드에서 L+L→L+1 (L=5..8). 고레벨 전용이면 L≥6만 별도 집계에 사용 */
function mergeLevelIfAny(pre: Board, slideBoard: Board): 5 | 6 | 7 | 8 | null {
  const cp = levelCounts(pre);
  const cs = levelCounts(slideBoard);
  for (let L = 8; L >= 5; L--) {
    if (cs[L] <= cp[L] - 2 && cs[L + 1] >= cp[L + 1] + 1) return L as 5 | 6 | 7 | 8;
  }
  return null;
}

function cellsAtLevel(board: Board, L: number): number[] {
  const o: number[] = [];
  for (let i = 0; i < 9; i++) if (board[i] === L) o.push(i);
  return o;
}

/** min |pathOrd(a)-pathOrd(b)| over valid top2 대표 쌍 (동 max면 서로 다른 두 max 칸) */
function minTop2PathDistance(board: Board): number {
  const mx = maxTileLevel(board);
  const sm = secondMaxTile(board);
  const maxCells = cellsAtLevel(board, mx);
  if (maxCells.length === 0) return 0;
  if (sm === 0) return 0;
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

/** 경로 상 가장 앞(ord 작음) max 칸 vs 가장 앞 secondMax 칸 거리 (보조) */
function forwardPairTop2PathDistance(board: Board): number {
  const mx = maxTileLevel(board);
  const sm = secondMaxTile(board);
  const maxCells = [...cellsAtLevel(board, mx)].sort((a, b) => pathOrd(a) - pathOrd(b));
  if (!maxCells.length) return 0;
  if (sm === 0) return 0;
  if (sm === mx && maxCells.length >= 2) {
    return Math.abs(pathOrd(maxCells[0]!) - pathOrd(maxCells[1]!));
  }
  const secondCells = [...cellsAtLevel(board, sm)].sort((a, b) => pathOrd(a) - pathOrd(b));
  if (!secondCells.length) return 0;
  return Math.abs(pathOrd(maxCells[0]!) - pathOrd(secondCells[0]!));
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

/** 한 번 slide 후 어떤 방향에서든 max–secondMax가 인접하면 true */
function top2OneSlideOrthAdjacent(board: Board): boolean {
  for (const d of DIRS) {
    const { next, moved } = slide(board, d);
    if (!moved) continue;
    if (top2OrthogonalAdjacent(next)) return true;
  }
  return false;
}

function topKOrderConsistent(board: Board, k: number): boolean {
  const entries = PATH.map((cell, ord) => ({ cell, ord, v: board[cell]! })).filter((e) => e.v > 0);
  entries.sort((a, b) => b.v - a.v || a.ord - b.ord);
  const top = entries.slice(0, k);
  top.sort((a, b) => a.ord - b.ord);
  for (let i = 0; i < top.length - 1; i++) {
    if (top[i]!.v < top[i + 1]!.v) return false;
  }
  return true;
}

/** top3 셀(값 내림차순·동값은 path 앞쪽 우선)의 path ord span */
function top3PathSpan(board: Board): number {
  const entries = PATH.map((cell, ord) => ({ cell, ord, v: board[cell]! })).filter((e) => e.v > 0);
  entries.sort((a, b) => b.v - a.v || a.ord - b.ord);
  const top = entries.slice(0, TOP_K);
  if (top.length === 0) return 0;
  const ords = top.map((e) => e.ord);
  return Math.max(...ords) - Math.min(...ords);
}

/** secondMax 레벨 타일 중 하나라도 path 앞 3칸(ord 0..2 → 칸 8,7,6)에 있으면 true */
function secondMaxNearAnchorHead(board: Board): boolean {
  const sm = secondMaxTile(board);
  if (sm === 0) return false;
  for (const i of cellsAtLevel(board, sm)) {
    if (pathOrd(i) <= 2) return true;
  }
  return false;
}

type TopEnd = {
  distMin: number;
  distFwd: number;
  top2Adj: boolean;
  top2SlideAdj: boolean;
  span3: number;
  top3ok: boolean;
  maxAnchor: boolean;
  secondNear: boolean;
};

function topEndMetrics(board: Board): TopEnd {
  return {
    distMin: minTop2PathDistance(board),
    distFwd: forwardPairTop2PathDistance(board),
    top2Adj: top2OrthogonalAdjacent(board),
    top2SlideAdj: top2OneSlideOrthAdjacent(board),
    span3: top3PathSpan(board),
    top3ok: topKOrderConsistent(board, TOP_K),
    maxAnchor: maxTileAtAnchor(board, ANCHOR) === 1,
    secondNear: secondMaxNearAnchorHead(board),
  };
}

function isHighLevelMergeEvent(pre: Board, slideBoard: Board, post: Board): boolean {
  if (hasMergeAtLeastLevel(pre, slideBoard, 6)) return true;
  if (maxTileLevel(post) > maxTileLevel(pre) && maxTileLevel(post) >= 6) return true;
  return false;
}

function replayEpisode(seed: number, episode: number, policyLabel: string) {
  const rng = createRng(seed + episode * 100_003 + salt(policyLabel));
  const policy = policyFor(policyLabel, rng);
  let board: Board = initialBoard(rng);
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
  return { posts, slides };
}

function firstDeadishPostIndex(posts: Board[]): number | null {
  for (let i = 0; i < posts.length; i++) {
    if (isDeadish(posts[i]!)) return i;
  }
  return null;
}

type Row = {
  policy: string;
  episode: number;
  turns: number;
  survivalAfterNearDead: number | null;
  firstDeadishTurn?: number | null;
};

type Ev = {
  mergeLv: 5 | 6 | 7 | 8 | "maxStepOnly";
  teType: "A" | "B" | "C";
  d0Dist: number;
  d0Span: number;
  d0Top3: number;
  d0SecondNear: number;
  d0Top2Adj: number;
  d0Top2Slide: number;
  d0DistFwd: number;
  recSpan1: boolean;
  recSpan2: boolean;
  recSpan3: boolean;
  recDist1: boolean;
  recDist2: boolean;
  recDist3: boolean;
  recTop31: boolean;
  recTop32: boolean;
  recTop33: boolean;
  recNear1: boolean;
  recNear2: boolean;
  recNear3: boolean;
  deadishAfter: number | null;
  epTurns: number;
  survNear: number | null;
};

function classifyTopEnd(tePre: TopEnd, teT: TopEnd): { a: number; c: number } {
  const improveDist = teT.distMin < tePre.distMin;
  const worsenDist = teT.distMin > tePre.distMin;
  const improveSpan = teT.span3 < tePre.span3;
  const worsenSpan = teT.span3 > tePre.span3;
  const goodTop3 = !(tePre.top3ok && !teT.top3ok);
  const badTop3 = tePre.top3ok && !teT.top3ok;
  const goodNear = !(tePre.secondNear && !teT.secondNear);
  const badNear = tePre.secondNear && !teT.secondNear;
  const a = [improveDist, improveSpan, goodTop3, goodNear].filter(Boolean).length;
  const c = [worsenDist, worsenSpan, badTop3, badNear].filter(Boolean).length;
  return { a, c };
}

function resolveType(a: number, c: number): "A" | "B" | "C" {
  if (a >= 2 && c < 2) return "A";
  if (c >= 2 && a < 2) return "C";
  if (a >= 2 && c >= 2) return "B";
  if (a === 0 && c === 0) return "B";
  if (a > c) return "A";
  if (c > a) return "C";
  return "B";
}

const files: { path: string; seed: number }[] = [
  { path: "out/minimal-episodes-seed42.jsonl", seed: 42 },
  { path: "out/minimal-episodes-seed43.jsonl", seed: 43 },
  { path: "out/minimal-episodes-seed44.jsonl", seed: 44 },
  { path: "out/minimal-episodes-seed45.jsonl", seed: 45 },
];

const maxLinesPerFile = Number(process.env.MERGE_HAML_MAX_LINES ?? "0") || Infinity;

const events: Ev[] = [];
const byEp: { cTop: number; turns: number; surv: number | null }[] = [];

for (const { path: fp, seed } of files) {
  if (!fs.existsSync(fp)) continue;
  let nLine = 0;
  for (const line of fs.readFileSync(fp, "utf8").trim().split("\n")) {
    if (nLine >= maxLinesPerFile) break;
    nLine++;
    if (!line) continue;
    const row = JSON.parse(line) as Row;
    const { posts, slides } = replayEpisode(seed, row.episode, row.policy);
    if (posts.length < 4) continue;
    const fd = firstDeadishPostIndex(posts);
    let epC = 0;

    for (let τ = 1; τ < posts.length - 3; τ++) {
      const pre = posts[τ - 1]!;
      const slideBoard = slides[τ]!;
      const post = posts[τ]!;
      if (!isHighLevelMergeEvent(pre, slideBoard, post)) continue;

      const ml = mergeLevelIfAny(pre, slideBoard);
      const mergeLv: Ev["mergeLv"] = ml !== null ? ml : "maxStepOnly";

      const tePre = topEndMetrics(pre);
      const teT = topEndMetrics(post);
      const { a, c } = classifyTopEnd(tePre, teT);
      const teType = resolveType(a, c);
      if (teType === "C") epC++;

      const d0Dist = teT.distMin - tePre.distMin;
      const d0Span = teT.span3 - tePre.span3;
      const d0Top3 = (teT.top3ok === tePre.top3ok ? 0 : teT.top3ok ? 1 : -1) as number;
      const d0SecondNear = (teT.secondNear === tePre.secondNear ? 0 : teT.secondNear ? 1 : -1) as number;
      const d0Top2Adj = (teT.top2Adj === tePre.top2Adj ? 0 : teT.top2Adj ? 1 : -1) as number;
      const d0Top2Slide = (teT.top2SlideAdj === tePre.top2SlideAdj ? 0 : teT.top2SlideAdj ? 1 : -1) as number;
      const d0DistFwd = teT.distFwd - tePre.distFwd;

      const spanT = teT.span3;
      const distT = teT.distMin;
      const topT = teT.top3ok;
      const nearT = teT.secondNear;

      const recSpan1 = τ + 1 < posts.length && topEndMetrics(posts[τ + 1]!).span3 < spanT;
      const recSpan2 = τ + 2 < posts.length && topEndMetrics(posts[τ + 2]!).span3 < spanT;
      const recSpan3 = τ + 3 < posts.length && topEndMetrics(posts[τ + 3]!).span3 < spanT;
      const recDist1 = τ + 1 < posts.length && topEndMetrics(posts[τ + 1]!).distMin < distT;
      const recDist2 = τ + 2 < posts.length && topEndMetrics(posts[τ + 2]!).distMin < distT;
      const recDist3 = τ + 3 < posts.length && topEndMetrics(posts[τ + 3]!).distMin < distT;
      const recTop31 = τ + 1 < posts.length && topEndMetrics(posts[τ + 1]!).top3ok && !topT;
      const recTop32 = τ + 2 < posts.length && topEndMetrics(posts[τ + 2]!).top3ok && !topT;
      const recTop33 = τ + 3 < posts.length && topEndMetrics(posts[τ + 3]!).top3ok && !topT;
      const recNear1 = τ + 1 < posts.length && topEndMetrics(posts[τ + 1]!).secondNear && !nearT;
      const recNear2 = τ + 2 < posts.length && topEndMetrics(posts[τ + 2]!).secondNear && !nearT;
      const recNear3 = τ + 3 < posts.length && topEndMetrics(posts[τ + 3]!).secondNear && !nearT;

      let deadishAfter: number | null = null;
      if (fd !== null && fd >= τ) deadishAfter = fd - τ;

      events.push({
        mergeLv,
        teType,
        d0Dist,
        d0Span,
        d0Top3,
        d0SecondNear,
        d0Top2Adj,
        d0Top2Slide,
        d0DistFwd,
        recSpan1,
        recSpan2,
        recSpan3,
        recDist1,
        recDist2,
        recDist3,
        recTop31,
        recTop32,
        recTop33,
        recNear1,
        recNear2,
        recNear3,
        deadishAfter,
        epTurns: row.turns,
        survNear: row.survivalAfterNearDead,
      });
    }

    byEp.push({ cTop: epC, turns: row.turns, surv: row.survivalAfterNearDead });
  }
}

function mean(a: number[]): string {
  if (!a.length) return "n/a";
  return (a.reduce((x, y) => x + y, 0) / a.length).toFixed(4);
}

function frac(pred: (e: Ev) => boolean): string {
  if (!events.length) return "n/a";
  return ((100 * events.filter(pred).length) / events.length).toFixed(2) + "%";
}

if (maxLinesPerFile < Infinity) {
  console.log(`MERGE_HAML_MAX_LINES=${maxLinesPerFile}\n`);
}

console.log("SNAKE_PATH_INDICES =", [...PATH].join(","), "(머리=8)\n");

console.log("=== 1) merge 직후 top-end 변화 (Δ0 = t − t−1) ===");
console.log("이벤트 수:", events.length);
if (events.length) {
  console.log("평균 Δ0 top2 path distance(min):", mean(events.map((e) => e.d0Dist)));
  console.log("평균 Δ0 top2 path distance(forward pair):", mean(events.map((e) => e.d0DistFwd)));
  console.log("평균 Δ0 top3 path span:", mean(events.map((e) => e.d0Span)));
  console.log("평균 Δ0 top3 consistency(+1/-1/0):", mean(events.map((e) => e.d0Top3)));
  console.log("평균 Δ0 secondMax near-anchor head(+1/-1/0):", mean(events.map((e) => e.d0SecondNear)));
  console.log("평균 Δ0 top2 orthogonal adjacent(+1/-1/0):", mean(events.map((e) => e.d0Top2Adj)));
  console.log("평균 Δ0 one-slide top2 adjacent 가능(+1/-1/0):", mean(events.map((e) => e.d0Top2Slide)));
  console.log("직후 distMin 감소:", frac((e) => e.d0Dist < 0));
  console.log("직후 distMin 증가:", frac((e) => e.d0Dist > 0));
  console.log("직후 span 감소(촘촘):", frac((e) => e.d0Span < 0));
  console.log("직후 span 증가:", frac((e) => e.d0Span > 0));
  console.log("직후 top3 악화(true→false):", frac((e) => e.d0Top3 === -1));
  console.log("직후 top3 개선(false→true):", frac((e) => e.d0Top3 === 1));
}

console.log("\n=== 2) t+1/t+2/t+3 회복 (기준=t 직후 상태) ===");
console.log("top3 span(t+k) < span(t):", frac((e) => e.recSpan1), "/", frac((e) => e.recSpan2), "/", frac((e) => e.recSpan3));
console.log("distMin(t+k) < distMin(t):", frac((e) => e.recDist1), "/", frac((e) => e.recDist2), "/", frac((e) => e.recDist3));
console.log("top3 consistency: t에서 false → t+k에서 true:", frac((e) => e.recTop31), "/", frac((e) => e.recTop32), "/", frac((e) => e.recTop33));
console.log("secondMax near-head: t에서 false → t+k에서 true:", frac((e) => e.recNear1), "/", frac((e) => e.recNear2), "/", frac((e) => e.recNear3));

const ca = events.filter((e) => e.teType === "A").length;
const cb = events.filter((e) => e.teType === "B").length;
const cc = events.filter((e) => e.teType === "C").length;
const n = events.length || 1;
console.log("\n=== 3) top-end 이벤트 품질 (2개 이상 개선→A, 2개 이상 악화→C, 충돌·해당없음→B) ===");
console.log(`Type A: ${ca} (${((100 * ca) / n).toFixed(2)}%)`);
console.log(`Type B: ${cb} (${((100 * cb) / n).toFixed(2)}%)`);
console.log(`Type C: ${cc} (${((100 * cc) / n).toFixed(2)}%)`);

console.log("\n=== 4) 타입별 상관 (이벤트 가중, 인과 아님) ===");
for (const t of ["A", "B", "C"] as const) {
  const sub = events.filter((e) => e.teType === t);
  const da = sub.map((e) => e.deadishAfter).filter((x): x is number => x !== null);
  console.log(
    `Type ${t} (n=${sub.length}): deadish까지(post) 평균=${mean(da)} | episode turns=${mean(sub.map((e) => e.epTurns))} | survivalAfterNearDead=${mean(sub.map((e) => e.survNear ?? NaN).filter((x) => !Number.isNaN(x)))}`
  );
}

byEp.sort((a, b) => a.cTop - b.cTop);
const q = Math.max(1, Math.floor(byEp.length * 0.25));
const low = byEp.slice(0, q);
const high = byEp.slice(byEp.length - q);
const avg = (arr: typeof byEp, f: (x: (typeof byEp)[0]) => number) =>
  arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : NaN;
console.log("\n에피소드: top-end Type C 비율 하위25% vs 상위25%");
console.log(
  `  하위: n=${low.length}, 평균 C=${avg(low, (x) => x.cTop).toFixed(3)}, turns=${avg(low, (x) => x.turns).toFixed(3)}, surv=${avg(low, (x) => x.surv ?? 0).toFixed(3)}`
);
console.log(
  `  상위: n=${high.length}, 평균 C=${avg(high, (x) => x.cTop).toFixed(3)}, turns=${avg(high, (x) => x.turns).toFixed(3)}, surv=${avg(high, (x) => x.surv ?? 0).toFixed(3)}`
);

function bucketStats(lv: Ev["mergeLv"]) {
  const sub = events.filter((e) => e.mergeLv === lv);
  if (!sub.length) return null;
  const worsTop3 = sub.filter((e) => e.d0Top3 === -1).length;
  const worsSpan = sub.filter((e) => e.d0Span > 0).length;
  const worsDist = sub.filter((e) => e.d0Dist > 0).length;
  const cType = sub.filter((e) => e.teType === "C").length;
  return {
    n: sub.length,
    worsTop3: ((100 * worsTop3) / sub.length).toFixed(1),
    worsSpan: ((100 * worsSpan) / sub.length).toFixed(1),
    worsDist: ((100 * worsDist) / sub.length).toFixed(1),
    typeC: ((100 * cType) / sub.length).toFixed(1),
  };
}

console.log("\n=== 5) merge 레벨별 (슬라이드에서 관측된 최고 L+L→L+1, 없으면 maxStepOnly) ===");
for (const lv of [5, 6, 7, 8, "maxStepOnly"] as const) {
  const s = bucketStats(lv);
  if (!s) {
    console.log(`${lv}: (표본 없음)`);
    continue;
  }
  console.log(
    `${lv}: n=${s.n} | 직후 top3악화 ${s.worsTop3}% | span악화 ${s.worsSpan}% | dist악화 ${s.worsDist}% | Type C ${s.typeC}%`
  );
}

console.log("\n=== 6) 핵심 결론 (3줄) ===");
const avgSpan = events.length ? events.reduce((s, e) => s + e.d0Span, 0) / events.length : 0;
const avgTop3 = events.length ? events.reduce((s, e) => s + e.d0Top3, 0) / events.length : 0;
console.log(
  `1) top-end: 평균 Δ0(span)=${avgSpan.toFixed(4)}(음수면 촘촘), 평균 Δ0(top3코드)=${avgTop3.toFixed(4)}; distMin·보조 distFwd는 위 표 참조.`
);
console.log(
  `2) merge 직후 top3 악화 비율 ${frac((e) => e.d0Top3 === -1)}; span·dist 회복(span(t+k)<span(t))은 t+1 기준 ${frac((e) => e.recSpan1)} / ${frac((e) => e.recSpan3)}(t+3).`
);
console.log(
  `3) 질문 답: 전체 snake inversion은 본 스크립트에 없지만, top-end 전용 지표만 보면 top3는 평균·악화비가 위와 같고 span/dist는 부호가 섞이므로 “top-end만 개선” 또는 “만 악화”로 단정하지 않는다(타입 A/B/C 비율 참조).`
);

/**
 * top3 consistency true→false 전환 vs true→true 유지: pairing·생존 비교.
 * npx tsx tools/analyze-top3-break-impact.ts
 *
 * 경로·top3 정의: analyze-merge-top-end.ts 와 동일 (SNAKE_PATH_INDICES).
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
import { maxTileAtAnchor, secondMaxTile, areAdjacent, top2Gap } from "../src/sim/boardStats.ts";
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

function top3PathSpan(board: Board): number {
  const entries = PATH.map((cell, ord) => ({ cell, ord, v: board[cell]! })).filter((e) => e.v > 0);
  entries.sort((a, b) => b.v - a.v || a.ord - b.ord);
  const top = entries.slice(0, TOP_K);
  if (top.length === 0) return 0;
  const ords = top.map((e) => e.ord);
  return Math.max(...ords) - Math.min(...ords);
}

function secondMaxNearAnchorHead(board: Board): boolean {
  const sm = secondMaxTile(board);
  if (sm === 0) return false;
  for (const i of cellsAtLevel(board, sm)) {
    if (pathOrd(i) <= 2) return true;
  }
  return false;
}

type Te = {
  distMin: number;
  distFwd: number;
  top2Adj: boolean;
  top2SlideAdj: boolean;
  span3: number;
  secondNear: boolean;
};

function te(board: Board): Te {
  return {
    distMin: minTop2PathDistance(board),
    distFwd: forwardPairTop2PathDistance(board),
    top2Adj: top2OrthogonalAdjacent(board),
    top2SlideAdj: top2OneSlideOrthAdjacent(board),
    span3: top3PathSpan(board),
    secondNear: secondMaxNearAnchorHead(board),
  };
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
};

type EvRow = {
  break_: boolean;
  d0Dist: number;
  d0Fwd: number;
  d0Span: number;
  d0Adj: number;
  d0Slide: number;
  d0Near: number;
  recDist1: boolean;
  recDist2: boolean;
  recDist3: boolean;
  recAdj1: boolean;
  recAdj2: boolean;
  recAdj3: boolean;
  recSlide1: boolean;
  recSlide2: boolean;
  recSlide3: boolean;
  recNear1: boolean;
  recNear2: boolean;
  recNear3: boolean;
  neverOrthT3: boolean;
  neverSlideT3: boolean;
  deadishAfter: number | null;
  epTurns: number;
  surv: number | null;
  mergeL: 5 | 6 | 7 | 8 | null;
  gapPre: number;
  distPre: number;
};

const files: { path: string; seed: number }[] = [
  { path: "out/minimal-episodes-seed42.jsonl", seed: 42 },
  { path: "out/minimal-episodes-seed43.jsonl", seed: 43 },
  { path: "out/minimal-episodes-seed44.jsonl", seed: 44 },
  { path: "out/minimal-episodes-seed45.jsonl", seed: 45 },
];

const maxLinesPerFile = Number(process.env.MERGE_HAML_MAX_LINES ?? "0") || Infinity;

const breaks: EvRow[] = [];
const keeps: EvRow[] = [];

for (const { path: fp, seed } of files) {
  if (!fs.existsSync(fp)) continue;
  let nLine = 0;
  for (const line of fs.readFileSync(fp, "utf8").trim().split("\n")) {
    if (nLine >= maxLinesPerFile) break;
    nLine++;
    if (!line) continue;
    const row = JSON.parse(line) as Row;
    const { posts, slides } = replayEpisode(seed, row.episode, row.policy);
    if (posts.length < 5) continue;
    const fd = firstDeadishPostIndex(posts);

    for (let τ = 1; τ < posts.length - 3; τ++) {
      const pre = posts[τ - 1]!;
      const post = posts[τ]!;
      const okPre = topKOrderConsistent(pre, TOP_K);
      if (!okPre) continue;
      const okPost = topKOrderConsistent(post, TOP_K);
      const aPre = te(pre);
      const aT = te(post);
      const distT = aT.distMin;
      const bds = [posts[τ]!, posts[τ + 1]!, posts[τ + 2]!, posts[τ + 3]!];

      const ev: EvRow = {
        break_: !okPost,
        d0Dist: aT.distMin - aPre.distMin,
        d0Fwd: aT.distFwd - aPre.distFwd,
        d0Span: aT.span3 - aPre.span3,
        d0Adj: (aT.top2Adj === aPre.top2Adj ? 0 : aT.top2Adj ? 1 : -1) as number,
        d0Slide: (aT.top2SlideAdj === aPre.top2SlideAdj ? 0 : aT.top2SlideAdj ? 1 : -1) as number,
        d0Near: (aT.secondNear === aPre.secondNear ? 0 : aT.secondNear ? 1 : -1) as number,
        recDist1: te(posts[τ + 1]!).distMin < distT,
        recDist2: te(posts[τ + 2]!).distMin < distT,
        recDist3: te(posts[τ + 3]!).distMin < distT,
        recAdj1: !aT.top2Adj && top2OrthogonalAdjacent(posts[τ + 1]!),
        recAdj2: !aT.top2Adj && top2OrthogonalAdjacent(posts[τ + 2]!),
        recAdj3: !aT.top2Adj && top2OrthogonalAdjacent(posts[τ + 3]!),
        recSlide1: !aT.top2SlideAdj && top2OneSlideOrthAdjacent(posts[τ + 1]!),
        recSlide2: !aT.top2SlideAdj && top2OneSlideOrthAdjacent(posts[τ + 2]!),
        recSlide3: !aT.top2SlideAdj && top2OneSlideOrthAdjacent(posts[τ + 3]!),
        recNear1: !aT.secondNear && te(posts[τ + 1]!).secondNear,
        recNear2: !aT.secondNear && te(posts[τ + 2]!).secondNear,
        recNear3: !aT.secondNear && te(posts[τ + 3]!).secondNear,
        neverOrthT3: bds.every((b) => !top2OrthogonalAdjacent(b)),
        neverSlideT3: bds.every((b) => !top2OneSlideOrthAdjacent(b)),
        deadishAfter: fd !== null && fd >= τ ? fd - τ : null,
        epTurns: row.turns,
        surv: row.survivalAfterNearDead,
        mergeL: mergeLevelIfAny(pre, slides[τ]!),
        gapPre: top2Gap(pre),
        distPre: aPre.distMin,
      };

      if (!okPost) breaks.push(ev);
      else keeps.push(ev);
    }
  }
}

function mean(a: number[]): string {
  if (!a.length) return "n/a";
  return (a.reduce((x, y) => x + y, 0) / a.length).toFixed(4);
}

function frac(arr: EvRow[], pred: (e: EvRow) => boolean): string {
  if (!arr.length) return "n/a";
  return ((100 * arr.filter(pred).length) / arr.length).toFixed(2) + "%";
}

function reportGroup(name: string, arr: EvRow[]) {
  console.log(`\n--- ${name} (n=${arr.length}) ---`);
  if (!arr.length) return;
  console.log("Δ0 distMin 평균:", mean(arr.map((e) => e.d0Dist)));
  console.log("Δ0 distFwd 평균:", mean(arr.map((e) => e.d0Fwd)));
  console.log("Δ0 span 평균:", mean(arr.map((e) => e.d0Span)));
  console.log("Δ0 top2 orth adj (+1/0/-1) 평균:", mean(arr.map((e) => e.d0Adj)));
  console.log("Δ0 one-slide adj 평균:", mean(arr.map((e) => e.d0Slide)));
  console.log("Δ0 secondMax near-head 평균:", mean(arr.map((e) => e.d0Near)));
  console.log("직후 distMin 감소:", frac(arr, (e) => e.d0Dist < 0));
  console.log("직후 distMin 증가:", frac(arr, (e) => e.d0Dist > 0));
  console.log("직후 top2 orth True 유지/획득(Δ>=0):", frac(arr, (e) => e.d0Adj >= 0));
  console.log("직후 top2 orth 악화(1→0):", frac(arr, (e) => e.d0Adj === -1));
  console.log("회복 dist(t+k)<dist(t):", frac(arr, (e) => e.recDist1), "/", frac(arr, (e) => e.recDist2), "/", frac(arr, (e) => e.recDist3));
  console.log("회복 orth(t에서 false): t+k true:", frac(arr, (e) => e.recAdj1), "/", frac(arr, (e) => e.recAdj2), "/", frac(arr, (e) => e.recAdj3));
  console.log("회복 slide(t에서 false):", frac(arr, (e) => e.recSlide1), "/", frac(arr, (e) => e.recSlide2), "/", frac(arr, (e) => e.recSlide3));
  console.log("회복 near(t에서 false):", frac(arr, (e) => e.recNear1), "/", frac(arr, (e) => e.recNear2), "/", frac(arr, (e) => e.recNear3));
  console.log("t..t+3 한 번도 orth adj 없음:", frac(arr, (e) => e.neverOrthT3));
  console.log("t..t+3 한 번도 one-slide adj 없음:", frac(arr, (e) => e.neverSlideT3));
  const da = arr.map((e) => e.deadishAfter).filter((x): x is number => x !== null);
  console.log("deadish까지(post) 평균:", mean(da));
  console.log("episode turns 평균:", mean(arr.map((e) => e.epTurns)));
  console.log("survivalAfterNearDead 평균:", mean(arr.map((e) => e.surv ?? NaN).filter((x) => !Number.isNaN(x))));
}

if (maxLinesPerFile < Infinity) {
  console.log(`MERGE_HAML_MAX_LINES=${maxLinesPerFile}\n`);
}

console.log("이벤트: t−1에서 top3 consistency==true 인 턴만.");
console.log("  break: t에서 false | keep: t에서 true");
console.log("break n=", breaks.length, "keep n=", keeps.length);

console.log("\n=== 1) 직후 영향 비교 (Δ0 = t − t−1) ===");
reportGroup("consistency break", breaks);
reportGroup("consistency 유지 (baseline)", keeps);

console.log("\n=== 2) 1~3턴 회복률 요약 (위 표의 dist/orth/slide/near 회복 행) ===");
console.log("(break vs keep 각각 출력됨)");

console.log("\n=== 3) pairing 실패율 (t..t+3 구간) ===");
console.log("orth 한 번도 없음 — break:", frac(breaks, (e) => e.neverOrthT3), " keep:", frac(keeps, (e) => e.neverOrthT3));
console.log("one-slide 한 번도 없음 — break:", frac(breaks, (e) => e.neverSlideT3), " keep:", frac(keeps, (e) => e.neverSlideT3));

console.log("\n=== 4) 생존 (상관, 인과 아님) ===");
console.log("위 deadish·turns·surv 평균 참조");

function strata(title: string, pred: (e: EvRow) => boolean) {
  const b = breaks.filter(pred);
  const k = keeps.filter(pred);
  if (b.length + k.length < 50) return;
  console.log(`\n[${title}] break n=${b.length} keep n=${k.length}`);
  console.log(
    `  neverOrth: break ${frac(b, (e) => e.neverOrthT3)} vs keep ${frac(k, (e) => e.neverOrthT3)} | Δ0 dist 평균 break ${mean(b.map((e) => e.d0Dist))} keep ${mean(k.map((e) => e.d0Dist))}`
  );
}

console.log("\n=== 5) 조건부 (merge L, gap, distPre) ===");
strata("mergeL=5", (e) => e.mergeL === 5);
strata("mergeL=6", (e) => e.mergeL === 6);
strata("mergeL=null", (e) => e.mergeL === null);
strata("gapPre=0", (e) => e.gapPre === 0);
strata("gapPre=1", (e) => e.gapPre === 1);
strata("gapPre>=2", (e) => e.gapPre >= 2);
strata("distPre=0", (e) => e.distPre === 0);
strata("distPre=1", (e) => e.distPre === 1);
strata("distPre>=2", (e) => e.distPre >= 2);

console.log("\n=== 6) 핵심 결론 (3줄) ===");
const bd = breaks.length ? breaks.reduce((s, e) => s + e.d0Dist, 0) / breaks.length : 0;
const kd = keeps.length ? keeps.reduce((s, e) => s + e.d0Dist, 0) / keeps.length : 0;
const bo = breaks.length ? breaks.filter((e) => e.neverOrthT3).length / breaks.length : 0;
const ko = keeps.length ? keeps.filter((e) => e.neverOrthT3).length / keeps.length : 0;
console.log(
  `1) 직후 Δ0(distMin): break 평균 ${bd.toFixed(4)} vs 유지 ${kd.toFixed(4)} (부호·크기 비교만).`
);
console.log(
  `2) t..t+3 orth 없음 비율: break ${(100 * bo).toFixed(2)}% vs 유지 ${(100 * ko).toFixed(2)}%.`
);
console.log(
  `3) 붕괴가 pairing·deadish를 “항상” 망치는지는 위 수치의 차이로만 서술; 인과 단정은 하지 않는다.`
);

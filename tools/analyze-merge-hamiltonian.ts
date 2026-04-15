/**
 * high-level merge 직후 1~3턴: 해밀토니안(snake) 경로 기반 구조 지표.
 * npx tsx tools/analyze-merge-hamiltonian.ts
 *
 * 경로: scoring.SNAKE_PATH_INDICES = [8,7,6,5,4,3,2,1,0] (우하단 8이 머리)
 */
import * as fs from "node:fs";
import type { Board, Policy } from "../src/sim/types.ts";
import { spawnRandom } from "../src/sim/spawn.ts";
import { slide } from "../src/sim/slide.ts";
import { legalActions } from "../src/sim/legal.ts";
import { createRng } from "../src/sim/rng.ts";
import { makeRandomPolicy, greedyEmptyPolicy } from "../src/sim/policies.ts";
import { minimalPolicy } from "../src/sim/minimalSurvival.ts";
import { emptyBoard } from "../src/sim/simulate.ts";
import { maxTileLevel } from "../src/sim/board.ts";
import { maxTileAtAnchor } from "../src/sim/boardStats.ts";
import { inversionCountAlongSnake, SNAKE_PATH_INDICES } from "../src/sim/scoring.ts";
import { extractSurvivalFeatures, isDeadish } from "../src/sim/survivalFeatures.ts";

const ANCHOR = 8 as const;
const PATH = SNAKE_PATH_INDICES;
const TOP_K = 3;

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

function metrics(board: Board) {
  return {
    inv: inversionCountAlongSnake(board, PATH),
    top3: topKOrderConsistent(board, TOP_K),
    anchor: maxTileAtAnchor(board, ANCHOR),
    adj6: extractSurvivalFeatures(board, null).hasAdjacentPairAtOrAbove6,
  };
}

function classifyEvent(invPre: number, invSeq: number[], topPre: boolean, topSeq: boolean[]): "A" | "B" | "C" {
  const minPost = Math.min(...invSeq);
  if (minPost < invPre || (!topPre && topSeq.some(Boolean))) return "A";
  if (minPost > invPre) return "C";
  return "B";
}

type Ev = {
  type: "A" | "B" | "C";
  d0Inv: number;
  d0Top: number;
  d0Anchor: number;
  d0Adj6: number;
  invT1ltT: boolean;
  invT2ltT: boolean;
  invT3ltT: boolean;
  invT1ltPre: boolean;
  invT2ltPre: boolean;
  invT3ltPre: boolean;
  deadishAfter: number | null;
  epTurns: number;
  survNear: number | null;
};

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

function isHighLevelMergeEvent(pre: Board, slideBoard: Board, post: Board): boolean {
  if (hasMergeAtLeastLevel(pre, slideBoard, 6)) return true;
  if (maxTileLevel(post) > maxTileLevel(pre) && maxTileLevel(post) >= 6) return true;
  return false;
}

type Row = {
  policy: string;
  episode: number;
  turns: number;
  survivalAfterNearDead: number | null;
  firstNearDeadTurn: number | null;
};

const files: { path: string; seed: number }[] = [
  { path: "out/minimal-episodes-seed42.jsonl", seed: 42 },
  { path: "out/minimal-episodes-seed43.jsonl", seed: 43 },
  { path: "out/minimal-episodes-seed44.jsonl", seed: 44 },
  { path: "out/minimal-episodes-seed45.jsonl", seed: 45 },
];

/** 환경변수 없으면 전체 NDJSON 행 처리 (느릴 수 있음) */
const maxLinesPerFile = Number(process.env.MERGE_HAML_MAX_LINES ?? "0") || Infinity;

const events: Ev[] = [];
const byEp: { c: number; turns: number; surv: number | null; policy: string }[] = [];

let linesUsed = 0;
for (const { path: fp, seed } of files) {
  if (!fs.existsSync(fp)) continue;
  let nLine = 0;
  for (const line of fs.readFileSync(fp, "utf8").trim().split("\n")) {
    if (nLine >= maxLinesPerFile) break;
    nLine++;
    linesUsed++;
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

      const mPre = metrics(pre);
      const mT = metrics(post);
      const invSeq = [0, 1, 2, 3].map((k) => metrics(posts[τ + k]!).inv);
      const topSeq = [0, 1, 2, 3].map((k) => metrics(posts[τ + k]!).top3);
      const type = classifyEvent(mPre.inv, invSeq, mPre.top3, topSeq);
      if (type === "C") epC++;

      const d0Inv = mT.inv - mPre.inv;
      const d0Top = mT.top3 === mPre.top3 ? 0 : mT.top3 ? 1 : -1;
      const d0Anchor = mT.anchor - mPre.anchor;
      const d0Adj6 =
        mT.adj6 === mPre.adj6 ? 0 : mT.adj6 ? (1 as const) : (-1 as const);

      const invT = mT.inv;
      const invT1ltT = metrics(posts[τ + 1]!).inv < invT;
      const invT2ltT = metrics(posts[τ + 2]!).inv < invT;
      const invT3ltT = metrics(posts[τ + 3]!).inv < invT;
      const invT1ltPre = metrics(posts[τ + 1]!).inv < mPre.inv;
      const invT2ltPre = metrics(posts[τ + 2]!).inv < mPre.inv;
      const invT3ltPre = metrics(posts[τ + 3]!).inv < mPre.inv;

      let deadishAfter: number | null = null;
      if (fd !== null && fd >= τ) deadishAfter = fd - τ;

      events.push({
        type,
        d0Inv,
        d0Top,
        d0Anchor,
        d0Adj6,
        invT1ltT,
        invT2ltT,
        invT3ltT,
        invT1ltPre,
        invT2ltPre,
        invT3ltPre,
        deadishAfter,
        epTurns: row.turns,
        survNear: row.survivalAfterNearDead,
      });
    }

    byEp.push({ c: epC, turns: row.turns, surv: row.survivalAfterNearDead, policy: row.policy });
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
  console.log(`MERGE_HAML_MAX_LINES=${maxLinesPerFile} (파일당 최대 행 수, 0=전체)\n`);
}
console.log("해밀토니안(코드 기준) 순서 SNAKE_PATH_INDICES =", [...PATH].join(","));
console.log("(인덱스 8=우하단이 경로의 첫 칸, 0=좌상단이 마지막)\n");

console.log("=== 1) merge 직후 영향 (Δ0 = t − t−1, post-turn 보드) ===");
console.log("고레벨 merge 이벤트 수 (t..t+3 전부 존재하는 것만):", events.length);
if (events.length) {
  console.log("평균 Δ0 inversionCount:", mean(events.map((e) => e.d0Inv)));
  console.log("평균 Δ0 top3(+1/-1/0):", mean(events.map((e) => e.d0Top)));
  console.log("평균 Δ0 anchor:", mean(events.map((e) => e.d0Anchor)));
  console.log("평균 Δ0 adj6 flag(+1/-1/0):", mean(events.map((e) => e.d0Adj6)));
  console.log("직후 inversion 감소(Δ0<0):", frac((e) => e.d0Inv < 0));
  console.log("직후 inversion 증가(Δ0>0):", frac((e) => e.d0Inv > 0));
  console.log("직후 inversion 동일(Δ0=0):", frac((e) => e.d0Inv === 0));
}

console.log("\n=== 2) merge 이후 회복률 (inversion) ===");
console.log("정의: t=merge 직후 post, t−1=직전 post");
console.log("inv(t+1) < inv(t) (직후 한 턴 완화):", frac((e) => e.invT1ltT));
console.log("inv(t+2) < inv(t):", frac((e) => e.invT2ltT));
console.log("inv(t+3) < inv(t):", frac((e) => e.invT3ltT));
console.log("inv(t+1) < inv(t−1) (t−1 대비 회복):", frac((e) => e.invT1ltPre));
console.log("inv(t+2) < inv(t−1):", frac((e) => e.invT2ltPre));
console.log("inv(t+3) < inv(t−1):", frac((e) => e.invT3ltPre));

const ca = events.filter((e) => e.type === "A").length;
const cb = events.filter((e) => e.type === "B").length;
const cc = events.filter((e) => e.type === "C").length;
const n = events.length || 1;
console.log("\n=== 3) merge 품질 분포 ===");
console.log("분류: min(inv(t..t+3)) < inv(t−1) 이거나 top3가 t..t+3 중 true가 되면 A; min(...) > inv(t−1)이면 C; 그 외 B");
console.log(`Type A: ${ca} (${((100 * ca) / n).toFixed(2)}%)`);
console.log(`Type B: ${cb} (${((100 * cb) / n).toFixed(2)}%)`);
console.log(`Type C: ${cc} (${((100 * cc) / n).toFixed(2)}%)`);

console.log("\n=== 4) 타입별 deadish·에피소드 (이벤트 가중) ===");
for (const t of ["A", "B", "C"] as const) {
  const sub = events.filter((e) => e.type === t);
  const da = sub.map((e) => e.deadishAfter).filter((x): x is number => x !== null);
  console.log(
    `Type ${t} (n=${sub.length}): deadish까지 턴(이후 관측, null 제외) 평균=${mean(da)} | episode turns=${mean(sub.map((e) => e.epTurns))} | survivalAfterNearDead=${mean(sub.map((e) => e.survNear ?? NaN).filter((x) => !Number.isNaN(x)))}`
  );
}

byEp.sort((a, b) => a.c - b.c);
const q = Math.max(1, Math.floor(byEp.length * 0.25));
const low = byEp.slice(0, q);
const high = byEp.slice(byEp.length - q);
const avg = (arr: typeof byEp, f: (x: (typeof byEp)[0]) => number) =>
  arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : NaN;
console.log("\n에피소드: Type C 이벤트 수 하위25% vs 상위25% (에피소드당 C 개수 기준)");
console.log(
  `  하위: n=${low.length}, 평균 C=${avg(low, (x) => x.c).toFixed(3)}, 평균 turns=${avg(low, (x) => x.turns).toFixed(3)}, 평균 survivalAfterNearDead=${avg(low, (x) => x.surv ?? 0).toFixed(3)}`
);
console.log(
  `  상위: n=${high.length}, 평균 C=${avg(high, (x) => x.c).toFixed(3)}, 평균 turns=${avg(high, (x) => x.turns).toFixed(3)}, 평균 survivalAfterNearDead=${avg(high, (x) => x.surv ?? 0).toFixed(3)}`
);

console.log("\n=== 5) 핵심 결론 (3줄) ===");
const avgD0 = events.length ? events.reduce((s, e) => s + e.d0Inv, 0) / events.length : 0;
console.log(
  `1) 고레벨 merge 직후 평균 Δ0(inversion)=${avgD0.toFixed(4)} (음수면 스네이크 기준 위반 쌍 감소=구조 개선).`
);
console.log(
  `2) inv(t+1)<inv(t) 비율 ${events.length ? ((100 * events.filter((e) => e.invT1ltT).length) / events.length).toFixed(2) : "n/a"}%, inv(t+k)<inv(t−1)는 t+1 ${frac((e) => e.invT1ltPre)} / t+3 ${frac((e) => e.invT3ltPre)}.`
);
console.log(
  `3) A/B/C는 ${((100 * ca) / n).toFixed(1)}% / ${((100 * cb) / n).toFixed(1)}% / ${((100 * cc) / n).toFixed(1)}%; C 다발 에피소드(상위25%)는 turns·survivalAfterNearDead가 위 표와 같이 분리됨.`
);

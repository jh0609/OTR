/**
 * P0/P1 pairable 상태 run 지속시간·HL merge 전환·종료 원인.
 * npx tsx tools/analyze-pairable-persistence.ts
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
import { emptyCount, maxTileLevel } from "../src/sim/board.ts";
import { secondMaxTile, areAdjacent, top2Gap } from "../src/sim/boardStats.ts";
import { SNAKE_PATH_INDICES } from "../src/sim/scoring.ts";
import { isDeadish } from "../src/sim/survivalFeatures.ts";

const PATH = SNAKE_PATH_INDICES;
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
  for (let k = 0; k < PATH.length; k++) if (PATH[k] === cell) return k;
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

function hasMergeAtLeastLevelSlide(pre: Board, slideBoard: Board, minL: number): boolean {
  return hasMergeAtLeastLevel(pre, slideBoard, minL);
}

/** 기존 분석과 동일한 HL merge (≥6 또는 max→≥6) */
function isHighLevelMerge(pre: Board, slide: Board, post: Board): boolean {
  if (hasMergeAtLeastLevel(pre, slide, 6)) return true;
  if (maxTileLevel(post) > maxTileLevel(pre) && maxTileLevel(post) >= 6) return true;
  return false;
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

function pWeak(board: Board): boolean {
  return top2OrthogonalAdjacent(board) || top2OneSlideOrthAdjacent(board);
}

function pStrong(board: Board): boolean {
  return top2OrthogonalAdjacent(board);
}

function secondMaxNearHead(board: Board): boolean {
  const sm = secondMaxTile(board);
  if (sm === 0) return false;
  for (const i of cellsAtLevel(board, sm)) {
    if (pathOrd(i) <= 2) return true;
  }
  return false;
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

function preForPostK(posts: Board[], pre0: Board, k: number): Board {
  return k === 0 ? pre0 : posts[k - 1]!;
}

function hlAtK(posts: Board[], slides: Board[], pre0: Board, k: number): boolean {
  return isHighLevelMerge(preForPostK(posts, pre0, k), slides[k]!, posts[k]!);
}

type LossKind = "A_slide_sep" | "B_low_merge" | "C_path_drift" | "D_deadish" | "E_other";

function classifyLoss(
  posts: Board[],
  slides: Board[],
  pre0: Board,
  e: number,
  strongAtE: boolean,
  pAt: (b: Board) => boolean
): LossKind {
  if (e + 1 >= posts.length) return "E_other";
  const postE = posts[e]!;
  const postN = posts[e + 1]!;
  const preN = posts[e]!;
  const slideN = slides[e + 1]!;
  if (isDeadish(postN)) return "D_deadish";
  if (isHighLevelMerge(preN, slideN, postN)) return "E_other";
  if (strongAtE && !top2OrthogonalAdjacent(postN)) return "A_slide_sep";
  if (hasMergeAtLeastLevelSlide(preN, slideN, 1) && !hasMergeAtLeastLevelSlide(preN, slideN, 6)) {
    return "B_low_merge";
  }
  const d0 = minTop2PathDistance(postE);
  const d1 = minTop2PathDistance(postN);
  if (!pAt(postN) && d1 >= d0 + 2) return "C_path_drift";
  return "E_other";
}

type Run = {
  kind: "P0" | "P1";
  policy: string;
  s: number;
  e: number;
  dur: number;
  maxS: number;
  secondS: number;
  emptyS: number;
  deadishS: boolean;
  gapS: number;
  nearS: boolean;
  hlDuring: boolean;
  hlNext: boolean;
  conv: "during" | "next" | "none";
  end: "episode_end" | "merge_conversion" | "pair_lost" | "other";
  loss: LossKind | null;
  prepTag: "mx6" | "mx7" | "mx8p" | "other";
  deadishAfterRun: number | null;
  epTurns: number;
  surv: number | null;
};

function prepTagFromBoard(b: Board): Run["prepTag"] {
  const mx = maxTileLevel(b);
  if (mx === 6) return "mx6";
  if (mx === 7) return "mx7";
  if (mx >= 8) return "mx8p";
  return "other";
}

function extractRuns(
  p: (b: Board) => boolean,
  kind: "P0" | "P1",
  posts: Board[],
  slides: Board[],
  pre0: Board,
  policy: string,
  fd: number | null,
  epTurns: number,
  surv: number | null
): Run[] {
  const n = posts.length;
  const runs: Run[] = [];
  let s: number | null = null;
  for (let i = 0; i < n; i++) {
    const ok = p(posts[i]!);
    if (ok && s === null) s = i;
    if (!ok && s !== null) {
      runs.push(buildRun(kind, s, i - 1, p, posts, slides, pre0, policy, fd, epTurns, surv));
      s = null;
    }
  }
  if (s !== null) runs.push(buildRun(kind, s, n - 1, p, posts, slides, pre0, policy, fd, epTurns, surv));
  return runs;
}

function buildRun(
  kind: "P0" | "P1",
  s: number,
  e: number,
  p: (b: Board) => boolean,
  posts: Board[],
  slides: Board[],
  pre0: Board,
  policy: string,
  fd: number | null,
  epTurns: number,
  surv: number | null
): Run {
  const b0 = posts[s]!;
  let hlDuring = false;
  for (let k = s; k <= e; k++) {
    if (hlAtK(posts, slides, pre0, k)) {
      hlDuring = true;
      break;
    }
  }
  const hasNext = e + 1 < posts.length;
  const hlNext = hasNext ? hlAtK(posts, slides, pre0, e + 1) : false;
  let conv: Run["conv"] = "none";
  if (hlDuring) conv = "during";
  else if (hlNext) conv = "next";
  let end: Run["end"] = "other";
  let loss: LossKind | null = null;
  if (e === posts.length - 1) {
    end = "episode_end";
  } else if (!p(posts[e + 1]!)) {
    if (hlNext) {
      end = "merge_conversion";
      loss = null;
    } else {
      end = "pair_lost";
      loss = classifyLoss(
        posts,
        slides,
        pre0,
        e,
        top2OrthogonalAdjacent(posts[e]!),
        p
      );
    }
  }

  let deadishAfterRun: number | null = null;
  if (fd !== null && fd > e) deadishAfterRun = fd - e;

  return {
    kind,
    policy,
    s,
    e,
    dur: e - s + 1,
    maxS: maxTileLevel(b0),
    secondS: secondMaxTile(b0),
    emptyS: emptyCount(b0),
    deadishS: isDeadish(b0),
    gapS: top2Gap(b0),
    nearS: secondMaxNearHead(b0),
    hlDuring,
    hlNext,
    conv,
    end,
    loss,
    prepTag: prepTagFromBoard(b0),
    deadishAfterRun,
    epTurns,
    surv,
  };
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

const files: { path: string; seed: number }[] = [
  { path: "out/minimal-episodes-seed42.jsonl", seed: 42 },
  { path: "out/minimal-episodes-seed43.jsonl", seed: 43 },
  { path: "out/minimal-episodes-seed44.jsonl", seed: 44 },
  { path: "out/minimal-episodes-seed45.jsonl", seed: 45 },
];

const maxLinesPerFile = Number(process.env.MERGE_HAML_MAX_LINES ?? "0") || Infinity;

const runsP0: Run[] = [];
const runsP1: Run[] = [];
let p2WeakNextHl = 0;
let p2WeakPosts = 0;

for (const { path: fp, seed } of files) {
  if (!fs.existsSync(fp)) continue;
  let nLine = 0;
  for (const line of fs.readFileSync(fp, "utf8").trim().split("\n")) {
    if (nLine >= maxLinesPerFile) break;
    nLine++;
    if (!line) continue;
    const row = JSON.parse(line) as Row;
    const { posts, slides, pre0 } = replayEpisode(seed, row.episode, row.policy);
    if (!posts.length) continue;
    const fd = firstDeadishPostIndex(posts);
    for (let i = 0; i < posts.length; i++) {
      if (pWeak(posts[i]!)) {
        p2WeakPosts++;
        if (i + 1 < posts.length && hlAtK(posts, slides, pre0, i + 1)) p2WeakNextHl++;
      }
    }
    runsP0.push(...extractRuns(pWeak, "P0", posts, slides, pre0, row.policy, fd, row.turns, row.survivalAfterNearDead));
    runsP1.push(...extractRuns(pStrong, "P1", posts, slides, pre0, row.policy, fd, row.turns, row.survivalAfterNearDead));
  }
}

function summarize(kind: "P0" | "P1", arr: Run[]) {
  const n = arr.length || 1;
  const durs = arr.map((r) => r.dur).sort((a, b) => a - b);
  const p = (q: number) => durs[Math.min(durs.length - 1, Math.floor((q / 100) * (durs.length - 1)))] ?? 0;
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0).toFixed(4);
  console.log(`\n=== ${kind} (n=${arr.length}) ===`);
  console.log("duration 평균 / p50 / p90:", mean(durs), "/", p(50), "/", p(90));
  console.log("dur=1 비율:", ((100 * arr.filter((r) => r.dur === 1).length) / n).toFixed(2) + "%");
  console.log("dur>=2 비율:", ((100 * arr.filter((r) => r.dur >= 2).length) / n).toFixed(2) + "%");
  console.log("dur>=3 비율:", ((100 * arr.filter((r) => r.dur >= 3).length) / n).toFixed(2) + "%");
  console.log("dur>=4 비율:", ((100 * arr.filter((r) => r.dur >= 4).length) / n).toFixed(2) + "%");
  console.log("HL during run:", ((100 * arr.filter((r) => r.conv === "during").length) / n).toFixed(2) + "%");
  console.log("HL only next turn (not during):", ((100 * arr.filter((r) => r.conv === "next").length) / n).toFixed(2) + "%");
  console.log("no HL during+next:", ((100 * arr.filter((r) => r.conv === "none").length) / n).toFixed(2) + "%");
  for (const pol of ["P0-random", "P1-greedyEmpty", "P2-minimal"]) {
    const sub = arr.filter((r) => r.policy === pol);
    if (!sub.length) continue;
    const m = sub.length;
    console.log(
      `  ${pol}: n=${m} dur평균=${mean(sub.map((r) => r.dur))} dur1%=${((100 * sub.filter((r) => r.dur === 1).length) / m).toFixed(1)} convDuring%=${((100 * sub.filter((r) => r.conv === "during").length) / m).toFixed(1)}`
    );
  }
  for (const bucket of ["d1", "d2_3", "d4p"] as const) {
    const sub =
      bucket === "d1"
        ? arr.filter((r) => r.dur === 1)
        : bucket === "d2_3"
          ? arr.filter((r) => r.dur >= 2 && r.dur <= 3)
          : arr.filter((r) => r.dur >= 4);
    if (!sub.length) continue;
    const m = sub.length;
    console.log(
      `  [${bucket}] n=${m} convDuring%=${((100 * sub.filter((r) => r.conv === "during").length) / m).toFixed(1)} convNext%=${((100 * sub.filter((r) => r.conv === "next").length) / m).toFixed(1)} noConv%=${((100 * sub.filter((r) => r.conv === "none").length) / m).toFixed(1)}`
    );
  }
  const noConv = arr.filter((r) => r.conv === "none" && r.end === "pair_lost");
  const nc = noConv.length || 1;
  const endDist = ["episode_end", "merge_conversion", "pair_lost", "other"] as const;
  console.log("종료 이유 비율:");
  for (const k of endDist) {
    console.log(`  ${k}:`, ((100 * arr.filter((r) => r.end === k).length) / n).toFixed(2) + "%");
  }
  console.log("merge 없이 pair만 잃고 끝난 run (conv none & pair_lost):", noConv.length);
  const cnt = (pred: (r: Run) => boolean) => ((100 * noConv.filter(pred).length) / nc).toFixed(2);
  console.log("  loss A_slide_sep:", cnt((r) => r.loss === "A_slide_sep"));
  console.log("  loss B_low_merge:", cnt((r) => r.loss === "B_low_merge"));
  console.log("  loss C_path_drift:", cnt((r) => r.loss === "C_path_drift"));
  console.log("  loss D_deadish:", cnt((r) => r.loss === "D_deadish"));
  console.log("  loss E_other:", cnt((r) => r.loss === "E_other"));
  const cd = arr.filter((r) => r.conv === "during");
  const cn = arr.filter((r) => r.conv === "next");
  const nf = arr.filter((r) => r.conv === "none");
  console.log("좋은 run(conv during) vs 나쁜(no conv) 시작조건:");
  if (cd.length && nf.length) {
    console.log(
      `  gapS 평균 during=${mean(cd.map((r) => r.gapS))} none=${mean(nf.map((r) => r.gapS))} | empty during=${mean(cd.map((r) => r.emptyS))} none=${mean(nf.map((r) => r.emptyS))} | near% during=${((100 * cd.filter((r) => r.nearS).length) / cd.length).toFixed(1)} none=${((100 * nf.filter((r) => r.nearS).length) / nf.length).toFixed(1)}`
    );
    const da = (xs: Run[]) =>
      mean(xs.map((r) => r.deadishAfterRun).filter((x): x is number => x !== null) as number[]);
    console.log(`  deadish까지(>e) 평균 during=${da(cd)} none=${da(nf)} | epTurns during=${mean(cd.map((r) => r.epTurns))} none=${mean(nf.map((r) => r.epTurns))}`);
  }
  for (const tag of ["mx6", "mx7", "mx8p", "other"] as const) {
    const sub = arr.filter((r) => r.prepTag === tag);
    if (sub.length < 100) continue;
    const m = sub.length;
    console.log(
      `  [prep ${tag}] n=${m} dur평균=${mean(sub.map((r) => r.dur))} dur1%=${((100 * sub.filter((r) => r.dur === 1).length) / m).toFixed(1)} convDuring%=${((100 * sub.filter((r) => r.conv === "during").length) / m).toFixed(1)}`
    );
  }
}

console.log("정의:");
console.log("  P0 weak: top2 orth OR one-slide orth 가능");
console.log("  P1 strong: top2 orth만");
console.log("  HL merge: slide에서 ≥6 머지 또는 max>pre && max>=6 (기존과 동일)");
console.log("  conv during: run 구간 [s..e] 내 k에 HL(k→posts[k]) 존재");
console.log("  conv next: during 없고 HL이 e+1턴에만");
console.log("  loss (HL 없이 pair만 상실):");
console.log("    A: P1(e)였고 post e+1에서 orth 인접 소멸");
console.log("    B: slide에 L<6 머지 있고 HL 아님");
console.log("    C: pair 소실·HL 없이 minTop2PathDist +2 이상 증가");
console.log("    D: post e+1 deadish");
console.log("    E: 기타\n");

if (maxLinesPerFile < Infinity) console.log(`MERGE_HAML_MAX_LINES=${maxLinesPerFile}\n`);

console.log(
  "보조 P2 라벨: post i에서 P0 true 이고 다음 턴 HL merge →",
  p2WeakNextHl,
  "/",
  p2WeakPosts,
  "(",
  p2WeakPosts ? ((100 * p2WeakNextHl) / p2WeakPosts).toFixed(2) : "n/a",
  "%)\n"
);

summarize("P0", runsP0);
summarize("P1", runsP1);

console.log("\n=== 핵심 결론 (3줄) ===");
const p0d1 = (100 * runsP0.filter((r) => r.dur === 1).length) / (runsP0.length || 1);
const p1d1 = (100 * runsP1.filter((r) => r.dur === 1).length) / (runsP1.length || 1);
const p0c = (100 * runsP0.filter((r) => r.conv === "during").length) / (runsP0.length || 1);
console.log(
  `1) 생성(P0/P1 run 존재) 이후 지속: P0 dur=1 비율 ${p0d1.toFixed(1)}%, P1 ${p1d1.toFixed(1)}% — 상당수가 1턴 스냅샷 run.`
);
console.log(
  `2) 전환: P0 run 중 HL during ${p0c.toFixed(1)}%; dur≥4 구간은 위 세부 표에서 during 비율이 dur=1보다 높은지 비교.`
);
console.log(
  `3) 병목: dur=1 다수·noConv 비율과 loss 분포(슬라이드 분리 A 등)로 ‘유지 실패’ 비중을 읽고, during 전환율로 ‘전환’ 단계를 읽을 것(셋을 숫자로 분리).`
);

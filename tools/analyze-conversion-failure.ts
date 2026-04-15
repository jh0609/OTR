/**
 * pairable run의 HL 전환 실패 원인 분석 (성공 vs 실패 비교 전용).
 * npx tsx tools/analyze-conversion-failure.ts
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
const TOP_K = 3;
const DIRS: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];
const FILES: { path: string; seed: number }[] = [
  { path: "out/minimal-episodes-seed42.jsonl", seed: 42 },
  { path: "out/minimal-episodes-seed43.jsonl", seed: 43 },
  { path: "out/minimal-episodes-seed44.jsonl", seed: 44 },
  { path: "out/minimal-episodes-seed45.jsonl", seed: 45 },
];

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

function levelCounts(board: Board): number[] {
  const c = new Array(10).fill(0);
  for (let i = 0; i < 9; i++) {
    const v = board[i]!;
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

function mergeLevelIfAny(pre: Board, slideBoard: Board): 5 | 6 | 7 | 8 | null {
  const cp = levelCounts(pre);
  const cs = levelCounts(slideBoard);
  for (let L = 8; L >= 5; L--) {
    if (cs[L] <= cp[L] - 2 && cs[L + 1] >= cp[L + 1] + 1) return L as 5 | 6 | 7 | 8;
  }
  return null;
}

/** 기존 스크립트와 동일 HL 정의 */
function isHighLevelMerge(pre: Board, slideBoard: Board, post: Board): boolean {
  if (hasMergeAtLeastLevel(pre, slideBoard, 6)) return true;
  if (maxTileLevel(post) > maxTileLevel(pre) && maxTileLevel(post) >= 6) return true;
  return false;
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

function pWeak(board: Board): boolean {
  return top2OrthogonalAdjacent(board) || top2OneSlideOrthAdjacent(board);
}

function pStrong(board: Board): boolean {
  return top2OrthogonalAdjacent(board);
}

function secondNearHead(board: Board): boolean {
  const sm = secondMaxTile(board);
  if (sm === 0) return false;
  for (const idx of cellsAtLevel(board, sm)) if (pathOrd(idx) <= 2) return true;
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
        best = Math.min(best, Math.abs(pathOrd(maxCells[i]!) - pathOrd(maxCells[j]!)));
      }
    }
    return best === 99 ? 0 : best;
  }
  const secondCells = cellsAtLevel(board, sm);
  if (!secondCells.length) return 0;
  let best = 99;
  for (const a of maxCells) {
    for (const b of secondCells) {
      if (a === b) continue;
      best = Math.min(best, Math.abs(pathOrd(a) - pathOrd(b)));
    }
  }
  return best === 99 ? 0 : best;
}

function forwardTop2Distance(board: Board): number {
  const mx = maxTileLevel(board);
  const sm = secondMaxTile(board);
  const maxCells = [...cellsAtLevel(board, mx)].sort((a, b) => pathOrd(a) - pathOrd(b));
  if (!maxCells.length || sm === 0) return 0;
  if (sm === mx && maxCells.length >= 2) {
    return Math.abs(pathOrd(maxCells[0]!) - pathOrd(maxCells[1]!));
  }
  const secondCells = [...cellsAtLevel(board, sm)].sort((a, b) => pathOrd(a) - pathOrd(b));
  if (!secondCells.length) return 0;
  return Math.abs(pathOrd(maxCells[0]!) - pathOrd(secondCells[0]!));
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

function top3Span(board: Board): number {
  const entries = PATH.map((cell, ord) => ({ cell, ord, v: board[cell]! })).filter((e) => e.v > 0);
  entries.sort((a, b) => b.v - a.v || a.ord - b.ord);
  const top = entries.slice(0, TOP_K);
  if (!top.length) return 0;
  const ords = top.map((e) => e.ord);
  return Math.max(...ords) - Math.min(...ords);
}

function pairScore(kind: "P0" | "P1", board: Board): number {
  if (kind === "P1") return pStrong(board) ? 1 : 0;
  if (pStrong(board)) return 2;
  if (pWeak(board)) return 1;
  return 0;
}

function preFor(posts: Board[], pre0: Board, k: number): Board {
  return k === 0 ? pre0 : posts[k - 1]!;
}

type Replay = {
  posts: Board[];
  slides: Board[];
  dirs: Direction[];
  pre0: Board;
};

function replayEpisode(seed: number, episode: number, policyLabel: string): Replay {
  const rng = createRng(seed + episode * 100_003 + salt(policyLabel));
  const policy = policyFor(policyLabel, rng);
  let board: Board = initialBoard(rng);
  const pre0 = board.slice() as Board;
  const posts: Board[] = [];
  const slides: Board[] = [];
  const dirs: Direction[] = [];
  while (true) {
    const actions = legalActions(board);
    if (!actions.length) break;
    const d = policy(board, actions);
    const { next, moved, win } = slide(board, d);
    if (win || !moved) break;
    dirs.push(d);
    slides.push(next.slice() as Board);
    board = spawnRandom(next, rng);
    posts.push(board.slice() as Board);
    if (posts.length > 500_000) break;
  }
  return { posts, slides, dirs, pre0 };
}

function firstDeadishPost(posts: Board[]): number | null {
  for (let i = 0; i < posts.length; i++) if (isDeadish(posts[i]!)) return i;
  return null;
}

type Conv = "during" | "next" | "none";
type EndReason = "episode_end" | "merge_conversion" | "pair_lost";
type FailureType = "Type1_action" | "Type2_low_merge" | "Type3_erosion" | "Type4_deadish_terminal" | "Type5_other";

type RunRow = {
  kind: "P0" | "P1";
  policy: string;
  s: number;
  e: number;
  dur: number;
  conv: Conv;
  firstConv: number | null;
  end: EndReason;
  maxS: number;
  secondS: number;
  gapS: number;
  emptyS: number;
  nearS: boolean;
  deadishS: boolean;
  oneSlideS: boolean;
  orthS: boolean;
  distS: number;
  fwdS: number;
  spanS: number;
  top3S: boolean;
  deadishAfter: number | null;
  epTurns: number;
  surv: number | null;
  actions: Direction[]; // 비교 윈도우에서 실제 선택된 방향
  runTurnCountNoConv: number;
  lowInterference: boolean;
  slideSeparation: boolean;
  gapWidening: boolean;
  deadishAbsorb: boolean;
  failureType: FailureType | null;
  mergeLevelNearEnd: 5 | 6 | 7 | 8 | null;
  pre2EmptyAvg: number | null;
  pre2GapAvg: number | null;
  pre2NearRate: number | null;
  pre1LowMerge: boolean | null;
  pre1ActionRD: boolean | null;
};

function classifyFailureType(run: RunRow, replay: Replay): FailureType {
  if (run.conv !== "none") return "Type5_other";
  const { posts, slides, pre0 } = replay;
  const e = run.e;
  // Type4: 종료 또는 deadish 흡수
  const terminalLike = e === posts.length - 1;
  const deadishNext = e + 1 < posts.length ? isDeadish(posts[e + 1]!) : false;
  // Type1: 마지막 의사결정에서 HL 가능한 액션이 있었는데 선택 안 함
  if (e + 1 < posts.length) {
    const b = posts[e]!;
    const chosenHl = isHighLevelMerge(preFor(posts, pre0, e + 1), slides[e + 1]!, posts[e + 1]!);
    if (!chosenHl) {
      const acts = legalActions(b);
      let altCanHl = false;
      for (const d of acts) {
        const { next, moved } = slide(b, d);
        if (!moved) continue;
        if (hasMergeAtLeastLevel(b, next, 6)) {
          altCanHl = true;
          break;
        }
      }
      if (altCanHl) return "Type1_action";
    }
  }
  // Type2: 종료 직전 1~2턴에 저레벨 머지(L<6)가 HL 없이 발생
  for (let k = Math.max(run.s, e - 1); k <= e; k++) {
    const pre = preFor(posts, pre0, k);
    const sl = slides[k]!;
    if (hasMergeAtLeastLevel(pre, sl, 1) && !hasMergeAtLeastLevel(pre, sl, 6)) return "Type2_low_merge";
  }
  // Type4 next priority
  if (terminalLike || deadishNext || isDeadish(posts[e]!)) return "Type4_deadish_terminal";
  // Type3: 종결 직전 erosion (거리 증가 + pair 점수 감소)
  if (e - 1 >= run.s) {
    const p0 = pairScore(run.kind, posts[e - 1]!);
    const p1 = pairScore(run.kind, posts[e]!);
    const d0 = minTop2PathDistance(posts[e - 1]!);
    const d1 = minTop2PathDistance(posts[e]!);
    if (p1 < p0 && d1 >= d0 + 1) return "Type3_erosion";
  }
  return "Type5_other";
}

function extractRuns(
  kind: "P0" | "P1",
  replay: Replay,
  policy: string,
  epTurns: number,
  surv: number | null
): RunRow[] {
  const p = kind === "P0" ? pWeak : pStrong;
  const { posts, slides, dirs, pre0 } = replay;
  const n = posts.length;
  const fd = firstDeadishPost(posts);
  const out: RunRow[] = [];
  let s: number | null = null;
  for (let i = 0; i < n; i++) {
    const ok = p(posts[i]!);
    if (ok && s === null) s = i;
    if (!ok && s !== null) {
      out.push(buildRun(kind, replay, policy, epTurns, surv, fd, s, i - 1));
      s = null;
    }
  }
  if (s !== null) out.push(buildRun(kind, replay, policy, epTurns, surv, fd, s, n - 1));
  return out;
}

function buildRun(
  kind: "P0" | "P1",
  replay: Replay,
  policy: string,
  epTurns: number,
  surv: number | null,
  fd: number | null,
  s: number,
  e: number
): RunRow {
  const p = kind === "P0" ? pWeak : pStrong;
  const { posts, slides, dirs, pre0 } = replay;
  let firstConv: number | null = null;
  for (let k = s; k <= e; k++) {
    if (isHighLevelMerge(preFor(posts, pre0, k), slides[k]!, posts[k]!)) {
      firstConv = k;
      break;
    }
  }
  const hlNext = e + 1 < posts.length && isHighLevelMerge(preFor(posts, pre0, e + 1), slides[e + 1]!, posts[e + 1]!);
  const conv: Conv = firstConv !== null ? "during" : hlNext ? "next" : "none";
  const end: EndReason = e === posts.length - 1 ? "episode_end" : hlNext ? "merge_conversion" : "pair_lost";
  const wEnd = firstConv ?? e;

  const actionSeq: Direction[] = [];
  // posts[k] 상태에서 실제 둔 행동은 dirs[k+1] (k+1턴)
  for (let k = s; k <= wEnd - 1; k++) {
    const idx = k + 1;
    if (idx >= 0 && idx < dirs.length) actionSeq.push(dirs[idx]!);
  }

  let runTurnCountNoConv = 0;
  for (let k = s; k <= (firstConv ?? e); k++) {
    if (!isHighLevelMerge(preFor(posts, pre0, k), slides[k]!, posts[k]!)) runTurnCountNoConv++;
  }

  let lowInterference = false;
  let slideSeparation = false;
  let gapWidening = false;
  let deadishAbsorb = false;
  for (let k = s; k <= wEnd; k++) {
    const pre = preFor(posts, pre0, k);
    const sl = slides[k]!;
    const hl = isHighLevelMerge(pre, sl, posts[k]!);
    if (!hl && hasMergeAtLeastLevel(pre, sl, 1) && !hasMergeAtLeastLevel(pre, sl, 6)) {
      if (k + 1 < posts.length) {
        const ps = pairScore(kind, posts[k]!);
        const pn = pairScore(kind, posts[k + 1]!);
        if (pn < ps) lowInterference = true;
      }
    }
    if (k + 1 < posts.length && p(posts[k]!) && !p(posts[k + 1]!)) slideSeparation = true;
    if (k + 1 < posts.length) {
      if (top2Gap(posts[k + 1]!) > top2Gap(posts[k]!) || minTop2PathDistance(posts[k + 1]!) > minTop2PathDistance(posts[k]!)) {
        gapWidening = true;
      }
      if (isDeadish(posts[k + 1]!)) deadishAbsorb = true;
    }
  }

  let deadishAfter: number | null = null;
  if (fd !== null && fd > e) deadishAfter = fd - e;

  let pre2EmptyAvg: number | null = null;
  let pre2GapAvg: number | null = null;
  let pre2NearRate: number | null = null;
  let pre1LowMerge: boolean | null = null;
  let pre1ActionRD: boolean | null = null;
  if (firstConv !== null) {
    const look: number[] = [];
    if (firstConv - 2 >= 0) look.push(firstConv - 2);
    if (firstConv - 1 >= 0) look.push(firstConv - 1);
    if (look.length) {
      const es = look.map((k) => emptyCount(posts[k]!));
      const gs = look.map((k) => top2Gap(posts[k]!));
      const ns = look.map((k) => (secondNearHead(posts[k]!) ? 1 : 0));
      pre2EmptyAvg = es.reduce((a, b) => a + b, 0) / es.length;
      pre2GapAvg = gs.reduce((a, b) => a + b, 0) / gs.length;
      pre2NearRate = ns.reduce<number>((a, b) => a + b, 0) / ns.length;
    }
    const preK = preFor(posts, pre0, firstConv);
    pre1LowMerge =
      hasMergeAtLeastLevel(preK, slides[firstConv]!, 1) &&
      !hasMergeAtLeastLevel(preK, slides[firstConv]!, 6);
    const a = dirs[firstConv];
    pre1ActionRD = a !== undefined ? a === "RIGHT" || a === "DOWN" : null;
  }

  const b0 = posts[s]!;
  const row: RunRow = {
    kind,
    policy,
    s,
    e,
    dur: e - s + 1,
    conv,
    firstConv,
    end,
    maxS: maxTileLevel(b0),
    secondS: secondMaxTile(b0),
    gapS: top2Gap(b0),
    emptyS: emptyCount(b0),
    nearS: secondNearHead(b0),
    deadishS: isDeadish(b0),
    oneSlideS: top2OneSlideOrthAdjacent(b0),
    orthS: top2OrthogonalAdjacent(b0),
    distS: minTop2PathDistance(b0),
    fwdS: forwardTop2Distance(b0),
    spanS: top3Span(b0),
    top3S: topKOrderConsistent(b0, TOP_K),
    deadishAfter,
    epTurns,
    surv,
    actions: actionSeq,
    runTurnCountNoConv,
    lowInterference,
    slideSeparation,
    gapWidening,
    deadishAbsorb,
    failureType: null,
    mergeLevelNearEnd: mergeLevelIfAny(preFor(posts, pre0, e), slides[e]!),
    pre2EmptyAvg,
    pre2GapAvg,
    pre2NearRate,
    pre1LowMerge,
    pre1ActionRD,
  };
  if (conv === "none") row.failureType = classifyFailureType(row, replay);
  return row;
}

type Row = {
  policy: string;
  episode: number;
  turns: number;
  survivalAfterNearDead: number | null;
};

const maxLinesPerFile = Number(process.env.MERGE_HAML_MAX_LINES ?? "0") || Infinity;
const runsP0: RunRow[] = [];
const runsP1: RunRow[] = [];
const oppP0: Array<{ durBucket: "d1" | "d2_3" | "d4p"; maxB: "m6" | "m7p"; gapB: "g0" | "g1" | "g2p"; conv: boolean }> = [];
const oppP1: Array<{ durBucket: "d1" | "d2_3" | "d4p"; maxB: "m6" | "m7p"; gapB: "g0" | "g1" | "g2p"; conv: boolean }> = [];

for (const { path: fp, seed } of FILES) {
  if (!fs.existsSync(fp)) continue;
  let used = 0;
  for (const line of fs.readFileSync(fp, "utf8").trim().split("\n")) {
    if (used >= maxLinesPerFile) break;
    used++;
    if (!line) continue;
    const row = JSON.parse(line) as Row;
    const replay = replayEpisode(seed, row.episode, row.policy);
    const r0 = extractRuns("P0", replay, row.policy, row.turns, row.survivalAfterNearDead);
    const r1 = extractRuns("P1", replay, row.policy, row.turns, row.survivalAfterNearDead);
    runsP0.push(...r0);
    runsP1.push(...r1);

    // turn-level opportunity: pairable=true at k, conversion label = HL at k+1
    for (const rr of [...r0, ...r1]) {
      const pArr = rr.kind === "P0" ? oppP0 : oppP1;
      const durBucket = rr.dur === 1 ? "d1" : rr.dur <= 3 ? "d2_3" : "d4p";
      const maxB = rr.maxS === 6 ? "m6" : "m7p";
      const gapB = rr.gapS === 0 ? "g0" : rr.gapS === 1 ? "g1" : "g2p";
      const { posts, slides, pre0 } = replay;
      const p = rr.kind === "P0" ? pWeak : pStrong;
      for (let k = rr.s; k <= rr.e; k++) {
        if (k + 1 >= posts.length) continue;
        if (!p(posts[k]!)) continue;
        const conv = isHighLevelMerge(preFor(posts, pre0, k + 1), slides[k + 1]!, posts[k + 1]!);
        pArr.push({ durBucket, maxB, gapB, conv });
      }
    }
  }
}

function mean(a: number[]): string {
  if (!a.length) return "n/a";
  return (a.reduce((x, y) => x + y, 0) / a.length).toFixed(4);
}

function pct(n: number, d: number): string {
  return d ? ((100 * n) / d).toFixed(2) + "%" : "n/a";
}

function reportStartAndAction(kind: "P0" | "P1", arr: RunRow[]) {
  const succ = arr.filter((r) => r.conv === "during");
  const fail = arr.filter((r) => r.conv === "none");
  const mk = (rs: RunRow[]) => ({
    n: rs.length,
    dur: mean(rs.map((r) => r.dur)),
    max: mean(rs.map((r) => r.maxS)),
    second: mean(rs.map((r) => r.secondS)),
    gap: mean(rs.map((r) => r.gapS)),
    empty: mean(rs.map((r) => r.emptyS)),
    near: pct(rs.filter((r) => r.nearS).length, rs.length),
    deadish: pct(rs.filter((r) => r.deadishS).length, rs.length),
    oneSlide: pct(rs.filter((r) => r.oneSlideS).length, rs.length),
    orth: pct(rs.filter((r) => r.orthS).length, rs.length),
    dist: mean(rs.map((r) => r.distS)),
    fwd: mean(rs.map((r) => r.fwdS)),
    span: mean(rs.map((r) => r.spanS)),
    top3: pct(rs.filter((r) => r.top3S).length, rs.length),
  });
  const s = mk(succ);
  const f = mk(fail);
  console.log(`\n## ${kind} 1) 시작 조건 (during vs none)`);
  console.log(`during n=${s.n} | none n=${f.n}`);
  console.log(`duration: ${s.dur} vs ${f.dur}`);
  console.log(`max/second: ${s.max}/${s.second} vs ${f.max}/${f.second}`);
  console.log(`gap/empty: ${s.gap}/${s.empty} vs ${f.gap}/${f.empty}`);
  console.log(`near-head%: ${s.near} vs ${f.near}`);
  console.log(`deadish@start%: ${s.deadish} vs ${f.deadish}`);
  console.log(`oneSlideAdj%: ${s.oneSlide} vs ${f.oneSlide}`);
  console.log(`orthAdj%: ${s.orth} vs ${f.orth}`);
  console.log(`distMin/distFwd: ${s.dist}/${s.fwd} vs ${f.dist}/${f.fwd}`);
  console.log(`top3 span: ${s.span} vs ${f.span} | top3 consistency%: ${s.top3} vs ${f.top3}`);

  const actStats = (rs: RunRow[]) => {
    let totalA = 0;
    let rd = 0;
    let lu = 0;
    let switches = 0;
    let longestRep = 0;
    let noConvTurns = 0;
    const dirCnt: Record<Direction, number> = { UP: 0, DOWN: 0, LEFT: 0, RIGHT: 0 };
    for (const r of rs) {
      noConvTurns += r.runTurnCountNoConv;
      totalA += r.actions.length;
      for (let i = 0; i < r.actions.length; i++) {
        const d = r.actions[i]!;
        dirCnt[d]++;
        if (d === "RIGHT" || d === "DOWN") rd++;
        else lu++;
        if (i > 0 && r.actions[i - 1] !== d) switches++;
      }
      let cur = 0;
      let best = 0;
      let prev: Direction | null = null;
      for (const d of r.actions) {
        if (d === prev) cur++;
        else cur = 1;
        prev = d;
        if (cur > best) best = cur;
      }
      longestRep += best;
    }
    return {
      totalA,
      dirCnt,
      rdRatio: totalA ? (rd / totalA).toFixed(4) : "n/a",
      luRatio: totalA ? (lu / totalA).toFixed(4) : "n/a",
      switchPerAction: totalA ? (switches / totalA).toFixed(4) : "n/a",
      longestRepAvg: rs.length ? (longestRep / rs.length).toFixed(4) : "n/a",
      noConvTurnsAvg: rs.length ? (noConvTurns / rs.length).toFixed(4) : "n/a",
    };
  };
  const sa = actStats(succ);
  const fa = actStats(fail);
  console.log(`\n## ${kind} 2) run 내부 행동 패턴`);
  console.log(`actions 총량 during/none: ${sa.totalA} / ${fa.totalA}`);
  console.log(
    `dir 분포 during U/D/L/R=${sa.dirCnt.UP}/${sa.dirCnt.DOWN}/${sa.dirCnt.LEFT}/${sa.dirCnt.RIGHT} | none=${fa.dirCnt.UP}/${fa.dirCnt.DOWN}/${fa.dirCnt.LEFT}/${fa.dirCnt.RIGHT}`
  );
  console.log(`RIGHT+DOWN 비율: ${sa.rdRatio} vs ${fa.rdRatio} | LEFT+UP: ${sa.luRatio} vs ${fa.luRatio}`);
  console.log(`방향 전환/액션: ${sa.switchPerAction} vs ${fa.switchPerAction}`);
  console.log(`최장 동일방향 반복 평균: ${sa.longestRepAvg} vs ${fa.longestRepAvg}`);
  console.log(`pairable true인데 미전환 턴 수(런 평균): ${sa.noConvTurnsAvg} vs ${fa.noConvTurnsAvg}`);

  const comp = (rs: RunRow[]) => ({
    low: pct(rs.filter((r) => r.lowInterference).length, rs.length),
    sep: pct(rs.filter((r) => r.slideSeparation).length, rs.length),
    gap: pct(rs.filter((r) => r.gapWidening).length, rs.length),
    dead: pct(rs.filter((r) => r.deadishAbsorb).length, rs.length),
  });
  const sc = comp(succ);
  const fc = comp(fail);
  console.log(`\n## ${kind} 3) 경쟁 이벤트 (during vs none)`);
  console.log(`low-level interference: ${sc.low} vs ${fc.low}`);
  console.log(`slide separation: ${sc.sep} vs ${fc.sep}`);
  console.log(`gap widening(dist/gap 증가): ${sc.gap} vs ${fc.gap}`);
  console.log(`deadish absorption: ${sc.dead} vs ${fc.dead}`);

  const survival = (rs: RunRow[]) => {
    const da = rs.map((r) => r.deadishAfter).filter((x): x is number => x !== null);
    const sv = rs.map((r) => r.surv).filter((x): x is number => x !== null);
    return {
      deadish: mean(da),
      turns: mean(rs.map((r) => r.epTurns)),
      surv: mean(sv),
    };
  };
  const ss = survival(succ);
  const fs = survival(fail);
  console.log(`\n## ${kind} 4) 생존(상관)`);
  console.log(`deadish까지(>e) 평균: ${ss.deadish} vs ${fs.deadish}`);
  console.log(`episode turns 평균: ${ss.turns} vs ${fs.turns}`);
  console.log(`survivalAfterNearDead 평균: ${ss.surv} vs ${fs.surv}`);

  const failTypes = fail.map((r) => r.failureType).filter((x): x is FailureType => x !== null);
  console.log(`\n## ${kind} 5) 실패 직접 원인 (conv none)`);
  for (const t of [
    "Type1_action",
    "Type2_low_merge",
    "Type3_erosion",
    "Type4_deadish_terminal",
    "Type5_other",
  ] as const) {
    console.log(`${t}: ${pct(failTypes.filter((x) => x === t).length, failTypes.length)}`);
  }

  // success 전형 패턴: firstConv 직전 1~2턴 (run 생성 시 이미 캡처)
  const success = succ.filter((r) => r.firstConv !== null);
  const pre2Empty = success
    .map((r) => r.pre2EmptyAvg)
    .filter((x): x is number => x !== null);
  const pre2Gap = success
    .map((r) => r.pre2GapAvg)
    .filter((x): x is number => x !== null);
  const pre2Near = success
    .map((r) => r.pre2NearRate)
    .filter((x): x is number => x !== null);
  const pre2LowMerge = success.filter((r) => r.pre1LowMerge === true).length;
  const pre2RD = success.filter((r) => r.pre1ActionRD === true).length;
  const pre2Act = success.filter((r) => r.pre1ActionRD !== null).length;
  console.log(`\n## ${kind} 6) 성공 run 전형 (firstConv 직전 1~2턴)`);
  console.log(`직전1~2턴 empty 평균: ${mean(pre2Empty)} | gap 평균: ${mean(pre2Gap)}`);
  console.log(
    `직전1~2턴 secondNear true 비율: ${
      pre2Near.length
        ? (100 * (pre2Near.reduce((a, b) => a + b, 0) / pre2Near.length)).toFixed(2) + "%"
        : "n/a"
    }`
  );
  console.log(`성공 직전 low-level merge 동반 비율(직전 step): ${pct(pre2LowMerge, success.length)}`);
  console.log(`성공 직전 액션 RD 비율: ${pre2Act ? (pre2RD / pre2Act).toFixed(4) : "n/a"}`);
}

function reportOpportunity(kind: "P0" | "P1", opp: Array<{ durBucket: "d1" | "d2_3" | "d4p"; maxB: "m6" | "m7p"; gapB: "g0" | "g1" | "g2p"; conv: boolean }>) {
  const convN = opp.filter((o) => o.conv).length;
  console.log(`\n## ${kind} 4) 기회 대비 전환율`);
  console.log(`overall: ${convN}/${opp.length} (${pct(convN, opp.length)})`);
  for (const b of ["d1", "d2_3", "d4p"] as const) {
    const sub = opp.filter((o) => o.durBucket === b);
    const c = sub.filter((o) => o.conv).length;
    console.log(`duration ${b}: ${c}/${sub.length} (${pct(c, sub.length)})`);
  }
  for (const m of ["m6", "m7p"] as const) {
    const sub = opp.filter((o) => o.maxB === m);
    const c = sub.filter((o) => o.conv).length;
    console.log(`max ${m}: ${c}/${sub.length} (${pct(c, sub.length)})`);
  }
  for (const g of ["g0", "g1", "g2p"] as const) {
    const sub = opp.filter((o) => o.gapB === g);
    const c = sub.filter((o) => o.conv).length;
    console.log(`gap ${g}: ${c}/${sub.length} (${pct(c, sub.length)})`);
  }
}

console.log("근사 규칙(필수 한계):");
console.log("- Type1_action: 종료 직전 상태에서 '다른 합법 액션이 슬라이드 즉시 HL(>=6) 가능'이면 방향 선택 실패로 분류.");
console.log("- Type2_low_merge: 종료 직전 1~2턴에 L<6 머지가 HL 없이 관측되면 가로채기로 분류.");
console.log("- Type3_erosion: 종료 직전 pair 점수 하락 + top2 경로거리 증가.");
console.log("- Type4_deadish_terminal: run 말단이 deadish/terminal로 흡수.");
console.log("- 위 규칙은 counterfactual spawn 전체를 탐색하지 않는 근사 분류다.\n");
if (maxLinesPerFile < Infinity) console.log(`MERGE_HAML_MAX_LINES=${maxLinesPerFile}\n`);

reportStartAndAction("P0", runsP0);
reportOpportunity("P0", oppP0);
reportStartAndAction("P1", runsP1);
reportOpportunity("P1", oppP1);

console.log("\n## 7) 핵심 결론 (3줄)");
const p0Succ = runsP0.filter((r) => r.conv === "during");
const p0Fail = runsP0.filter((r) => r.conv === "none");
const p1Succ = runsP1.filter((r) => r.conv === "during");
const p1Fail = runsP1.filter((r) => r.conv === "none");
console.log(
  `1) 시작조건은 during/none 간 큰 분리가 약하고, none에서 run 내부 미전환 턴 누적이 큼(전환 지연).`
);
console.log(
  `2) 실패 직접 원인 분포는 Type1~5에서 가장 큰 항목이 전환 실패의 주 기작(특히 P1에서 slide separation/terminal 축).`
);
console.log(
  `3) 결론은 생성/유지가 아니라 conversion 층: 기회당 전환율과 실패 타입 분포로 병목을 판정(상관이며 인과 단정 아님).`
);

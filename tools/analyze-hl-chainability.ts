/**
 * HL merge 직후(post-turn) 상태에서 다음 HL merge까지의 chainability 분석.
 * npx tsx tools/analyze-hl-chainability.ts
 *
 * HL 정의: slide에서 ≥6 merge 또는 maxTile 증가 && 결과 max ≥6 (기존 분석과 동일)
 * chain start: HL이 발생한 턴 τ의 post-turn 보드 posts[τ]
 * 다음 HL: τ < j 에서 최초로 HL이 다시 발생한 턴 j; Δ = j − τ
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
import { isDeadish } from "../src/sim/survivalFeatures.ts";

const PATH = SNAKE_PATH_INDICES;
const TOP_K = 3;
const DIRS: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];

const N = Math.max(1, Number(process.env.SIM_MINIMAL_N ?? "2000"));
const SEEDS = (process.env.SIM_MINIMAL_SEEDS ?? "42,43")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const POLICY_LABEL = process.env.CHAIN_POLICY ?? "P2-minimal";

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

/** L+L→L+1, L∈[5,8] 중 가장 높은 L부터 매칭 */
function mergeLevelIfAny(pre: Board, slideBoard: Board): 5 | 6 | 7 | 8 | null {
  const cp = levelCounts(pre);
  const cs = levelCounts(slideBoard);
  for (let L = 8; L >= 5; L--) {
    if (cs[L] <= cp[L] - 2 && cs[L + 1] >= cp[L + 1] + 1) return L as 5 | 6 | 7 | 8;
  }
  return null;
}

/** 저레벨 merge: L≤4 인 두 L이 합쳐짐 */
function hasLowLevelMerge(pre: Board, slideBoard: Board): boolean {
  const cp = levelCounts(pre);
  const cs = levelCounts(slideBoard);
  for (let L = 1; L <= 4; L++) {
    if (cs[L] <= cp[L] - 2 && cs[L + 1] >= cp[L + 1] + 1) return true;
  }
  return false;
}

function isHighLevelMergeEvent(pre: Board, slideBoard: Board, post: Board): boolean {
  if (hasMergeAtLeastLevel(pre, slideBoard, 6)) return true;
  if (maxTileLevel(post) > maxTileLevel(pre) && maxTileLevel(post) >= 6) return true;
  return false;
}

function pathOrd(cell: number): number {
  for (let k = 0; k < PATH.length; k++) if (PATH[k] === cell) return k;
  return -1;
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

function secondMaxNearHead(board: Board): boolean {
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

type StartMetrics = {
  maxT: number;
  secondM: number;
  gap: number;
  empty: number;
  secondNear: boolean;
  distMin: number;
  span3: number;
  top3ok: boolean;
  orth: boolean;
  oneSlide: boolean;
};

function startSnapshot(board: Board): StartMetrics {
  return {
    maxT: maxTileLevel(board),
    secondM: secondMaxTile(board),
    gap: gapOf(board),
    empty: emptyCount(board),
    secondNear: secondMaxNearHead(board),
    distMin: minTop2PathDistance(board),
    span3: top3PathSpan(board),
    top3ok: topKOrderConsistent(board, TOP_K),
    orth: top2OrthogonalAdjacent(board),
    oneSlide: top2OneSlideOrthAdjacent(board),
  };
}

function pairable(board: Board): boolean {
  return top2OrthogonalAdjacent(board) || top2OneSlideOrthAdjacent(board);
}

function preForTurn(posts: Board[], pre0: Board, τ: number): Board {
  return τ === 0 ? pre0 : posts[τ - 1]!;
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

type HlKind = "5to6" | "6to7" | "7to8" | "other";

function hlMergeKind(pre: Board, slideBoard: Board, post: Board): HlKind {
  const ml = mergeLevelIfAny(pre, slideBoard);
  if (ml === 5) return "5to6";
  if (ml === 6) return "6to7";
  if (ml === 7) return "7to8";
  if (isHighLevelMergeEvent(pre, slideBoard, post)) return "other";
  return "other";
}

type FailKind = "A" | "B" | "C" | "D" | "E";

/** no-chain 종료: 우선순위 D > B > C > A > E
 * 전 구간 스캔 시 대부분 결국 deadish에 도달하므로, τ 이후 **초기 윈도우**만 본다(근사).
 * WINDOW: τ+1 .. τ+WIN (WIN=24), 상한 T.
 */
const FAIL_CLASS_WIN = 24;
const DEADISH_NEAR_TURNS = 14;

function classifyNoChain(
  posts: Board[],
  slides: Board[],
  pre0: Board,
  τ: number,
  T: number
): FailKind {
  const start = posts[τ]!;
  const g0 = gapOf(start);
  const tLim = Math.min(T, τ + FAIL_CLASS_WIN);

  let firstDeadishAfter: number | null = null;
  let llMergeCount = 0;
  let maxGap = g0;
  let pairableCount = 0;
  let postCount = 0;

  for (let t = τ + 1; t <= tLim; t++) {
    const pre = preForTurn(posts, pre0, t);
    const sl = slides[t]!;
    const po = posts[t]!;
    if (firstDeadishAfter === null && isDeadish(po)) firstDeadishAfter = t;
    if (hasLowLevelMerge(pre, sl)) llMergeCount++;
    maxGap = Math.max(maxGap, gapOf(po));
    pairableCount += pairable(po) ? 1 : 0;
    postCount++;
  }

  if (firstDeadishAfter !== null && firstDeadishAfter - τ <= DEADISH_NEAR_TURNS) return "D";
  if (llMergeCount >= 2) return "B";
  if (maxGap >= g0 + 2) return "C";
  if (postCount > 0 && pairableCount / postCount < 0.15) return "A";
  return "E";
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx]!;
}

function mean(a: number[]): number {
  if (a.length === 0) return NaN;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

type EvRow = {
  τ: number;
  kind: HlKind;
  chained: boolean;
  delta: number | null;
  start: StartMetrics;
};

const events: EvRow[] = [];
const deltas: number[] = [];
const failByKind: Record<FailKind, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };

const succStarts: StartMetrics[] = [];
const failStarts: StartMetrics[] = [];

/** chain 구간(τ+1 .. j-1) 또는 실패 시 τ+1 .. min(τ+5,T) */
const succPairRate: number[] = [];
const failPairRate: number[] = [];
const succGapDelta: number[] = [];
const failGapDelta: number[] = [];
const succDistDelta: number[] = [];
const failDistDelta: number[] = [];

const byKind: Record<HlKind, { total: number; chained: number; deltas: number[] }> = {
  "5to6": { total: 0, chained: 0, deltas: [] },
  "6to7": { total: 0, chained: 0, deltas: [] },
  "7to8": { total: 0, chained: 0, deltas: [] },
  other: { total: 0, chained: 0, deltas: [] },
};

console.log(`SIM_MINIMAL_N=${N} SIM_MINIMAL_SEEDS=${SEEDS.join(",")} CHAIN_POLICY=${POLICY_LABEL}`);

for (const seed of SEEDS) {
  for (let episode = 0; episode < N; episode++) {
    const { posts, slides, pre0 } = replayEpisode(seed, episode, POLICY_LABEL);
    const T = posts.length - 1;
    if (T < 0) continue;

    for (let τ = 0; τ <= T; τ++) {
      const pre = preForTurn(posts, pre0, τ);
      const slideBoard = slides[τ]!;
      const post = posts[τ]!;
      if (!isHighLevelMergeEvent(pre, slideBoard, post)) continue;

      const kind = hlMergeKind(pre, slideBoard, post);
      const start = startSnapshot(post);
      byKind[kind].total++;

      let j: number | null = null;
      for (let t = τ + 1; t <= T; t++) {
        const p2 = preForTurn(posts, pre0, t);
        const s2 = slides[t]!;
        const po2 = posts[t]!;
        if (isHighLevelMergeEvent(p2, s2, po2)) {
          j = t;
          break;
        }
      }

      const chained = j !== null;
      const delta = chained ? j! - τ : null;

      if (chained && delta !== null) {
        deltas.push(delta);
        byKind[kind].chained++;
        byKind[kind].deltas.push(delta);

        succStarts.push(start);
        const j0 = j!;
        let prSum = 0;
        let prN = 0;
        let g0 = start.gap;
        let d0 = start.distMin;
        for (let t = τ + 1; t < j0; t++) {
          const pb = posts[t]!;
          prSum += pairable(pb) ? 1 : 0;
          prN++;
        }
        if (prN > 0) succPairRate.push(prSum / prN);
        if (j0 - 1 >= τ + 1) {
          const mid = posts[j0 - 1]!;
          succGapDelta.push(gapOf(mid) - g0);
          succDistDelta.push(minTop2PathDistance(mid) - d0);
        }
      } else {
        failStarts.push(start);
        const fk = classifyNoChain(posts, slides, pre0, τ, T);
        failByKind[fk]++;

        const tEnd = Math.min(T, τ + 5);
        let prSum = 0;
        let prN = 0;
        let g0 = start.gap;
        let d0 = start.distMin;
        for (let t = τ + 1; t <= tEnd; t++) {
          const pb = posts[t]!;
          prSum += pairable(pb) ? 1 : 0;
          prN++;
        }
        if (prN > 0) failPairRate.push(prSum / prN);
        if (tEnd >= τ + 1) {
          const mid = posts[tEnd]!;
          failGapDelta.push(gapOf(mid) - g0);
          failDistDelta.push(minTop2PathDistance(mid) - d0);
        }
      }

      events.push({ τ, kind, chained, delta, start });
    }
  }
}

const totalHl = events.length;
const chainedCount = events.filter((e) => e.chained).length;
const noChainCount = totalHl - chainedCount;
const noChainRate = totalHl > 0 ? (100 * noChainCount) / totalHl : 0;

const dist = { b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6_10: 0, b11_20: 0, b21_30: 0, b31p: 0 };
for (const d of deltas) {
  if (d === 1) dist.b1++;
  else if (d === 2) dist.b2++;
  else if (d === 3) dist.b3++;
  else if (d === 4) dist.b4++;
  else if (d === 5) dist.b5++;
  else if (d <= 10) dist.b6_10++;
  else if (d <= 20) dist.b11_20++;
  else if (d <= 30) dist.b21_30++;
  else dist.b31p++;
}

const sortedD = [...deltas].sort((a, b) => a - b);
const avgDelta = mean(deltas);
const p50 = quantile(sortedD, 0.5);
const p90 = quantile(sortedD, 0.9);

const hasChain = totalHl > 0 ? chainedCount / totalHl : 0;
const within = (max: number) =>
  totalHl > 0 ? (100 * deltas.filter((d) => d <= max).length) / totalHl : 0;
const withinChained = (max: number) =>
  chainedCount > 0 ? (100 * deltas.filter((d) => d <= max).length) / chainedCount : 0;

function printAvg(label: string, xs: StartMetrics[]): void {
  if (xs.length === 0) {
    console.log(`  ${label}: (no samples)`);
    return;
  }
  console.log(`  ${label}: n=${xs.length}`);
  console.log(
    `    maxTile=${mean(xs.map((x) => x.maxT)).toFixed(4)} secondMax=${mean(xs.map((x) => x.secondM)).toFixed(4)} gap=${mean(xs.map((x) => x.gap)).toFixed(4)} empty=${mean(xs.map((x) => x.empty)).toFixed(4)}`
  );
  console.log(
    `    secondNearHead=${((100 * xs.filter((x) => x.secondNear).length) / xs.length).toFixed(2)}% top2dist=${mean(xs.map((x) => x.distMin)).toFixed(4)} top3span=${mean(xs.map((x) => x.span3)).toFixed(4)} top3ok=${((100 * xs.filter((x) => x.top3ok).length) / xs.length).toFixed(2)}%`
  );
  console.log(
    `    pair orth=${((100 * xs.filter((x) => x.orth).length) / xs.length).toFixed(2)}% oneSlide=${((100 * xs.filter((x) => x.oneSlide).length) / xs.length).toFixed(2)}%`
  );
}

console.log("\n## 1) chainability 분포");
console.log(`HL merge 이벤트 수: ${totalHl}`);
console.log(`다음 HL까지 이어짐(chained): ${chainedCount} (${(100 * hasChain).toFixed(2)}%)`);
console.log(`no-chain (에피소드 끝까지 다음 HL 없음): ${noChainCount} (${noChainRate.toFixed(2)}%)`);
if (deltas.length > 0) {
  console.log(
    `Δ 분포(chained만): 1:${dist.b1} 2:${dist.b2} 3:${dist.b3} 4:${dist.b4} 5:${dist.b5} | 6–10:${dist.b6_10} 11–20:${dist.b11_20} 21–30:${dist.b21_30} 31+:${dist.b31p}`
  );
  console.log(
    `Δ min=${sortedD[0]} max=${sortedD[sortedD.length - 1]} 평균=${avgDelta.toFixed(4)} p50=${p50} p90=${p90}`
  );
}

console.log("\n## 2) short-horizon chain rate");
console.log(
  `전체 HL 이벤트 대비 다음 HL까지 ≤1턴: ${within(1).toFixed(2)}% | ≤3턴: ${within(3).toFixed(2)}% | ≤5턴: ${within(5).toFixed(2)}%`
);
console.log(
  `chained 이벤트만 대비 Δ≤1: ${withinChained(1).toFixed(2)}% | ≤3: ${withinChained(3).toFixed(2)}% | ≤5: ${withinChained(5).toFixed(2)}%`
);

console.log(
  "\n## 3) no-chain 실패 원인 (근사, 상호배타 우선순위 D>B>C>A>E; " +
    `초기 ${FAIL_CLASS_WIN}턴 윈도우, D는 deadish가 τ 이후 ${DEADISH_NEAR_TURNS}턴 이내)`
);
const fn = noChainCount;
if (fn > 0) {
  for (const k of ["D", "B", "C", "A", "E"] as const) {
    console.log(
      `  Type ${k}: ${failByKind[k]} (${((100 * failByKind[k]) / fn).toFixed(2)}% of no-chain)`
    );
  }
} else {
  console.log("  (no-chain 없음)");
}

console.log("\n## 4) chain start 상태: 성공 vs 실패 평균");
printAvg("성공(다음 HL 존재)", succStarts);
printAvg("실패(no-chain)", failStarts);

console.log("\n## 5) chain 유지 구간 vs 실패 초기 구간 구조");
console.log(
  `  성공: chain 대기 구간(τ+1..j-1) pairable 비율 평균=${mean(succPairRate).toFixed(4)} (n=${succPairRate.length})`
);
console.log(
  `  실패: τ+1..min(τ+5,T) pairable 비율 평균=${mean(failPairRate).toFixed(4)} (n=${failPairRate.length})`
);
console.log(
  `  성공: j-1 시점 gap−start=${mean(succGapDelta).toFixed(4)} top2dist−start=${mean(succDistDelta).toFixed(4)}`
);
console.log(
  `  실패: τ+5(또는 T) 시점 gap−start=${mean(failGapDelta).toFixed(4)} top2dist−start=${mean(failDistDelta).toFixed(4)}`
);

console.log("\n## 6) HL merge 레벨별(슬라이드 merge L) chain");
for (const k of ["5to6", "6to7", "7to8", "other"] as const) {
  const b = byKind[k];
  const rate = b.total > 0 ? (100 * b.chained) / b.total : 0;
  const md = mean(b.deltas);
  console.log(
    `  ${k}: n=${b.total} chained=${b.chained} (${rate.toFixed(2)}%)` +
      (b.deltas.length > 0 ? ` | Δ 평균=${md.toFixed(3)}` : "")
  );
}

console.log("\n## 7) 핵심 결론 (해석용)");
console.log(
  `- no-chain 비율이 높으면 HL merge는 대부분 단발성으로 끊긴다고 볼 수 있다.\n` +
    `- chained 비율과 Δ 분포로 '다음 HL까지 얼마나 자주/빨리 이어지는지'를 판단한다.\n` +
    `- 실패 원인 Type 비율은 근사 규칙이므로 절대적 인과가 아니라 탐색용 신호로만 쓴다.`
);

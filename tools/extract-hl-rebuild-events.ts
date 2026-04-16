import * as fs from "node:fs";
import * as path from "node:path";
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
const DIRS: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];

const N = Math.max(1, Number(process.env.SIM_MINIMAL_N ?? "2000"));
const SEEDS = (process.env.SIM_MINIMAL_SEEDS ?? "42,43")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const POLICY_LABEL = process.env.CHAIN_POLICY ?? "P2-minimal";
const H = 20;
const OUT_PATH = path.resolve(process.env.HL_REBUILD_OUT ?? "out/hl-rebuild-events.json");

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

function top3Consistent(board: Board): boolean {
  const entries = PATH.map((cell, ord) => ({ cell, ord, v: board[cell]! })).filter((e) => e.v > 0);
  entries.sort((a, b) => b.v - a.v || a.ord - b.ord);
  const top = entries.slice(0, 3);
  top.sort((a, b) => a.ord - b.ord);
  for (let i = 0; i < top.length - 1; i++) {
    if (top[i]!.v < top[i + 1]!.v) return false;
  }
  return true;
}

function top3PathSpan(board: Board): number {
  const entries = PATH.map((cell, ord) => ({ cell, ord, v: board[cell]! })).filter((e) => e.v > 0);
  entries.sort((a, b) => b.v - a.v || a.ord - b.ord);
  const top = entries.slice(0, 3);
  if (top.length === 0) return 0;
  const ords = top.map((e) => e.ord);
  return Math.max(...ords) - Math.min(...ords);
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

function secondMaxNearHead(board: Board): boolean {
  const sm = secondMaxTile(board);
  if (sm === 0) return false;
  for (const idx of cellsAtLevel(board, sm)) {
    if (pathOrd(idx) <= 2) return true;
  }
  return false;
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

type OutRow = {
  episodeId: number;
  seed: number;
  hlLevel: number;
  start: {
    turn: number;
    maxTile: number;
    secondMaxTile: number;
    maxTileGap: number;
    emptyCount: number;
    secondMaxNearHead: boolean;
    top2PathDist: number;
    top3Span: number;
    top3Consistency: boolean;
    pairableOrth: boolean;
    pairableOneSlide: boolean;
    deadish: boolean;
    immediateMergeCount: number;
    oneStepSurvivalCount: number;
  };
  trajectory: Array<{
    k: number;
    maxTile: number;
    secondMaxTile: number;
    maxTileGap: number;
    emptyCount: number;
    secondMaxNearHead: boolean;
    pairableOrth: boolean;
    pairableOneSlide: boolean;
    deadish: boolean;
    immediateMergeCount: number;
    oneStepSurvivalCount: number;
    lowLevelMergeOccurred: boolean;
  }>;
  events: {
    secondMaxIncreasedTurn: number | null;
    nextHLTurn: number | null;
    deadishTurn: number | null;
  };
};

const rows: OutRow[] = [];

for (const seed of SEEDS) {
  for (let episodeId = 0; episodeId < N; episodeId++) {
    const { posts, slides, pre0 } = replayEpisode(seed, episodeId, POLICY_LABEL);
    const T = posts.length - 1;
    if (T < 0) continue;

    for (let turn = 0; turn <= T; turn++) {
      const pre = preForTurn(posts, pre0, turn);
      const sl = slides[turn]!;
      const post = posts[turn]!;
      if (!isHighLevelMergeEvent(pre, sl, post)) continue;

      const m = mergeLevelIfAny(pre, sl);
      const hlLevel = m === null ? maxTileLevel(post) : m + 1;
      const sf = extractSurvivalFeatures(post, null);

      const tLim = Math.min(T, turn + H);
      const trajectory: OutRow["trajectory"] = [];
      let secondMaxIncreasedTurn: number | null = null;
      let nextHLTurn: number | null = null;
      let deadishTurn: number | null = null;

      const startSecond = secondMaxTile(post);

      for (let t = turn + 1; t <= tLim; t++) {
        const k = t - turn;
        const preT = preForTurn(posts, pre0, t);
        const slT = slides[t]!;
        const poT = posts[t]!;
        const sft = extractSurvivalFeatures(poT, null);

        if (secondMaxIncreasedTurn === null && secondMaxTile(poT) >= startSecond + 1) {
          secondMaxIncreasedTurn = k;
        }
        if (nextHLTurn === null && isHighLevelMergeEvent(preT, slT, poT)) {
          nextHLTurn = k;
        }
        if (deadishTurn === null && isDeadish(poT)) {
          deadishTurn = k;
        }

        trajectory.push({
          k,
          maxTile: maxTileLevel(poT),
          secondMaxTile: secondMaxTile(poT),
          maxTileGap: maxTileLevel(poT) - secondMaxTile(poT),
          emptyCount: emptyCount(poT),
          secondMaxNearHead: secondMaxNearHead(poT),
          pairableOrth: top2OrthogonalAdjacent(poT),
          pairableOneSlide: top2OneSlideOrthAdjacent(poT),
          deadish: isDeadish(poT),
          immediateMergeCount: sft.immediateMergeCount,
          oneStepSurvivalCount: sft.oneStepSurvivalCount,
          lowLevelMergeOccurred: hasLowLevelMerge(preT, slT),
        });
      }

      rows.push({
        episodeId,
        seed,
        hlLevel,
        start: {
          turn,
          maxTile: maxTileLevel(post),
          secondMaxTile: secondMaxTile(post),
          maxTileGap: maxTileLevel(post) - secondMaxTile(post),
          emptyCount: emptyCount(post),
          secondMaxNearHead: secondMaxNearHead(post),
          top2PathDist: minTop2PathDistance(post),
          top3Span: top3PathSpan(post),
          top3Consistency: top3Consistent(post),
          pairableOrth: top2OrthogonalAdjacent(post),
          pairableOneSlide: top2OneSlideOrthAdjacent(post),
          deadish: isDeadish(post),
          immediateMergeCount: sf.immediateMergeCount,
          oneStepSurvivalCount: sf.oneStepSurvivalCount,
        },
        trajectory,
        events: {
          secondMaxIncreasedTurn,
          nextHLTurn,
          deadishTurn,
        },
      });
    }
  }
}

rows.sort((a, b) => (a.episodeId - b.episodeId) || (a.start.turn - b.start.turn) || (a.seed - b.seed));

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(rows));
process.stdout.write(JSON.stringify(rows));

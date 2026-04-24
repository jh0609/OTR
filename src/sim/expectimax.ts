import type { Board, Direction, Policy } from "./types";
import { slide } from "./slide";
import { spawnAll } from "./spawn";
import { legalActions } from "./legal";
import { maxTileLevel } from "./board";
import { scoreBoardV3 } from "./scoringV3";
import { lateGameSlidePenalty } from "./boardStats";
import type { PatternTripleSource, ScoreBoardWeights } from "./scoring";
import type { EndgameTuning, EndgameTuningConfig } from "./endgameTuning";
import {
  mergeEndgameTuning,
  experimentAEndgameTuning,
  experimentBEndgameTuning,
  experimentCEndgameTuning,
  experimentCEndgameWith78Tuning,
  experimentCEndgameWith78MergeTiming,
} from "./endgameTuning";

const ORDER_TIE: Direction[] = ["DOWN", "UP", "LEFT", "RIGHT"];

export type ExpectimaxDepth = 1 | 2;

/** 후반만 selective 3-ply: 2-ply로 상위 K개 고른 뒤 3-ply로 재정렬. */
export type SelectiveLate3PlyOptions = {
  /** 이 값 이상이면 selective 3-ply, 미만이면 순수 2-ply. 기본 7. */
  lateGameDepthThreshold: number;
  /** 2-ply 점수 상위 몇 개만 3-ply 평가할지. 기본 2. */
  rerankTopK: number;
};

const DEFAULT_SELECTIVE_LATE3: SelectiveLate3PlyOptions = {
  lateGameDepthThreshold: 7,
  rerankTopK: 2,
};

export type ExpectimaxConfig = {
  /** true면 C++ 2048-ai reference 구조를 3x3에 맞게 적응한 expectimax를 사용. */
  reference?: boolean;
  /** reference expectimax에서 maxTile<8이면 6, >=8이면 8을 사용. */
  referenceAdaptive?: boolean;
  /** reference expectimax용 고정 depth limit. 기본 8. */
  referenceDepthLimit?: number;
  /** reference expectimax용 move-by-move 로그 출력. */
  referenceLog?: boolean;
  /** 하위 호환용 — scoreBoardV3에서는 사용하지 않음. */
  weights?: ScoreBoardWeights;
  patternSource?: PatternTripleSource;
  /**
   * 1: Q(a) = E[scoreBoardV3(spawn(slide(a)))] + latePenalty(slide 전, slide 직후)
   * 2: Q(a) = E_s[ max_{a'} evaluateAction1(s,a') ]
   */
  depth?: ExpectimaxDepth;
  /**
   * true이고 depth===2일 때: maxTile ≥ lateGameDepthThreshold 에서만
   * 2-ply로 top-K 후보를 고른 뒤 evaluateAction3로 재순위.
   */
  selectiveLate3Ply?: boolean;
  lateGameDepthThreshold?: number;
  rerankTopK?: number;
  /** scoreBoardV3 Phase3 + late 슬라이드 페널티 튜닝 (baseline 과 merge). */
  tuning?: EndgameTuningConfig;
};

export type ReferenceExpectimaxConfig = {
  adaptive?: boolean;
  depthLimit?: number;
  log?: boolean;
};

type trans_table_entry_t = {
  depth: number;
  heuristic: number;
};

type trans_table_t = Map<bigint, trans_table_entry_t>;

type eval_state = {
  trans_table: trans_table_t;
  maxdepth: number;
  curdepth: number;
  cachehits: number;
  moves_evaled: number;
  depth_limit: number;
};

/** 동일 튜닝으로 leaf / 1·2·3-ply 평가를 묶은 클로저. */
export type ExpectimaxFns = {
  readonly tuning: EndgameTuning;
  evaluateAfterSlideSpawnExpectation: (boardAfterSlide: Board) => number;
  evaluateAction: (board: Board, action: Direction) => number;
  maxQ1Ply: (board: Board) => number;
  evaluateAction2: (board: Board, action: Direction) => number;
  evaluateActionToLeaf: (board: Board, action: Direction) => number;
  maxQTerminalToLeaf: (board: Board) => number;
  evaluateAction3: (board: Board, action: Direction) => number;
  leafScore: (board: Board) => number;
};

export function buildExpectimaxFns(tuning: EndgameTuning): ExpectimaxFns {
  const leafScore = (b: Board) => scoreBoardV3(b, tuning);
  const latePen = (before: Board, after: Board) => lateGameSlidePenalty(before, after, 8, tuning);

  function evaluateAfterSlideSpawnExpectation(boardAfterSlide: Board): number {
    const outcomes = spawnAll(boardAfterSlide);
    if (outcomes.length === 0) {
      return leafScore(boardAfterSlide);
    }
    let sum = 0;
    for (const b of outcomes) {
      sum += leafScore(b);
    }
    return sum / outcomes.length;
  }

  function evaluateAction(board: Board, action: Direction): number {
    const { next, moved, win } = slide(board, action);
    if (!moved) return -Infinity;
    const pen = latePen(board, next);
    if (win) return leafScore(next) + pen;
    return evaluateAfterSlideSpawnExpectation(next) + pen;
  }

  function maxQ1Ply(board: Board): number {
    const acts = legalActions(board);
    if (acts.length === 0) return leafScore(board);
    let best = -Infinity;
    for (const d of ORDER_TIE) {
      if (!acts.includes(d)) continue;
      const q = evaluateAction(board, d);
      if (q > best) best = q;
    }
    return best;
  }

  function evaluateAction2(board: Board, action: Direction): number {
    const { next, moved, win } = slide(board, action);
    if (!moved) return -Infinity;
    const pen = latePen(board, next);
    if (win) return leafScore(next) + pen;
    const outcomes = spawnAll(next);
    if (outcomes.length === 0) {
      return maxQ1Ply(next) + pen;
    }
    let sum = 0;
    for (const s of outcomes) {
      sum += maxQ1Ply(s);
    }
    return sum / outcomes.length + pen;
  }

  function evaluateActionToLeaf(board: Board, action: Direction): number {
    const { next, moved, win } = slide(board, action);
    if (!moved) return -Infinity;
    const pen = latePen(board, next);
    if (win) return leafScore(next) + pen;
    return leafScore(next) + pen;
  }

  function maxQTerminalToLeaf(board: Board): number {
    const acts = legalActions(board);
    if (acts.length === 0) return leafScore(board);
    let best = -Infinity;
    for (const d of ORDER_TIE) {
      if (!acts.includes(d)) continue;
      const q = evaluateActionToLeaf(board, d);
      if (q > best) best = q;
    }
    return best;
  }

  function maxMiddlePlyAfterSpawn(board: Board): number {
    const acts = legalActions(board);
    if (acts.length === 0) return leafScore(board);
    let best = -Infinity;
    for (const a2 of ORDER_TIE) {
      if (!acts.includes(a2)) continue;
      const { next: n2, moved, win } = slide(board, a2);
      if (!moved) continue;
      const pen1 = latePen(board, n2);
      if (win) {
        const v = leafScore(n2) + pen1;
        if (v > best) best = v;
        continue;
      }
      const outs2 = spawnAll(n2);
      if (outs2.length === 0) {
        const v = maxQTerminalToLeaf(n2) + pen1;
        if (v > best) best = v;
      } else {
        let sum = 0;
        for (const s2 of outs2) {
          sum += maxQTerminalToLeaf(s2);
        }
        const v = pen1 + sum / outs2.length;
        if (v > best) best = v;
      }
    }
    return best;
  }

  function evaluateAction3(board: Board, action: Direction): number {
    const { next, moved, win } = slide(board, action);
    if (!moved) return -Infinity;
    const pen0 = latePen(board, next);
    if (win) return leafScore(next) + pen0;
    const outs1 = spawnAll(next);
    if (outs1.length === 0) {
      return maxMiddlePlyAfterSpawn(next) + pen0;
    }
    let sum = 0;
    for (const s1 of outs1) {
      sum += maxMiddlePlyAfterSpawn(s1);
    }
    return sum / outs1.length + pen0;
  }

  return {
    tuning,
    evaluateAfterSlideSpawnExpectation,
    evaluateAction,
    maxQ1Ply,
    evaluateAction2,
    evaluateActionToLeaf,
    maxQTerminalToLeaf,
    evaluateAction3,
    leafScore,
  };
}

const defaultFns = buildExpectimaxFns(mergeEndgameTuning());

const REFERENCE_MOVE_ORDER: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];
const REFERENCE_LINE_TABLE_SIZE = 1 << 12;

// Heuristic scoring settings copied from the reference implementation.
const SCORE_LOST_PENALTY = 200000.0;
const SCORE_MONOTONICITY_POWER = 4.0;
const SCORE_MONOTONICITY_WEIGHT = 47.0;
const SCORE_SUM_POWER = 3.5;
const SCORE_SUM_WEIGHT = 11.0;
const SCORE_MERGES_WEIGHT = 700.0;
const SCORE_EMPTY_WEIGHT = 270.0;

// Statistics and controls copied from the reference implementation.
const CPROB_THRESH_BASE = 0.0001;
const CACHE_DEPTH_LIMIT = 15;
const DEFAULT_REFERENCE_EXPECTIMAX_DEPTH_LIMIT = 8;
const WIN_SCORE = 1_000_000_000;

const heur_score_table = new Float64Array(REFERENCE_LINE_TABLE_SIZE);
const score_table = new Float64Array(REFERENCE_LINE_TABLE_SIZE);
let reference_tables_initialized = false;

function init_tables(): void {
  if (reference_tables_initialized) return;

  for (let row = 0; row < REFERENCE_LINE_TABLE_SIZE; row++) {
    const line = [(row >> 0) & 0xf, (row >> 4) & 0xf, (row >> 8) & 0xf];

    let score = 0.0;
    for (let i = 0; i < 3; i++) {
      const rank = line[i]!;
      if (rank >= 2) {
        score += (rank - 1) * (1 << rank);
      }
    }
    score_table[row] = score;

    let sum = 0.0;
    let empty = 0;
    let merges = 0;
    let prev = 0;
    let counter = 0;
    for (let i = 0; i < 3; i++) {
      const rank = line[i]!;
      sum += Math.pow(rank, SCORE_SUM_POWER);
      if (rank === 0) {
        empty++;
      } else {
        if (prev === rank) {
          counter++;
        } else if (counter > 0) {
          merges += 1 + counter;
          counter = 0;
        }
        prev = rank;
      }
    }
    if (counter > 0) {
      merges += 1 + counter;
    }

    let monotonicity_left = 0.0;
    let monotonicity_right = 0.0;
    for (let i = 1; i < 3; i++) {
      const prevRank = line[i - 1]!;
      const rank = line[i]!;
      if (prevRank > rank) {
        monotonicity_left +=
          Math.pow(prevRank, SCORE_MONOTONICITY_POWER) - Math.pow(rank, SCORE_MONOTONICITY_POWER);
      } else {
        monotonicity_right +=
          Math.pow(rank, SCORE_MONOTONICITY_POWER) - Math.pow(prevRank, SCORE_MONOTONICITY_POWER);
      }
    }

    heur_score_table[row] =
      SCORE_LOST_PENALTY +
      SCORE_EMPTY_WEIGHT * empty +
      SCORE_MERGES_WEIGHT * merges -
      SCORE_MONOTONICITY_WEIGHT * Math.min(monotonicity_left, monotonicity_right) -
      SCORE_SUM_WEIGHT * sum;
  }

  reference_tables_initialized = true;
}

function transpose(board: Board): Board {
  return [
    board[0],
    board[3],
    board[6],
    board[1],
    board[4],
    board[7],
    board[2],
    board[5],
    board[8],
  ] as Board;
}

function count_empty(board: Board): number {
  let empty = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 0) empty++;
  }
  return empty;
}

function pack_board(board: Board): bigint {
  let key = 0n;
  for (let i = 0; i < board.length; i++) {
    key |= BigInt(board[i] ?? 0) << BigInt(i * 4);
  }
  return key;
}

function extract_row_key(board: Board, row: number): number {
  const base = row * 3;
  return (board[base] ?? 0) | ((board[base + 1] ?? 0) << 4) | ((board[base + 2] ?? 0) << 8);
}

function score_helper(board: Board, table: Float64Array): number {
  return table[extract_row_key(board, 0)]! + table[extract_row_key(board, 1)]! + table[extract_row_key(board, 2)]!;
}

function score_heur_board(board: Board): number {
  return score_helper(board, heur_score_table) + score_helper(transpose(board), heur_score_table);
}

function score_board(board: Board): number {
  return score_helper(board, score_table);
}

function isWinBoard(board: Board): boolean {
  return maxTileLevel(board) >= 9;
}

function resolveReferenceDepthLimit(board: Board, cfg?: ReferenceExpectimaxConfig): number {
  if (cfg?.adaptive === true) {
    return maxTileLevel(board) >= 8 ? 8 : 6;
  }
  return cfg?.depthLimit ?? DEFAULT_REFERENCE_EXPECTIMAX_DEPTH_LIMIT;
}

function execute_move_0(board: Board): Board {
  const { next, moved } = slide(board, "UP");
  return moved ? next : board;
}

function execute_move_1(board: Board): Board {
  const { next, moved } = slide(board, "DOWN");
  return moved ? next : board;
}

function execute_move_2(board: Board): Board {
  const { next, moved } = slide(board, "LEFT");
  return moved ? next : board;
}

function execute_move_3(board: Board): Board {
  const { next, moved } = slide(board, "RIGHT");
  return moved ? next : board;
}

function execute_move(move: number, board: Board): Board {
  switch (move) {
    case 0:
      return execute_move_0(board);
    case 1:
      return execute_move_1(board);
    case 2:
      return execute_move_2(board);
    case 3:
      return execute_move_3(board);
    default:
      return board;
  }
}

function score_tilechoose_node(state: eval_state, board: Board, cprob: number): number {
  if (isWinBoard(board)) {
    return WIN_SCORE;
  }

  if (cprob < CPROB_THRESH_BASE || state.curdepth >= state.depth_limit) {
    state.maxdepth = Math.max(state.curdepth, state.maxdepth);
    return score_heur_board(board);
  }

  if (state.curdepth < CACHE_DEPTH_LIMIT) {
    const entry = state.trans_table.get(pack_board(board));
    if (entry !== undefined && entry.depth <= state.curdepth) {
      state.cachehits++;
      return entry.heuristic;
    }
  }

  const num_open = count_empty(board);
  cprob /= num_open;

  let res = 0.0;
  const spawned = spawnAll(board);
  for (const next of spawned) {
    res += score_move_node(state, next, cprob);
  }
  res = res / num_open;

  if (state.curdepth < CACHE_DEPTH_LIMIT) {
    state.trans_table.set(pack_board(board), { depth: state.curdepth, heuristic: res });
  }
  return res;
}

function score_move_node(state: eval_state, board: Board, cprob: number): number {
  let best = 0.0;
  state.curdepth++;
  state.maxdepth = Math.max(state.maxdepth, state.curdepth);
  let foundLegal = false;
  for (let move = 0; move < 4; ++move) {
    const newboard = execute_move(move, board);
    state.moves_evaled++;
    if (board !== newboard) {
      foundLegal = true;
      if (isWinBoard(newboard)) {
        best = Math.max(best, WIN_SCORE);
      } else {
        best = Math.max(best, score_tilechoose_node(state, newboard, cprob));
      }
    }
  }
  if (!foundLegal) {
    state.maxdepth = Math.max(state.curdepth, state.maxdepth);
  }
  state.curdepth--;
  return best;
}

function _score_toplevel_move(state: eval_state, board: Board, move: number): number {
  const newboard = execute_move(move, board);
  if (board === newboard) {
    return 0;
  }
  if (isWinBoard(newboard)) {
    return WIN_SCORE + 1e-6;
  }
  return score_tilechoose_node(state, newboard, 1.0) + 1e-6;
}

export function score_toplevel_move(board: Board, move: number, cfg?: ReferenceExpectimaxConfig): number {
  init_tables();

  const state: eval_state = {
    trans_table: new Map(),
    maxdepth: 0,
    curdepth: 0,
    cachehits: 0,
    moves_evaled: 0,
    depth_limit: cfg?.depthLimit ?? DEFAULT_REFERENCE_EXPECTIMAX_DEPTH_LIMIT,
  };

  const start = Date.now();
  const res = _score_toplevel_move(state, board, move);
  const elapsed_ms = Date.now() - start;

  if (cfg?.log === true) {
    console.log(
      `Move ${move} (${REFERENCE_MOVE_ORDER[move] ?? "?"}): result ${res}: eval'd ${state.moves_evaled} moves (${state.cachehits} cache hits, ${state.trans_table.size} cache size) in ${(elapsed_ms / 1000).toFixed(2)} seconds (maxdepth=${state.maxdepth}, actual=${score_board(board)})`
    );
  }

  return res;
}

export function find_best_move(board: Board, cfg?: ReferenceExpectimaxConfig): number {
  init_tables();
  const depthLimit = resolveReferenceDepthLimit(board, cfg);

  let best = 0.0;
  let bestmove = -1;

  if (cfg?.log === true) {
    console.log(`[reference] maxTile=${maxTileLevel(board)} depthLimit=${depthLimit}`);
  }

  for (let move = 0; move < 4; move++) {
    const res = score_toplevel_move(board, move, { ...cfg, depthLimit });
    if (res > best) {
      best = res;
      bestmove = move;
    }
  }

  return bestmove;
}

export function createReferenceExpectimaxPolicy(cfg?: ReferenceExpectimaxConfig): Policy {
  return (board, actions) => {
    const bestmove = find_best_move(board, cfg);
    const chosen = REFERENCE_MOVE_ORDER[bestmove] ?? actions[0] ?? "UP";
    return actions.includes(chosen) ? chosen : actions[0] ?? chosen;
  };
}

function leafScore(board: Board): number {
  return defaultFns.leafScore(board);
}

export function evaluateAfterSlideSpawnExpectation(boardAfterSlide: Board): number {
  return defaultFns.evaluateAfterSlideSpawnExpectation(boardAfterSlide);
}

export function evaluateAction(
  board: Board,
  action: Direction,
  _weights?: ScoreBoardWeights,
  _patternSource?: PatternTripleSource
): number {
  return defaultFns.evaluateAction(board, action);
}

export function maxQ1Ply(
  board: Board,
  _weights?: ScoreBoardWeights,
  _patternSource?: PatternTripleSource
): number {
  return defaultFns.maxQ1Ply(board);
}

export function evaluateAction2(
  board: Board,
  action: Direction,
  _weights?: ScoreBoardWeights,
  _patternSource?: PatternTripleSource
): number {
  return defaultFns.evaluateAction2(board, action);
}

export function evaluateActionToLeaf(
  board: Board,
  action: Direction,
  _weights?: ScoreBoardWeights,
  _patternSource?: PatternTripleSource
): number {
  return defaultFns.evaluateActionToLeaf(board, action);
}

export function maxQTerminalToLeaf(board: Board): number {
  return defaultFns.maxQTerminalToLeaf(board);
}

export function evaluateAction3(
  board: Board,
  action: Direction,
  _weights?: ScoreBoardWeights,
  _patternSource?: PatternTripleSource
): number {
  return defaultFns.evaluateAction3(board, action);
}

function pickBestAction(
  board: Board,
  actions: Direction[],
  evalAction: (b: Board, d: Direction) => number
): Direction {
  let best = actions[0]!;
  let bestQ = -Infinity;
  for (const d of ORDER_TIE) {
    if (!actions.includes(d)) continue;
    const q = evalAction(board, d);
    if (q > bestQ) {
      bestQ = q;
      best = d;
    }
  }
  return best;
}

function parseSelectiveConfig(cfg?: ExpectimaxConfig): SelectiveLate3PlyOptions {
  return {
    lateGameDepthThreshold: cfg?.lateGameDepthThreshold ?? DEFAULT_SELECTIVE_LATE3.lateGameDepthThreshold,
    rerankTopK: cfg?.rerankTopK ?? DEFAULT_SELECTIVE_LATE3.rerankTopK,
  };
}

function expectimaxPolicyWith(
  fns: ExpectimaxFns,
  board: Board,
  actions: Direction[],
  depth: ExpectimaxDepth
): Direction {
  const evalFn =
    depth === 2
      ? (b: Board, d: Direction) => fns.evaluateAction2(b, d)
      : (b: Board, d: Direction) => fns.evaluateAction(b, d);
  return pickBestAction(board, actions, evalFn);
}

/**
 * 후반: 모든 방향에 대해 2-ply 점수 → 상위 K개만 3-ply로 재평가 후 최대 선택.
 * 초중반: 순수 2-ply와 동일.
 * `fns` 생략 시 baseline 튜닝.
 */
export function expectimaxPolicySelectiveLate3(
  board: Board,
  actions: Direction[],
  opts: SelectiveLate3PlyOptions,
  fns: ExpectimaxFns = defaultFns
): Direction {
  const { lateGameDepthThreshold, rerankTopK } = opts;
  if (maxTileLevel(board) < lateGameDepthThreshold) {
    return pickBestAction(board, actions, (b, d) => fns.evaluateAction2(b, d));
  }

  type Scored = { dir: Direction; q2: number };
  const ranked: Scored[] = [];
  for (const d of ORDER_TIE) {
    if (!actions.includes(d)) continue;
    ranked.push({ dir: d, q2: fns.evaluateAction2(board, d) });
  }
  ranked.sort((a, b) => b.q2 - a.q2);
  const k = Math.min(Math.max(1, rerankTopK), ranked.length);
  const top = ranked.slice(0, k);

  let best = top[0]!.dir;
  let bestQ3 = -Infinity;
  for (const { dir } of top) {
    const q3 = fns.evaluateAction3(board, dir);
    if (q3 > bestQ3) {
      bestQ3 = q3;
      best = dir;
    }
  }
  return best;
}

export type SelectiveLate3PlyPolicyConfig = {
  tuning?: EndgameTuningConfig;
  lateGameDepthThreshold?: number;
  rerankTopK?: number;
};

/**
 * selective late 3-ply + scoreBoardV3 튜닝을 한 번에 묶은 정책 생성기.
 */
export function createSelectiveLate3PlyPolicy(cfg?: SelectiveLate3PlyPolicyConfig): Policy {
  const fns = buildExpectimaxFns(mergeEndgameTuning(cfg?.tuning));
  const opts: SelectiveLate3PlyOptions = {
    lateGameDepthThreshold: cfg?.lateGameDepthThreshold ?? DEFAULT_SELECTIVE_LATE3.lateGameDepthThreshold,
    rerankTopK: cfg?.rerankTopK ?? DEFAULT_SELECTIVE_LATE3.rerankTopK,
  };
  return (board, actions) => expectimaxPolicySelectiveLate3(board, actions, opts, fns);
}

/**
 * depth=1 또는 2 expectimax: Q(a) 최대인 방향. 동점은 ORDER_TIE 우선.
 */
export function expectimaxPolicy(
  board: Board,
  actions: Direction[],
  _weights?: ScoreBoardWeights,
  _patternSource?: PatternTripleSource,
  depth: ExpectimaxDepth = 1
): Direction {
  return expectimaxPolicyWith(defaultFns, board, actions, depth);
}

/**
 * 현재 보드의 최적 expectimax 가치(루트에서 취할 수 있는 최대 Q).
 * depth 1·2·3 지원(3은 full evaluateAction3, selective 정책과 별개).
 */
export function searchExpectedValue(
  board: Board,
  depth: number,
  _weights?: ScoreBoardWeights,
  _patternSource?: PatternTripleSource
): number {
  const fns = defaultFns;
  if (depth <= 0) return fns.leafScore(board);
  const acts = legalActions(board);
  if (acts.length === 0) return fns.leafScore(board);
  if (depth === 1) return fns.maxQ1Ply(board);
  if (depth === 2) {
    let best = -Infinity;
    for (const d of ORDER_TIE) {
      if (!acts.includes(d)) continue;
      const q = fns.evaluateAction2(board, d);
      if (q > best) best = q;
    }
    return best;
  }
  if (depth === 3) {
    let best = -Infinity;
    for (const d of ORDER_TIE) {
      if (!acts.includes(d)) continue;
      const q = fns.evaluateAction3(board, d);
      if (q > best) best = q;
    }
    return best;
  }
  return fns.maxQ1Ply(board);
}

export function createExpectimaxPolicy(cfg?: ExpectimaxConfig): Policy {
  if (cfg?.reference === true) {
    return createReferenceExpectimaxPolicy({
      adaptive: cfg.referenceAdaptive,
      depthLimit: cfg.referenceDepthLimit,
      log: cfg.referenceLog,
    });
  }

  const depth: ExpectimaxDepth = cfg?.depth ?? 1;
  const selective = cfg?.selectiveLate3Ply === true && depth === 2;
  const selOpts = parseSelectiveConfig(cfg);
  const fns = cfg?.tuning !== undefined ? buildExpectimaxFns(mergeEndgameTuning(cfg.tuning)) : defaultFns;
  if (selective) {
    return (board, actions) => expectimaxPolicySelectiveLate3(board, actions, selOpts, fns);
  }
  return (board, actions) => expectimaxPolicyWith(fns, board, actions, depth);
}

/** 기본: 1-ply expectimax. */
export const expectimaxPolicyDefault: Policy = createExpectimaxPolicy();

/** C++ 2048-ai reference 구조를 3x3에 적응한 expectimax. */
export const expectimaxPolicyReference: Policy = createReferenceExpectimaxPolicy();

/** 2-ply expectimax (느리지만 반응이 한 단계 더 깊음). */
export const expectimaxPolicy2Ply: Policy = createExpectimaxPolicy({ depth: 2 });

/**
 * maxTile ≥ 7 에서만 2-ply 상위 K개를 골라 3-ply로 재순위, 그 외에는 2-ply와 동일.
 * baseline 튜닝.
 */
export const expectimaxPolicySelectiveLate3Ply: Policy = createSelectiveLate3PlyPolicy({});

/** Baseline selective 3-ply와 동일 (명시적 별칭). */
export const expectimaxPolicySelectiveLate3PlyBaseline: Policy = expectimaxPolicySelectiveLate3Ply;

export const expectimaxPolicySelectiveLate3PlyExperimentA: Policy = createSelectiveLate3PlyPolicy({
  tuning: experimentAEndgameTuning,
});

export const expectimaxPolicySelectiveLate3PlyExperimentB: Policy = createSelectiveLate3PlyPolicy({
  tuning: experimentBEndgameTuning,
});

export const expectimaxPolicySelectiveLate3PlyExperimentC: Policy = createSelectiveLate3PlyPolicy({
  tuning: experimentCEndgameTuning,
});

/** Experiment C + 7→8 merge potential · 8+7 엔드게임 보너스 · ultra late 슬라이드 선호 */
export const expectimaxPolicySelectiveLate3PlyExperimentCWith78: Policy = createSelectiveLate3PlyPolicy({
  tuning: experimentCEndgameWith78Tuning,
});

/** C+78 + merge timing(즉시 7/8 머지 선호·슬라이드 델타) */
export const expectimaxPolicySelectiveLate3PlyExperimentCWith78MergeTiming: Policy =
  createSelectiveLate3PlyPolicy({
    tuning: experimentCEndgameWith78MergeTiming,
  });

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

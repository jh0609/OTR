import type { Board } from "./types";
import { LEN, emptyCount, maxTileLevel } from "./board";
import {
  countTilesAtLeast,
  countTilesEqual,
  countLowLevelMergePairs,
  rebuildLaneScore,
  secondMaxTile,
  trappedAroundMaxTile,
  maxTileAtAnchor,
} from "./boardStats";
import { detectPatterns, detectPatternsAtIndices, SNAKE_HEAD3_INDICES } from "./patterns";

/** 스네이크 경로: 우하단(8)이 체인의 “머리”. */
export const SNAKE_PATH_INDICES: readonly number[] = [8, 7, 6, 5, 4, 3, 2, 1, 0];

export type PatternTripleSource = "topRow" | "snakeHead3";

/** 듀얼 빌드 핵심 계수 (요청 수치 반영). max≥6 / max≥7 스택 적용. */
export const DUAL_SCORE = {
  secondAt6: 260,
  gapAt6: -120,
  secondAt7Plus: 400,
  gapAt7Plus: -180,
  countGe7: 180,
  countEq7: 350,
  countEq8: 800,
  bonusOne8AndOne7: 2000,
  bonusTwo8: 100_000,
} as const;

export type ScoreBoardWeights = {
  /** Phase1 (max≤5): max 선형 항 (약하게) */
  phase1MaxLinear: number;
  survivalEmpty: number;
  survivalMergePair: number;
  survivalMonotonicity: number;
  survivalInversion: number;
  survivalIsolatedSmall: number;
  survivalAnchor: number;
  /** Phase2 (max==6): max 항 */
  phase2MaxLinear: number;
  /** Phase2에서 second 추가 가중(0이면 DUAL_SCORE만 사용) */
  structureSecondBoost: number;
  /** Phase3 (max≥7): max 항 (second보다 우선 낮게) */
  phase3MaxLinear: number;
  dualEmpty: number;
  dualLowMergePairs: number;
  dualRebuild: number;
  dualTrapped: number;
  dualMonotonicity: number;
  dualInversion: number;
  anchorCornerIndex: number;
  earlyPattern020: number;
  earlyPatternMid: number;
  earlyPatternBad: number;
  /** max≥6: 020 ≈ 절반 */
  structurePattern020: number;
  structurePatternMid: number;
  structurePatternBad: number;
  /** max≥7: 020 거의 제거 */
  dualPattern020: number;
  dualPatternMid: number;
  dualPatternBad: number;
  survivalMax: number;
  structureTile: number;
  dualBuildMin: number;
};

export const DEFAULT_SCORE_WEIGHTS: ScoreBoardWeights = {
  phase1MaxLinear: 80,
  phase2MaxLinear: 120,
  phase3MaxLinear: 40,
  structureSecondBoost: 0,

  survivalEmpty: 120,
  survivalMergePair: 50,
  survivalMonotonicity: 15,
  survivalInversion: -25,
  survivalIsolatedSmall: -20,
  survivalAnchor: 80,

  dualEmpty: 80,
  dualLowMergePairs: 60,
  dualRebuild: 100,
  dualTrapped: -150,
  dualMonotonicity: 10,
  dualInversion: -15,

  anchorCornerIndex: 8,

  earlyPattern020: 40,
  earlyPatternMid: 30,
  earlyPatternBad: -60,

  structurePattern020: 20,
  structurePatternMid: 35,
  structurePatternBad: -80,

  dualPattern020: 6,
  dualPatternMid: 90,
  dualPatternBad: -180,

  survivalMax: 5,
  structureTile: 6,
  dualBuildMin: 7,
};

export function countMergePairs(board: Board): number {
  let n = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const v = board[i];
      if (v === 0) continue;
      if (c < 2) {
        const j = i + 1;
        if (board[j] === v) n++;
      }
      if (r < 2) {
        const j = i + 3;
        if (board[j] === v) n++;
      }
    }
  }
  return n;
}

export function monotonicityAlongSnake(board: Board, path: readonly number[] = SNAKE_PATH_INDICES): number {
  let s = 0;
  for (let k = 0; k < path.length - 1; k++) {
    const a = board[path[k]!];
    const b = board[path[k + 1]!];
    if (a === 0 && b === 0) continue;
    if (a >= b) s += 1;
  }
  return s;
}

export function inversionCountAlongSnake(board: Board, path: readonly number[] = SNAKE_PATH_INDICES): number {
  let inv = 0;
  for (let i = 0; i < path.length; i++) {
    for (let j = i + 1; j < path.length; j++) {
      const a = board[path[i]!];
      const b = board[path[j]!];
      if (a === 0 || b === 0) continue;
      if (a < b) inv++;
    }
  }
  return inv;
}

const SMALL_LEVELS = new Set([1, 2, 3]);

function neighbors4(idx: number): number[] {
  const r = Math.floor(idx / 3);
  const c = idx % 3;
  const out: number[] = [];
  if (c > 0) out.push(idx - 1);
  if (c < 2) out.push(idx + 1);
  if (r > 0) out.push(idx - 3);
  if (r < 2) out.push(idx + 3);
  return out;
}

export function countIsolatedSmallTiles(board: Board): number {
  let n = 0;
  for (let i = 0; i < LEN; i++) {
    const v = board[i];
    if (!SMALL_LEVELS.has(v)) continue;
    let hasMergeNeighbor = false;
    for (const j of neighbors4(i)) {
      if (board[j] === v) {
        hasMergeNeighbor = true;
        break;
      }
    }
    if (!hasMergeNeighbor) n++;
  }
  return n;
}

function applyPatternWeights(
  score: number,
  w020: number,
  wMid: number,
  wBad: number,
  board: Board,
  patternSource: PatternTripleSource
): number {
  const pat =
    patternSource === "topRow"
      ? detectPatterns(board)
      : detectPatternsAtIndices(board, SNAKE_HEAD3_INDICES);
  const bad = pat.has012 || pat.has002;
  const mid = pat.has102 || pat.has120 || pat.has021;
  if (pat.has020) score += w020;
  if (mid) score += wMid;
  if (bad) score += wBad;
  return score;
}

function survivalTerms(
  w: ScoreBoardWeights,
  board: Board,
  scale: number
): number {
  const ec = emptyCount(board);
  const mp = countMergePairs(board);
  const mono = monotonicityAlongSnake(board);
  const inv = inversionCountAlongSnake(board);
  const iso = countIsolatedSmallTiles(board);
  const anchorBonus = maxTileAtAnchor(board, w.anchorCornerIndex);
  return (
    w.survivalEmpty * ec * scale +
    w.survivalMergePair * mp * scale +
    w.survivalMonotonicity * mono * scale +
    w.survivalInversion * inv * scale +
    w.survivalIsolatedSmall * iso * scale +
    w.survivalAnchor * anchorBonus * scale
  );
}

/** 목표 상태 보너스: 8+7 동시, 8 두 개 (항상 평가). */
function applyMilestoneBonuses(board: Board): number {
  const c7 = countTilesEqual(board, 7);
  const c8 = countTilesEqual(board, 8);
  let s = 0;
  if (c8 >= 1 && c7 >= 1) s += DUAL_SCORE.bonusOne8AndOne7;
  if (c8 >= 2) s += DUAL_SCORE.bonusTwo8;
  return s;
}

/** max≥6: 고레벨 개수 직접 보상 (single-max 편향 교정). */
function applyHighTileCountBonuses(board: Board): number {
  const cGe7 = countTilesAtLeast(board, 7);
  const c7 = countTilesEqual(board, 7);
  const c8 = countTilesEqual(board, 8);
  return (
    DUAL_SCORE.countGe7 * cGe7 +
    DUAL_SCORE.countEq7 * c7 +
    DUAL_SCORE.countEq8 * c8
  );
}

/** secondMax / gap — max≥6 및 max≥7 스택 */
function applySecondTierStack(mx: number, sm: number, gapPen: number): number {
  let s = 0;
  if (mx >= 6) {
    s += DUAL_SCORE.secondAt6 * sm + DUAL_SCORE.gapAt6 * gapPen;
  }
  if (mx >= 7) {
    s += DUAL_SCORE.secondAt7Plus * sm + DUAL_SCORE.gapAt7Plus * gapPen;
  }
  return s;
}

export function scoreBoard(
  board: Board,
  weights: ScoreBoardWeights = DEFAULT_SCORE_WEIGHTS,
  patternSource: PatternTripleSource = "topRow"
): number {
  const mx = maxTileLevel(board);
  const sm = secondMaxTile(board);
  const gapPen = Math.max(0, mx - sm - 1);

  let score = applyMilestoneBonuses(board);

  if (mx <= weights.survivalMax) {
    score += weights.phase1MaxLinear * mx;
    score += survivalTerms(weights, board, 1);
    score = applyPatternWeights(score, weights.earlyPattern020, weights.earlyPatternMid, weights.earlyPatternBad, board, patternSource);
    return score;
  }

  if (mx === weights.structureTile) {
    score += weights.phase2MaxLinear * mx;
    score += applySecondTierStack(mx, sm, gapPen);
    score += applyHighTileCountBonuses(board);
    score += weights.structureSecondBoost * sm;
    score += survivalTerms(weights, board, 0.88);
    score = applyPatternWeights(
      score,
      weights.structurePattern020,
      weights.structurePatternMid,
      weights.structurePatternBad,
      board,
      patternSource
    );
    return score;
  }

  if (mx >= weights.dualBuildMin) {
    score += weights.phase3MaxLinear * mx;
    score += applySecondTierStack(mx, sm, gapPen);
    score += applyHighTileCountBonuses(board);
    const anchor = weights.anchorCornerIndex;
    const lowM = countLowLevelMergePairs(board, 4);
    const reb = rebuildLaneScore(board);
    const trap = trappedAroundMaxTile(board);
    const mono = monotonicityAlongSnake(board);
    const inv = inversionCountAlongSnake(board);
    const anchorBonus = maxTileAtAnchor(board, anchor);
    score +=
      weights.dualEmpty * emptyCount(board) +
      weights.dualLowMergePairs * lowM +
      weights.dualRebuild * reb +
      weights.dualTrapped * trap +
      weights.dualMonotonicity * mono +
      weights.dualInversion * inv +
      weights.survivalAnchor * anchorBonus * 0.45;
    score = applyPatternWeights(
      score,
      weights.dualPattern020,
      weights.dualPatternMid,
      weights.dualPatternBad,
      board,
      patternSource
    );
    return score;
  }

  return score;
}

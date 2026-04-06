import type { Board } from "./types";
import { emptyCount, maxTileLevel } from "./board";
import {
  countMergePairs,
  monotonicityAlongSnake,
  inversionCountAlongSnake,
  countIsolatedSmallTiles,
} from "./scoring";
import {
  countTilesAtLeast,
  countTilesEqual,
  hasAdjacentCrossPair,
  hasAdjacentPair,
  hasImmediateMerge,
  rebuildLaneScore,
  secondMaxTile,
  trappedAroundMaxTile,
  maxTileAtAnchor,
  mergePotentialAtLevel,
  endgame7To8Potential,
} from "./boardStats";
import type { EndgameTuning, EndgameTuningConfig } from "./endgameTuning";
import { mergeEndgameTuning } from "./endgameTuning";

const ANCHOR = 8;

function survivalCore(board: Board): number {
  const ec = emptyCount(board);
  const mp = countMergePairs(board);
  const anchorOK = maxTileAtAnchor(board, ANCHOR);
  const mono = monotonicityAlongSnake(board);
  const inv = inversionCountAlongSnake(board);
  const iso = countIsolatedSmallTiles(board);
  return (
    70 * ec +
    35 * mp +
    60 * anchorOK +
    8 * mono -
    18 * inv -
    12 * iso
  );
}

/** Phase 1: maxTile ≤ 5 — 생존·구조 중심. */
function scorePhase1(board: Board): number {
  const mx = maxTileLevel(board);
  return survivalCore(board) + 55 * mx;
}

/** Phase 2: maxTile === 6 — 전환(듀얼 스택·재압축·트랩). */
function scorePhase2(board: Board): number {
  const mx = 6;
  const sm = secondMaxTile(board);
  const gap = mx - sm;
  const cge6 = countTilesAtLeast(board, 6);
  const ceq6 = countTilesEqual(board, 6);
  const rebuild = rebuildLaneScore(board);
  const trapped = trappedAroundMaxTile(board);
  const g1 = Math.max(0, gap - 1);
  const g2 = Math.max(0, gap - 2);
  return (
    survivalCore(board) +
    140 * mx +
    220 * sm +
    50 * cge6 +
    40 * ceq6 -
    45 * g1 -
    25 * g2 +
    100 * rebuild -
    120 * trapped
  );
}

/** Phase 3: maxTile ≥ 7 — 튜닝 가능 계수 + 이벤트 보너스. */
function scorePhase3(board: Board, t: EndgameTuning): number {
  const ec = emptyCount(board);
  const mergePairs = countMergePairs(board);
  const anchorOK = maxTileAtAnchor(board, ANCHOR);
  const mono = monotonicityAlongSnake(board);
  const inv = inversionCountAlongSnake(board);
  const isolatedSmallTiles = countIsolatedSmallTiles(board);

  const mx = maxTileLevel(board);
  const sm = secondMaxTile(board);
  const gap = mx - sm;

  const countGE7 = countTilesAtLeast(board, 7);
  const count7 = countTilesEqual(board, 7);
  const count8 = countTilesEqual(board, 8);

  const rebuild = rebuildLaneScore(board);
  const trapped = trappedAroundMaxTile(board);

  let score =
    70 * ec +
    35 * mergePairs +
    60 * anchorOK +
    8 * mono -
    18 * inv -
    12 * isolatedSmallTiles +
    t.maxTileWeight * mx +
    t.secondMaxWeight * sm +
    t.countGE7Weight * countGE7 +
    t.count7Weight * count7 +
    t.count8Weight * count8 +
    t.rebuildWeight * rebuild -
    t.trappedWeight * trapped -
    t.gapPenalty1 * Math.max(0, gap - 1) -
    t.gapPenalty2 * Math.max(0, gap - 2);

  if (sm === 7) score += t.secondMaxIs7Bonus;
  if (sm === 6) score += t.secondMaxIs6Bonus;

  if (count7 >= 2) score += t.two7Bonus;
  if (count8 >= 1 && count7 >= 1) score += t.one8one7Bonus;
  if (count8 >= 2) score += t.two8Bonus;

  if (count8 >= 2 && !hasAdjacentPair(board, 8)) {
    score -= t.penalty88NotAdjacent;
  } else if (count8 >= 1 && count7 >= 1 && !hasAdjacentCrossPair(board, 8, 7)) {
    score -= t.penalty87NotAdjacent;
  } else if (count7 >= 2 && !hasAdjacentPair(board, 7)) {
    score -= t.penalty77NotAdjacent;
  }

  const canMerge7Now = hasImmediateMerge(board, 7);
  const canMerge8Now = hasImmediateMerge(board, 8);
  if (canMerge7Now) score += t.mergeNow7Bonus;
  if (canMerge8Now) score += t.mergeNow8Bonus;
  if (count7 >= 2 && !canMerge7Now) score -= t.deferMerge7Penalty;
  if (count8 >= 2 && !canMerge8Now) score -= t.deferMerge8Penalty;

  const ultraEndgame =
    (mx >= 8 && sm >= 7) || (count7 >= 2 && mx >= 7);

  if (ultraEndgame && t.endgame78Weight > 0) {
    score += t.endgame78Weight * endgame7To8Potential(board, t);
  }
  if (ultraEndgame) {
    if (mx === 8 && sm === 7) score += t.max8Second7Bonus;
    if (count7 >= 2) score += t.two7EndgameBonus;
    if (mergePotentialAtLevel(board, 7) > 0) score += t.active7MergeBonus;
  }

  return score;
}

/**
 * expectimax용 보드 가치. Phase1(≤5) / Phase2(==6) / Phase3(≥7) 분리.
 * `tuning` 생략 시 baseline(기존 기본값).
 */
export function scoreBoardV3(board: Board, tuning?: EndgameTuningConfig | null): number {
  const t = mergeEndgameTuning(tuning);
  const mx = maxTileLevel(board);
  if (mx <= 5) return scorePhase1(board);
  if (mx === 6) return scorePhase2(board);
  return scorePhase3(board, t);
}

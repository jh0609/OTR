/**
 * scoreBoardV3 Phase3( max≥7 ) 및 lateGameSlidePenalty 계수.
 * Partial 로 넘기면 mergeEndgameTuning 으로 baseline 과 합성.
 */

export type EndgameTuningConfig = {
  /** Phase3: max 타일 레벨 가중. 기본 140 */
  maxTileWeight?: number;
  count7Weight?: number;
  count8Weight?: number;
  countGE7Weight?: number;
  secondMaxWeight?: number;

  two7Bonus?: number;
  one8one7Bonus?: number;
  two8Bonus?: number;

  /** secondMaxTile === 7 일 때 추가 (Phase3) */
  secondMaxIs7Bonus?: number;
  /** secondMaxTile === 6 일 때 추가 (Phase3) */
  secondMaxIs6Bonus?: number;

  rebuildWeight?: number;
  trappedWeight?: number;

  /** gap = maxTile - secondMax 에 대해 Math.max(0, gap-1), Math.max(0, gap-2) 배수 */
  gapPenalty1?: number;
  gapPenalty2?: number;

  /** rebuildLaneScore 가 rebuildDropDelta 이상 떨어지면 적용 */
  rebuildDropPenalty?: number;
  rebuildDropDelta?: number;

  emptyZeroPenalty?: number;
  movedOffAnchorPenalty?: number;

  /** endgame7To8Potential 전체에 곱함 */
  endgame78Weight?: number;
  max8Second7Bonus?: number;
  /** ultra 엔드게임 구간에서 count(7)≥2 추가 보너스 */
  two7EndgameBonus?: number;
  /** mergePotentialAtLevel(7) > 0 일 때 */
  active7MergeBonus?: number;
  /** endgame7To8Potential 내부 mp7/mp6 스케일 */
  mergePotential7Weight?: number;
  mergePotential6Weight?: number;

  /** max≥8 && second≥7 일 때 슬라이드 Q에 delta 반영 */
  deltaMergePotential7Weight?: number;
  deltaRebuildPreferenceWeight?: number;
  deltaTrappedPenaltyWeight?: number;
};

export type EndgameTuning = Required<EndgameTuningConfig>;

const BASE: EndgameTuning = {
  maxTileWeight: 140,
  count7Weight: 260,
  count8Weight: 300,
  countGE7Weight: 180,
  secondMaxWeight: 220,

  two7Bonus: 1200,
  one8one7Bonus: 3500,
  two8Bonus: 100_000,

  secondMaxIs7Bonus: 0,
  secondMaxIs6Bonus: 0,

  rebuildWeight: 100,
  trappedWeight: 120,

  gapPenalty1: 120,
  gapPenalty2: 220,

  rebuildDropPenalty: 500,
  rebuildDropDelta: 2,

  emptyZeroPenalty: 800,
  movedOffAnchorPenalty: 2000,

  endgame78Weight: 0,
  max8Second7Bonus: 0,
  two7EndgameBonus: 0,
  active7MergeBonus: 0,
  mergePotential7Weight: 0,
  mergePotential6Weight: 0,

  deltaMergePotential7Weight: 0,
  deltaRebuildPreferenceWeight: 0,
  deltaTrappedPenaltyWeight: 0,
};

export function mergeEndgameTuning(partial?: EndgameTuningConfig | null): EndgameTuning {
  if (!partial) return { ...BASE };
  return { ...BASE, ...partial };
}

/** 기존 하드코드와 동일한 baseline. */
export const baselineEndgameTuning: EndgameTuning = mergeEndgameTuning();

/** Experiment A: 8+7 강화 */
export const experimentAEndgameTuning: EndgameTuning = mergeEndgameTuning({
  one8one7Bonus: 8000,
  secondMaxIs7Bonus: 1800,
  count8Weight: 240,
  count7Weight: 280,
  countGE7Weight: 200,
  secondMaxWeight: 240,
});

/** Experiment B: 7+7 유지·갭 패널티 강화 */
export const experimentBEndgameTuning: EndgameTuning = mergeEndgameTuning({
  two7Bonus: 3200,
  count7Weight: 340,
  secondMaxWeight: 260,
  count8Weight: 220,
  gapPenalty1: 160,
  gapPenalty2: 280,
});

/** Experiment C: 후반 슬라이드 페널티 완화 + rebuild 장려 (7→8 휴리스틱 없음) */
export const experimentCEndgameTuning: EndgameTuning = mergeEndgameTuning({
  rebuildWeight: 180,
  rebuildDropPenalty: 250,
  emptyZeroPenalty: 600,
  trappedWeight: 100,
});

/** C + 7→8 merge potential · 8+7 엔드게임 · ultra late 슬라이드 선호 */
export const experimentCEndgameWith78Tuning: EndgameTuning = mergeEndgameTuning({
  rebuildWeight: 180,
  rebuildDropPenalty: 250,
  emptyZeroPenalty: 600,
  trappedWeight: 100,
  endgame78Weight: 220,
  max8Second7Bonus: 4000,
  two7EndgameBonus: 2500,
  active7MergeBonus: 1200,
  mergePotential7Weight: 500,
  mergePotential6Weight: 160,
  deltaMergePotential7Weight: 600,
  deltaRebuildPreferenceWeight: 120,
  deltaTrappedPenaltyWeight: 100,
});

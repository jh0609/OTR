/**
 * scoreBoardV3 Phase3(max≥7) 및 lateGameSlidePenalty 에 쓰는 최소 튜닝.
 * Partial 은 mergeEndgameTuning 으로 BASE 와 합성.
 */

export type EndgameTuningConfig = {
  /** Phase3: max 타일 레벨 가중 */
  maxTileWeight?: number;
  count7Weight?: number;
  count8Weight?: number;
  countGE7Weight?: number;
  secondMaxWeight?: number;

  rebuildWeight?: number;
  trappedWeight?: number;

  /** gap = maxTile - secondMax */
  gapPenalty1?: number;
  gapPenalty2?: number;

  /** rebuildLaneScore 가 rebuildDropDelta 이상 떨어지면 적용 */
  rebuildDropPenalty?: number;
  rebuildDropDelta?: number;

  emptyZeroPenalty?: number;
  movedOffAnchorPenalty?: number;

  /** Phase2·3: `highLevelMergePathValue`(6/7/8 mergePotential 가중합) 가중 */
  highLevelMergePathWeight?: number;
  /** Phase2·3: 전역 최댓값 타일이 네 구석 중 하나에 있으면 1 — 그때 곱하는 가중 */
  highLevelCornerWeight?: number;
};

export type EndgameTuning = Required<EndgameTuningConfig>;

const BASE: EndgameTuning = {
  maxTileWeight: 140,
  count7Weight: 260,
  count8Weight: 300,
  countGE7Weight: 180,
  secondMaxWeight: 220,

  rebuildWeight: 100,
  trappedWeight: 120,

  gapPenalty1: 120,
  gapPenalty2: 220,

  rebuildDropPenalty: 500,
  rebuildDropDelta: 2,

  emptyZeroPenalty: 800,
  movedOffAnchorPenalty: 2000,

  highLevelMergePathWeight: 32,
  highLevelCornerWeight: 60,
};

export function mergeEndgameTuning(partial?: EndgameTuningConfig | null): EndgameTuning {
  if (!partial) return { ...BASE };
  return { ...BASE, ...partial };
}

export const baselineEndgameTuning: EndgameTuning = mergeEndgameTuning();

/** 실험용: 약간 다른 가중만 유지(정책 객체 구분·회귀 테스트용). */
export const experimentAEndgameTuning: EndgameTuning = mergeEndgameTuning({
  secondMaxWeight: 240,
});

export const experimentBEndgameTuning: EndgameTuning = mergeEndgameTuning({
  gapPenalty1: 140,
});

export const experimentCEndgameTuning: EndgameTuning = mergeEndgameTuning({
  rebuildWeight: 120,
  trappedWeight: 100,
  rebuildDropPenalty: 250,
  emptyZeroPenalty: 600,
});

export const experimentCEndgameWith78Tuning: EndgameTuning = mergeEndgameTuning({
  rebuildWeight: 130,
  trappedWeight: 100,
  rebuildDropPenalty: 250,
  emptyZeroPenalty: 600,
});

export const experimentCEndgameWith78MergeTiming: EndgameTuning = mergeEndgameTuning({
  rebuildWeight: 140,
  trappedWeight: 100,
  rebuildDropPenalty: 250,
  emptyZeroPenalty: 600,
});

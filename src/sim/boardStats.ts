import type { Board } from "./types";
import { emptyCount, LEN, maxTileLevel } from "./board";
import type { EndgameTuning, EndgameTuningConfig } from "./endgameTuning";
import { mergeEndgameTuning } from "./endgameTuning";

/** 내림차순 정렬된 비어 있지 않은 셀 값 (길이 0 가능). */
export function nonZeroValuesDesc(board: Board): number[] {
  const vals: number[] = [];
  for (let i = 0; i < LEN; i++) {
    if (board[i] !== 0) vals.push(board[i]);
  }
  vals.sort((a, b) => b - a);
  return vals;
}

/** 두 번째로 큰 타일 레벨(중복 허용: [8,8,3] → 8). 타일 1개뿐이면 0. */
export function secondMaxTile(board: Board): number {
  const v = nonZeroValuesDesc(board);
  return v.length >= 2 ? v[1]! : 0;
}

export function top2Gap(board: Board): number {
  const mx = maxTileLevel(board);
  const sm = secondMaxTile(board);
  return mx - sm;
}

/** 상위 두 타일 레벨 합 (타일 1개면 그 값만). */
export function topTwoTileSum(board: Board): number {
  const v = nonZeroValuesDesc(board);
  if (v.length === 0) return 0;
  if (v.length === 1) return v[0]!;
  return v[0]! + v[1]!;
}

/** maxTile==8 이고 secondMax==6 인 스냅샷 (전환 직전 병목 분석용). */
export function hasMax8AndSecond6(board: Board): boolean {
  return maxTileLevel(board) === 8 && secondMaxTile(board) === 6;
}

/** maxTile==8 이고 secondMax==7 인 스냅샷 (8+7 듀얼 빌드 진단용). */
export function hasMax8AndSecond7(board: Board): boolean {
  return maxTileLevel(board) === 8 && secondMaxTile(board) === 7;
}

export function countTilesAtLeast(board: Board, level: number): number {
  let n = 0;
  for (let i = 0; i < LEN; i++) if (board[i] >= level) n++;
  return n;
}

export function countTilesEqual(board: Board, level: number): number {
  let n = 0;
  for (let i = 0; i < LEN; i++) if (board[i] === level) n++;
  return n;
}

/** 동시에 두 칸 이상이 정확히 레벨 7 */
export function hasTwoOrMoreTilesEqual(board: Board, level: number): boolean {
  return countTilesEqual(board, level) >= 2;
}

export function hasSimultaneousOne8AndOne7(board: Board): boolean {
  return countTilesEqual(board, 8) >= 1 && countTilesEqual(board, 7) >= 1;
}

export function hasSimultaneousTwo8s(board: Board): boolean {
  return countTilesEqual(board, 8) >= 2;
}

/** 3×3 격자에서 인덱스 i, j가 상하좌우로 인접하면 true (동일 칸은 false). */
export function areAdjacent(i: number, j: number): boolean {
  if (i === j) return false;
  if (i < 0 || i >= LEN || j < 0 || j >= LEN) return false;
  const ri = Math.floor(i / 3);
  const ci = i % 3;
  const rj = Math.floor(j / 3);
  const cj = j % 3;
  return Math.abs(ri - rj) + Math.abs(ci - cj) === 1;
}

/** 인접한 동일 레벨 타일 쌍이 하나라도 있으면 true (가로·세로 이웃만). */
export function hasAdjacentPair(board: Board, level: number): boolean {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      if (board[i] !== level) continue;
      if (c < 2 && board[i + 1] === level) return true;
      if (r < 2 && board[i + 3] === level) return true;
    }
  }
  return false;
}

/** 인접한 levelA / levelB 쌍 (순서 무관)이 하나라도 있으면 true. */
export function hasAdjacentCrossPair(board: Board, levelA: number, levelB: number): boolean {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const v = board[i];
      if (v === 0) continue;
      if (c < 2) {
        const j = i + 1;
        const w = board[j];
        if ((v === levelA && w === levelB) || (v === levelB && w === levelA)) return true;
      }
      if (r < 2) {
        const j = i + 3;
        const w = board[j];
        if ((v === levelA && w === levelB) || (v === levelB && w === levelA)) return true;
      }
    }
  }
  return false;
}

export type HighLevelAdjState = "88" | "87" | "77" | "none";

/**
 * 인접한 고레벨 merge 준비 상태(우선순위: 8+8 → 8+7 → 7+7).
 * 해당 인벤토리가 없으면 'none'.
 */
export function highLevelAdjacencyState(board: Board): HighLevelAdjState {
  const c7 = countTilesEqual(board, 7);
  const c8 = countTilesEqual(board, 8);
  if (c8 >= 2 && hasAdjacentPair(board, 8)) return "88";
  if (c8 >= 1 && c7 >= 1 && hasAdjacentCrossPair(board, 8, 7)) return "87";
  if (c7 >= 2 && hasAdjacentPair(board, 7)) return "77";
  return "none";
}

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

/** 인접 동일 레벨 쌍 중 둘 다 레벨 ≤ maxLevel (기본 4). */
export function countLowLevelMergePairs(board: Board, maxLevel = 4): number {
  let n = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const v = board[i];
      if (v === 0 || v > maxLevel) continue;
      if (c < 2) {
        const j = i + 1;
        const w = board[j];
        if (w === v && w <= maxLevel) n++;
      }
      if (r < 2) {
        const j = i + 3;
        const w = board[j];
        if (w === v && w <= maxLevel) n++;
      }
    }
  }
  return n;
}

/**
 * max 타일·그 4이웃을 제외한 “재압축 레인”에서 빈 칸·저레벨(1~4)·저레벨 머지 쌍이 많을수록 큰 값.
 * scoreBoardV3 / 후반 액션 페널티와 동일 스케일(대략 0~12+).
 */
export function rebuildLaneScore(board: Board): number {
  const mx = maxTileLevel(board);
  if (mx === 0) return 0;
  let maxIdx = -1;
  for (let i = 0; i < LEN; i++) {
    if (board[i] === mx) {
      maxIdx = i;
      break;
    }
  }
  const blocked = new Set<number>([maxIdx]);
  for (const j of neighbors4(maxIdx)) blocked.add(j);

  let empty = 0;
  let lowTiles = 0;
  let lowPairs = 0;
  for (let i = 0; i < LEN; i++) {
    if (blocked.has(i)) continue;
    const v = board[i];
    if (v === 0) empty++;
    else if (v >= 1 && v <= 4) lowTiles++;
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      if (c < 2) {
        const j = i + 1;
        if (blocked.has(i) || blocked.has(j)) continue;
        const v = board[i];
        const w = board[j];
        if (v > 0 && v <= 4 && v === w) lowPairs++;
      }
      if (r < 2) {
        const j = i + 3;
        if (blocked.has(i) || blocked.has(j)) continue;
        const v = board[i];
        const w = board[j];
        if (v > 0 && v <= 4 && v === w) lowPairs++;
      }
    }
  }
  return empty + 0.65 * lowTiles + 1.4 * lowPairs;
}

/**
 * 첫 max 타일 이웃에 작은 수(1~4) 또는 고정 크기 중간 덩어리(4~mx-1)가 끼면 클수록 감점용 스칼라.
 */
export function trappedAroundMaxTile(board: Board): number {
  const mx = maxTileLevel(board);
  if (mx <= 1) return 0;
  let pi = -1;
  for (let i = 0; i < LEN; i++) {
    if (board[i] === mx) {
      pi = i;
      break;
    }
  }
  if (pi < 0) return 0;
  let t = 0;
  for (const j of neighbors4(pi)) {
    const v = board[j];
    if (v >= 1 && v <= 3) t += 1.35;
    else if (v === 4) t += 1.0;
    else if (v >= 5 && v < mx) t += 0.85;
  }
  return t;
}

function countAdjacentEqualPairsAtLevel(board: Board, level: number): number {
  let n = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      if (c < 2) {
        const j = i + 1;
        if (board[i] === level && board[j] === level) n++;
      }
      if (r < 2) {
        const j = i + 3;
        if (board[i] === level && board[j] === level) n++;
      }
    }
  }
  return n;
}

function gapSeparatedLevelPairs(board: Board, level: number): number {
  let n = 0;
  for (let r = 0; r < 3; r++) {
    const a = board[r * 3 + 0];
    const b = board[r * 3 + 1];
    const c0 = board[r * 3 + 2];
    if (a === level && b === 0 && c0 === level) n++;
    if (a === 0 && b === level && c0 === level) n++;
    if (a === level && b === level && c0 === 0) n++;
  }
  for (let c = 0; c < 3; c++) {
    const a = board[0 + c];
    const b = board[3 + c];
    const d = board[6 + c];
    if (a === level && b === 0 && d === level) n++;
    if (a === 0 && b === level && d === level) n++;
    if (a === level && b === level && d === 0) n++;
  }
  return n;
}

function emptyNeighborsOfLevel(board: Board, level: number): number {
  let n = 0;
  for (let i = 0; i < LEN; i++) {
    if (board[i] !== level) continue;
    for (const j of neighbors4(i)) {
      if (board[j] === 0) n++;
    }
  }
  return n;
}

function lowTilePressureNearLevel(board: Board, level: number): number {
  let s = 0;
  for (let i = 0; i < LEN; i++) {
    if (board[i] !== level) continue;
    for (const j of neighbors4(i)) {
      const v = board[j];
      if (v >= 1 && v <= 4) s += 1;
    }
  }
  return s;
}

function sixCellsAdjacentToSeven(board: Board): number {
  let s = 0;
  for (let i = 0; i < LEN; i++) {
    if (board[i] !== 6) continue;
    for (const j of neighbors4(i)) {
      if (board[j] === 7) s += 1;
    }
  }
  return s;
}

/**
 * `level`에서 인접·근접 머지·빈 칸·저레벨 압축 여지 등을 합친 휴리스틱 (클수록 7→8 전환에 유리).
 */
export function mergePotentialAtLevel(board: Board, level: number): number {
  if (level <= 0) return 0;
  const adj = countAdjacentEqualPairsAtLevel(board, level);
  const gap = gapSeparatedLevelPairs(board, level);
  const emptyN = emptyNeighborsOfLevel(board, level);
  const lowP = lowTilePressureNearLevel(board, level);

  let score = adj * 3.2 + gap * 2.0 + emptyN * 0.85 + lowP * 0.12;

  if (level === 7) {
    score += countAdjacentEqualPairsAtLevel(board, 6) * 1.4;
    score += gapSeparatedLevelPairs(board, 6) * 0.7;
    score += sixCellsAdjacentToSeven(board) * 0.9;
  }
  if (level === 6) {
    score += countAdjacentEqualPairsAtLevel(board, 5) * 0.9;
  }

  return score;
}

/**
 * 7→8 전환·듀얼 엔드게임용 집계. tuning 의 mergePotential* 가중 사용.
 */
export function endgame7To8Potential(board: Board, t: EndgameTuning): number {
  const mp7 = mergePotentialAtLevel(board, 7);
  const mp6 = mergePotentialAtLevel(board, 6);
  const reb = rebuildLaneScore(board);
  const trap = trappedAroundMaxTile(board);
  const n7 = countTilesEqual(board, 7);
  const n8 = countTilesEqual(board, 8);
  const z =
    (t.mergePotential7Weight * mp7) / 2000 +
    (t.mergePotential6Weight * mp6) / 2000 +
    6 * reb -
    5 * trap +
    2.5 * n7 +
    3 * n8;
  return Math.max(0, z);
}

/**
 * max≥8 이고 second≥7 일 때: mp7·rebuild·trap 변화 선호.
 */
export function ultraLateSlidePreference(
  before: Board,
  after: Board,
  tuning?: EndgameTuningConfig | null
): number {
  const t = mergeEndgameTuning(tuning);
  if (t.deltaMergePotential7Weight === 0 && t.deltaRebuildPreferenceWeight === 0 && t.deltaTrappedPenaltyWeight === 0) {
    return 0;
  }
  if (maxTileLevel(before) < 8 || secondMaxTile(before) < 7) return 0;

  const d7 = mergePotentialAtLevel(after, 7) - mergePotentialAtLevel(before, 7);
  let p = t.deltaMergePotential7Weight * d7;

  const dr = rebuildLaneScore(after) - rebuildLaneScore(before);
  p += t.deltaRebuildPreferenceWeight * dr;

  const dt = trappedAroundMaxTile(after) - trappedAroundMaxTile(before);
  p -= t.deltaTrappedPenaltyWeight * Math.max(0, dt);
  return p;
}

/** 슬라이드 전 max가 앵커 코너에 있었는데, 슬라이드 후 그 코너가 더 이상 전역 max를 보유하지 않음. */
export function maxTileMovedOffAnchor(before: Board, after: Board, anchorIndex = 8): boolean {
  const mxB = maxTileLevel(before);
  if (mxB === 0) return false;
  if (before[anchorIndex] !== mxB) return false;
  const mxA = maxTileLevel(after);
  return after[anchorIndex] !== mxA;
}

/**
 * maxTile≥7 일 때 슬라이드 직후 보드에 대한 액션 페널티 (expectimax Q에 가산).
 * `tuning` 생략 시 baseline 계수.
 */
export function lateGameSlidePenalty(
  before: Board,
  after: Board,
  anchorIndex = 8,
  tuning?: EndgameTuningConfig | null
): number {
  const t = mergeEndgameTuning(tuning);
  if (maxTileLevel(before) < 7) return 0;
  let p = 0;
  if (maxTileMovedOffAnchor(before, after, anchorIndex)) p -= t.movedOffAnchorPenalty;
  if (emptyCount(after) === 0) p -= t.emptyZeroPenalty;
  const rb = rebuildLaneScore(before);
  const ra = rebuildLaneScore(after);
  if (ra < rb - t.rebuildDropDelta) p -= t.rebuildDropPenalty;
  p += ultraLateSlidePreference(before, after, t);

  if (maxTileLevel(before) >= 7 && maxTileLevel(after) < 9) {
    const okB = highLevelAdjacencyState(before) !== "none";
    const okA = highLevelAdjacencyState(after) !== "none";
    if (!okB && okA) p += t.deltaHighLevelAdjacencyGain;
    if (okB && !okA) p -= t.deltaHighLevelAdjacencyLoss;
  }
  return p;
}

/** 최댓값이 앵커 코너에 있으면 1 */
export function maxTileAtAnchor(board: Board, anchorIndex: number): number {
  const mx = maxTileLevel(board);
  return mx > 0 && board[anchorIndex] === mx ? 1 : 0;
}

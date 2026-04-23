import type { Board, Direction } from "./types";
import { maxTileLevel } from "./board";
import { legalActions } from "./legal";
import { slide } from "./slide";
import { maxTileAtAnchor } from "./boardStats";
import type { TopEndPairability } from "./topEndPairability";
import { createsHighLevelMerge, getMaxTileGap, getTopEndPairability } from "./topEndPairability";
import { countOneStepSurvivors } from "./minimalSurvival";

export type ClosureAnchorIndex = 0 | 2 | 6 | 8;
export type ClosurePhase = "rebuild" | "closure";
export type RebuildFollowupPending = {
  age: number;
  hit4: boolean;
  hit8: boolean;
  hit12: boolean;
  dominantFamilySizeGe2: boolean;
  eventualClosureReadyHitsGe2: boolean;
  eventualOrthAdjHitsGe2: boolean;
};

export type ClosureCtx = {
  active: boolean;
  phase: ClosurePhase | null;
  anchorIndex: ClosureAnchorIndex | null;
  hlMergeAge: number;
  lastDir: Direction | null;
  prevBoard: Board | null;
  prevAction: Direction | null;
  rebuildFollowups: readonly RebuildFollowupPending[];
};

export type ClosureModeStatus = {
  anchor: ClosureAnchorIndex | null;
  phase: ClosurePhase | null;
  detectedAnchor: ClosureAnchorIndex | null;
  gap: number;
  pair: TopEndPairability;
  surv: number;
  legal: number;
  contam: number;
  enter: boolean;
  stay: boolean;
  active: boolean;
};

export const CLOSURE_ANCHORS: readonly ClosureAnchorIndex[] = [0, 2, 6, 8];

function bit(v: boolean): 0 | 1 {
  return v ? 1 : 0;
}

function tieBreakAnchor(board: Board, a: ClosureAnchorIndex, b: ClosureAnchorIndex): number {
  const contamA = anchorBlockContamination(board, a);
  const contamB = anchorBlockContamination(board, b);
  if (contamA !== contamB) return contamA - contamB;

  const topTwoA = bit(topTwoTilesMustRemainInsideAnchorBlock(board, a));
  const topTwoB = bit(topTwoTilesMustRemainInsideAnchorBlock(board, b));
  if (topTwoA !== topTwoB) return topTwoB - topTwoA;

  return a - b;
}

export function createClosureCtx(seed?: Partial<ClosureCtx>): ClosureCtx {
  return {
    active: seed?.active ?? false,
    phase: seed?.phase ?? null,
    anchorIndex: seed?.anchorIndex ?? null,
    hlMergeAge: seed?.hlMergeAge ?? 0,
    lastDir: seed?.lastDir ?? null,
    prevBoard: seed?.prevBoard ?? null,
    prevAction: seed?.prevAction ?? null,
    rebuildFollowups: seed?.rebuildFollowups ?? [],
  };
}

export function anchorBlock(anchorIndex: ClosureAnchorIndex): readonly number[] {
  switch (anchorIndex) {
    case 0:
      return [0, 1, 3, 4];
    case 2:
      return [1, 2, 4, 5];
    case 6:
      return [3, 4, 6, 7];
    case 8:
      return [4, 5, 7, 8];
  }
}

export function detectCornerWithMax(board: Board): ClosureAnchorIndex | null {
  const mx = maxTileLevel(board);
  if (mx === 0) return null;

  const candidates = CLOSURE_ANCHORS.filter((idx) => board[idx] === mx);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => tieBreakAnchor(board, a, b));
  return candidates[0] ?? null;
}

export function anchorBlockContamination(board: Board, anchorIndex: ClosureAnchorIndex): number {
  let total = 0;
  for (const idx of anchorBlock(anchorIndex)) {
    if (idx === anchorIndex) continue;
    const v = board[idx]!;
    if (v >= 1 && v <= 4) total++;
  }
  return total;
}

export function allowedAnchorBlockContamination(board: Board): number {
  return getMaxTileGap(board) <= 1 ? 0 : 1;
}

export function isCornerClean(board: Board, anchorIndex: ClosureAnchorIndex): boolean {
  return anchorBlockContamination(board, anchorIndex) === 0;
}

export function distToAnchor(idx: number, anchorIndex: ClosureAnchorIndex): number {
  const r = Math.floor(idx / 3);
  const c = idx % 3;
  const ar = Math.floor(anchorIndex / 3);
  const ac = anchorIndex % 3;
  return Math.abs(r - ar) + Math.abs(c - ac);
}

type RankedTile = {
  idx: number;
  val: number;
};

function rankTilesByClosureAnchor(board: Board, anchorIndex: ClosureAnchorIndex): RankedTile[] {
  const ranked: RankedTile[] = [];

  for (let i = 0; i < 9; i++) {
    const v = board[i]!;
    if (v > 0) ranked.push({ idx: i, val: v });
  }

  ranked.sort(
    (a, b) =>
      b.val - a.val ||
      distToAnchor(a.idx, anchorIndex) - distToAnchor(b.idx, anchorIndex) ||
      a.idx - b.idx
  );

  return ranked;
}

function manhattanDistance(a: number, b: number): number {
  const ar = Math.floor(a / 3);
  const ac = a % 3;
  const br = Math.floor(b / 3);
  const bc = b % 3;
  return Math.abs(ar - br) + Math.abs(ac - bc);
}

export function getTopTwoDistance(
  board: Board,
  anchorIndex: ClosureAnchorIndex
): number | null {
  const ranked = rankTilesByClosureAnchor(board, anchorIndex);
  if (ranked.length < 2) return null;
  return manhattanDistance(ranked[0]!.idx, ranked[1]!.idx);
}

export function topTwoTilesMustRemainInsideAnchorBlock(
  board: Board,
  anchorIndex: ClosureAnchorIndex
): boolean {
  const block = new Set(anchorBlock(anchorIndex));
  const ranked = rankTilesByClosureAnchor(board, anchorIndex);

  if (ranked.length === 0) return true;
  if (!block.has(ranked[0]!.idx)) return false;
  if (ranked.length === 1) return true;
  return block.has(ranked[1]!.idx);
}

export function topTileMustRemainInsideAnchorBlock(
  board: Board,
  anchorIndex: ClosureAnchorIndex
): boolean {
  const block = new Set(anchorBlock(anchorIndex));
  const ranked = rankTilesByClosureAnchor(board, anchorIndex);

  if (ranked.length === 0) return true;
  return block.has(ranked[0]!.idx);
}

export function hasImmediateHighLevelMerge(board: Board): boolean {
  return legalActions(board).some((dir) => {
    const { next, moved } = slide(board, dir);
    return moved && createsHighLevelMerge(board, next);
  });
}

function isReadyForClosurePhase(board: Board, anchorIndex: ClosureAnchorIndex): boolean {
  return (
    topTwoTilesMustRemainInsideAnchorBlock(board, anchorIndex) &&
    hasImmediateHighLevelMerge(board)
  );
}

export function getClosureModeStatus(board: Board, ctx: ClosureCtx): ClosureModeStatus {
  const detectedAnchor = detectCornerWithMax(board);
  const pair = getTopEndPairability(board);
  const gap = getMaxTileGap(board);
  const surv = countOneStepSurvivors(board);
  const legal = legalActions(board).length;

  const enterContam =
    detectedAnchor == null ? Number.POSITIVE_INFINITY : anchorBlockContamination(board, detectedAnchor);
  const stayContam =
    ctx.anchorIndex == null ? Number.POSITIVE_INFINITY : anchorBlockContamination(board, ctx.anchorIndex);

  const enter =
    !ctx.active &&
    detectedAnchor != null &&
    gap <= 1 &&
    pair.top2OrthAdj &&
    surv >= 5 &&
    legal >= 2 &&
    ctx.hlMergeAge <= 6 &&
    enterContam === 0;

  const stay =
    ctx.active &&
    ctx.anchorIndex != null &&
    maxTileAtAnchor(board, ctx.anchorIndex) === 1 &&
    gap <= 2 &&
    (gap <= 1 ? pair.top2OrthAdj : pair.oneSlideTop2Adj) &&
    surv >= 2 &&
    legal >= 1 &&
    ctx.hlMergeAge <= 8 &&
    stayContam <= (gap <= 1 ? 0 : 1);

  const anchor = stay ? ctx.anchorIndex : enter ? detectedAnchor : null;
  const phase =
    anchor == null
      ? null
      : enter
        ? "rebuild"
        : ctx.phase === "closure" || isReadyForClosurePhase(board, anchor)
          ? "closure"
          : "rebuild";
  const contam =
    anchor == null ? Number.POSITIVE_INFINITY : anchorBlockContamination(board, anchor);

  return {
    anchor,
    phase,
    detectedAnchor,
    gap,
    pair,
    surv,
    legal,
    contam,
    enter,
    stay,
    active: enter || stay,
  };
}

export function shouldEnterClosureMode(board: Board, ctx: ClosureCtx): boolean {
  return getClosureModeStatus(board, ctx).enter;
}

export function shouldExitClosureMode(board: Board, ctx: ClosureCtx): boolean {
  return ctx.active && !getClosureModeStatus(board, ctx).stay;
}

export function shouldUseExtendedClosureDepth(board: Board, ctx: ClosureCtx): boolean {
  const status = getClosureModeStatus(board, ctx);
  return (
    status.anchor != null &&
    status.gap <= 1 &&
    status.pair.top2OrthAdj &&
    status.surv >= 4
  );
}

export function advanceClosureCtx(ctx: ClosureCtx, board: Board, action: Direction): ClosureCtx {
  const status = getClosureModeStatus(board, ctx);
  const { next, moved } = slide(board, action);
  const didHlMerge = moved && createsHighLevelMerge(board, next);

  return {
    active: status.active,
    phase: status.phase,
    anchorIndex: status.anchor,
    hlMergeAge: didHlMerge ? 0 : ctx.hlMergeAge + 1,
    lastDir: action,
    prevBoard: board,
    prevAction: action,
    rebuildFollowups: ctx.rebuildFollowups,
  };
}

import type { Board, Direction } from "./types";
import { legalActions } from "./legal";
import { slide } from "./slide";
import { spawnAll } from "./spawn";
import { maxTileAtAnchor } from "./boardStats";
import type { ClosureAnchorIndex, ClosureCtx, ClosurePhase } from "./closureMode";
import {
  allowedAnchorBlockContamination,
  anchorBlockContamination,
  detectCornerWithMax,
  distToAnchor,
  getClosureModeStatus,
  isCornerClean,
  shouldUseExtendedClosureDepth,
  topTileMustRemainInsideAnchorBlock,
  topTwoTilesMustRemainInsideAnchorBlock,
} from "./closureMode";
import type { ClosureEval, ClosureEvalFields, ClosurePathState } from "./closureEval";
import {
  MIN_CLOSURE_EVAL,
  advanceClosurePathState,
  canCreateHlOpportunitySoon,
  canHlMergeNext,
  closureProgressScore,
  classifyLegalCount,
  classifySurvivalCount,
  compareClosureEval,
  createInitialClosurePathState,
  evaluateClosureLeaf,
  isClosureWindowOpen,
  readClosureEval,
} from "./closureEval";
import { countOneStepSurvivors } from "./minimalSurvival";
import { createsHighLevelMerge, getMaxTileGap, getTopEndPairability } from "./topEndPairability";

type HardPruneReason = "top_one_escaped";

type ChildBranchQualitySummary = {
  count: number;
  viableCountSum: number;
  viableCountGe2Count: number;
  minViableCount: number;
  bestViableCount: number;
};

type CandidateAction = {
  action: Direction;
  afterSlide: Board;
  didHlMerge: boolean;
};

type CandidateSelection = {
  candidates: CandidateAction[];
  afterNoOpCount: number;
  afterHardPruneCount: number;
  afterCapCount: number;
};

type SearchOutcome = {
  eval: ClosureEval;
  path: ClosurePathState;
};

type SearchExplorationTracker = {
  rootGap: number;
  rootSurvival: number;
  rootProgressScore: number;
  anyCanHlMergeNext: boolean;
  anyCanCreateHlOpportunitySoon: boolean;
  anyMadeClosureProgress: boolean;
  anyTopTwoInsideBlock: boolean;
};

export type ViabilityProfile = {
  legalMoveCount: number;
  viableMoveCount: number;
  childViableCounts: number[];
  viableChildCommitmentSignatures: string[];
  distinctViableChildCommitmentSignatureCount: number;
  dominantViableChildCommitmentSignatureShare: number;
  viableChildCommitmentFamilySignatures: string[];
  distinctViableChildCommitmentFamilyCount: number;
  dominantViableChildCommitmentFamilyShare: number;
  viableChildEventualTopEndClasses: string[];
  distinctViableChildEventualTopEndClassCount: number;
  dominantViableChildEventualTopEndClassShare: number;
  eventualOrthAdjHitCount: number;
  eventualOrthAdjHitShare: number;
  eventualOneSlideHitCount: number;
  eventualOneSlideHitShare: number;
  eventualClosureReadyHitCount: number;
  eventualClosureReadyHitShare: number;
  dominantFamilySize: number;
  dominantFamilyShare: number;
  distinctSecondWithinDominantFamilyCount: number;
  dominantSecondWithinDominantFamilyShare: number;
  distinctPairabilityModesWithinDominantFamilyCount: number;
  meanChildViableCount: number;
  minChildViableCount: number;
  maxChildViableCount: number;
  dead: boolean;
  doomed: boolean;
};

export type ClosureSearchConfig = {
  normalDepths?: readonly number[];
  extendedDepths?: readonly number[];
  maxRootActions?: number;
  maxInnerActions?: number;
};

export type ClosureSearchResult = {
  bestDir: Direction | null;
  bestEval: ClosureEval;
  bestEvalFields: ClosureEvalFields;
  bestPath: ClosurePathState | null;
  depthReached: number;
  anchorIndex: ClosureAnchorIndex | null;
  rootTopTwoInsideBlock: 0 | 1;
  rootCanHlMergeNext: 0 | 1;
  rootCanCreateHlOpportunitySoon: 0 | 1;
};

export type ClosureDecisionReport = {
  hasBestDir: boolean;
  viable: boolean;
  didHlMerge: 0 | 1;
  windowUnbrokenAll: 0 | 1;
  windowRunLen: number;
  canHlMergeNext: 0 | 1;
  anchorStableAll: 0 | 1;
  topEndInsideBlockAll: 0 | 1;
  cornerCleanAll: 0 | 1;
  everTopTwoInsideBlock: 0 | 1;
  everCanHlMergeNext: 0 | 1;
  everCanCreateHlOpportunitySoon: 0 | 1;
  everMadeClosureProgress: 0 | 1;
  rootTopTwoInsideBlock: 0 | 1;
  rootCanHlMergeNext: 0 | 1;
  rootCanCreateHlOpportunitySoon: 0 | 1;
  minSurvClassOnPath: 0 | 1 | 2;
  minLegalClassOnPath: 0 | 1 | 2;
  failWindowUnbroken: 0 | 1;
  failWindowRunLen: 0 | 1;
  failCanHlMergeNext: 0 | 1;
  failAnchorStable: 0 | 1;
  failTopEndInside: 0 | 1;
  failCornerClean: 0 | 1;
  failMinSurv: 0 | 1;
  failMinLegal: 0 | 1;
};

export type ClosureDebugCounters = {
  entry: number;
  searchInvoked: number;
  accepted: number;
  fallback: number;
  viable: number;
  didHlMergePath: number;
  repeatedBoardHits: number;
  noBestDir: number;
  evalSamples: number;
  sumWindowRunLen: number;
  windowRunLenGte3: number;
  canHlMergeNextLeaf: number;
  bestEvalSelectedCount: number;
  bestEvalDidHlMergeCount: number;
  bestEvalWindowUnbrokenCount: number;
  bestEvalWindowRunLenSum: number;
  bestEvalWindowRunLenGe1: number;
  bestEvalWindowRunLenGe2: number;
  bestEvalWindowRunLenGe3: number;
  bestEvalCanHlMergeNextCount: number;
  bestEvalAnchorStableAllCount: number;
  bestEvalTopEndInsideBlockAllCount: number;
  bestEvalCornerCleanAllCount: number;
  bestEvalEverTopTwoInsideBlockCount: number;
  bestEvalEverCanHlMergeNextCount: number;
  bestEvalEverCanCreateHlOpportunitySoonCount: number;
  bestEvalEverMadeClosureProgressCount: number;
  bestEvalMinSurvClassGe1Count: number;
  bestEvalMinLegalClassGe1Count: number;
  bestEvalTopTwoDistanceImprovementSum: number;
  bestEvalTopTwoDistanceImprovementGe1Count: number;
  bestPathFollowThroughCount: number;
  rebuildCandidateDeadPositionCount: number;
  rebuildCandidateDoomedPositionCount: number;
  rebuildAcceptedByStableViabilityCount: number;
  rebuildRejectedByStableViabilityCount: number;
  leafViableMoveCountSum: number;
  leafChildViableCountSum: number;
  leafDistinctViableChildCommitmentSignatureCountSum: number;
  leafDominantViableChildCommitmentSignatureShareSum: number;
  leafDistinctViableChildCommitmentFamilyCountSum: number;
  leafDominantViableChildCommitmentFamilyShareSum: number;
  leafDistinctViableChildEventualTopEndClassCountSum: number;
  leafDominantViableChildEventualTopEndClassShareSum: number;
  leafEventualOrthAdjHitCountSum: number;
  leafEventualOrthAdjHitShareSum: number;
  leafEventualOneSlideHitCountSum: number;
  leafEventualOneSlideHitShareSum: number;
  leafEventualClosureReadyHitCountSum: number;
  leafEventualClosureReadyHitShareSum: number;
  leavesAllClosureReadyEventualHitsOrthAdjCount: number;
  leavesMixedClosureReadyEventualHitsCount: number;
  leafDominantFamilySizeSum: number;
  leafDominantFamilyShareSum: number;
  leafDistinctSecondWithinDominantFamilyCountSum: number;
  leafDominantSecondWithinDominantFamilyShareSum: number;
  leafDistinctPairabilityModesWithinDominantFamilyCountSum: number;
  dominantFamilyChildCountSum: number;
  dominantFamilyChildViableCountSum: number;
  dominantFamilyChildViableCountGe2CountSum: number;
  leafDominantFamilyChildMinViableCountSum: number;
  leafDominantFamilyChildBestViableCountSum: number;
  offFamilyChildCountSum: number;
  offFamilyChildViableCountSum: number;
  offFamilyChildViableCountGe2CountSum: number;
  leafOffFamilyChildMinViableCountSum: number;
  leafOffFamilyChildBestViableCountSum: number;
  rebuildLeavesWithOffFamilyChildrenCount: number;
  rebuildLeavesWithDominantFamilySizeGe2Count: number;
  subsetDominantFamilyChildCountSum: number;
  subsetDominantFamilyChildViableCountSum: number;
  subsetDominantFamilyChildViableCountGe2CountSum: number;
  subsetLeafDominantFamilyChildMinViableCountSum: number;
  subsetLeafDominantFamilyChildBestViableCountSum: number;
  subsetOffFamilyChildCountSum: number;
  subsetOffFamilyChildViableCountSum: number;
  subsetOffFamilyChildViableCountGe2CountSum: number;
  subsetLeafOffFamilyChildMinViableCountSum: number;
  subsetLeafOffFamilyChildBestViableCountSum: number;
  subsetLeavesWithOffFamilyChildrenCount: number;
  acceptedLeafViableMoveCountSum: number;
  acceptedLeafChildViableCountSum: number;
  rejectedLeafViableMoveCountSum: number;
  rejectedLeafChildViableCountSum: number;
  minAcceptedLeafChildViableCount: number;
  minRejectedLeafChildViableCount: number;
  rebuildAcceptedByViableMoveCount: number;
  rebuildRejectedByDeadPositionCount: number;
  viableMoveCountAfterAcceptedRebuildSum: number;
  viableMoveCountAfterRejectedRebuildSum: number;
  rebuildCandidateValidatedCount: number;
  rebuildAcceptedByMicroRolloutCount: number;
  rebuildRejectedByMicroRolloutCount: number;
  microRolloutBetterHlCount: number;
  microRolloutBetterSecondMaxCount: number;
  microRolloutBetterDistanceCount: number;
  microRolloutBetterTopTwoInsideCount: number;
  rebuildAcceptedCount: number;
  rebuildEverTopTwoInsideBlockCount: number;
  rebuildCandidateEverTopTwoCount: number;
  rebuildCandidateAcceptedCount: number;
  rebuildCandidateFollowThroughCount: number;
  rebuildRejectedByNoFollowThroughCount: number;
  rebuildCandidateDistanceImprovedCount: number;
  rebuildRejectedByNoDistanceImprovementCount: number;
  rebuildRejectedByWeakGeometryCount: number;
  rebuildRejectedByWeakWindowCount: number;
  rebuildRejectedByWeakSurvivalCount: number;
  rebuildFallbackCount: number;
  hlWithin4AfterRebuildAcceptedCount: number;
  hlWithin8AfterRebuildAcceptedCount: number;
  hlWithin8AfterRebuildAcceptedDominantFamilySizeGe2Count: number;
  hlWithin8AfterRebuildAcceptedDominantFamilySizeEq1Count: number;
  hlWithin8AfterRebuildAcceptedEventualClosureReadyHitsGe2Count: number;
  hlWithin8AfterRebuildAcceptedEventualClosureReadyHitsLt2Count: number;
  hlWithin8AfterRebuildAcceptedEventualOrthAdjHitsGe2Count: number;
  hlWithin8AfterRebuildAcceptedEventualOrthAdjHitsLt2Count: number;
  hlWithin12AfterRebuildAcceptedCount: number;
  rebuildLeafDominantFamilySizeGe2Count: number;
  rebuildLeafDominantFamilySizeEq1Count: number;
  rebuildLeafDominantFamilySizeGe2ViableMoveCountSum: number;
  rebuildLeafDominantFamilySizeEq1ViableMoveCountSum: number;
  rebuildLeafDominantFamilySizeGe2MeanChildViableCountSum: number;
  rebuildLeafDominantFamilySizeEq1MeanChildViableCountSum: number;
  rebuildLeafDominantFamilySizeGe2MinChildViableCountSum: number;
  rebuildLeafDominantFamilySizeEq1MinChildViableCountSum: number;
  rebuildLeafDominantFamilySizeGe2ChildCountSum: number;
  rebuildLeafDominantFamilySizeEq1ChildCountSum: number;
  rebuildLeafDominantFamilySizeGe2ChildViableCountSum: number;
  rebuildLeafDominantFamilySizeEq1ChildViableCountSum: number;
  rebuildLeafDominantFamilySizeGe2ChildViableCountGe2CountSum: number;
  rebuildLeafDominantFamilySizeEq1ChildViableCountGe2CountSum: number;
  rebuildLeafDominantFamilySizeGe2DistinctEventualTopEndClassCountSum: number;
  rebuildLeafDominantFamilySizeEq1DistinctEventualTopEndClassCountSum: number;
  rebuildLeafDominantFamilySizeGe2DominantEventualTopEndClassShareSum: number;
  rebuildLeafDominantFamilySizeEq1DominantEventualTopEndClassShareSum: number;
  rebuildLeafEventualClosureReadyHitsGe2Count: number;
  rebuildLeafEventualClosureReadyHitsLt2Count: number;
  rebuildLeafEventualClosureReadyHitsGe2ViableMoveCountSum: number;
  rebuildLeafEventualClosureReadyHitsLt2ViableMoveCountSum: number;
  rebuildLeafEventualClosureReadyHitsGe2MeanChildViableCountSum: number;
  rebuildLeafEventualClosureReadyHitsLt2MeanChildViableCountSum: number;
  rebuildLeafEventualClosureReadyHitsGe2MinChildViableCountSum: number;
  rebuildLeafEventualClosureReadyHitsLt2MinChildViableCountSum: number;
  rebuildLeafEventualClosureReadyHitsGe2OrthAdjHitCountSum: number;
  rebuildLeafEventualClosureReadyHitsLt2OrthAdjHitCountSum: number;
  rebuildLeafEventualClosureReadyHitsGe2OneSlideHitCountSum: number;
  rebuildLeafEventualClosureReadyHitsLt2OneSlideHitCountSum: number;
  rebuildLeafEventualClosureReadyHitsGe2ClosureReadyHitCountSum: number;
  rebuildLeafEventualClosureReadyHitsLt2ClosureReadyHitCountSum: number;
  rebuildLeafEventualClosureReadyHitsGe2ClosureReadyHitShareSum: number;
  rebuildLeafEventualClosureReadyHitsLt2ClosureReadyHitShareSum: number;
  rebuildLeafEventualClosureReadyHitsGe2ChildCountSum: number;
  rebuildLeafEventualClosureReadyHitsLt2ChildCountSum: number;
  rebuildLeafEventualClosureReadyHitsGe2ChildViableCountSum: number;
  rebuildLeafEventualClosureReadyHitsLt2ChildViableCountSum: number;
  rebuildLeafEventualOrthAdjHitsGe2Count: number;
  rebuildLeafEventualOrthAdjHitsLt2Count: number;
  rebuildLeafEventualOrthAdjHitsGe2ViableMoveCountSum: number;
  rebuildLeafEventualOrthAdjHitsLt2ViableMoveCountSum: number;
  rebuildLeafEventualOrthAdjHitsGe2MeanChildViableCountSum: number;
  rebuildLeafEventualOrthAdjHitsLt2MeanChildViableCountSum: number;
  rebuildLeafEventualOrthAdjHitsGe2MinChildViableCountSum: number;
  rebuildLeafEventualOrthAdjHitsLt2MinChildViableCountSum: number;
  rebuildLeafEventualOrthAdjHitsGe2OrthAdjHitCountSum: number;
  rebuildLeafEventualOrthAdjHitsLt2OrthAdjHitCountSum: number;
  rebuildLeafEventualOrthAdjHitsGe2OrthAdjHitShareSum: number;
  rebuildLeafEventualOrthAdjHitsLt2OrthAdjHitShareSum: number;
  rebuildLeafEventualOrthAdjHitsGe2OneSlideHitCountSum: number;
  rebuildLeafEventualOrthAdjHitsLt2OneSlideHitCountSum: number;
  rebuildLeafEventualOrthAdjHitsGe2OneSlideHitShareSum: number;
  rebuildLeafEventualOrthAdjHitsLt2OneSlideHitShareSum: number;
  rebuildLeafEventualOrthAdjHitsGe2ChildCountSum: number;
  rebuildLeafEventualOrthAdjHitsLt2ChildCountSum: number;
  rebuildLeafEventualOrthAdjHitsGe2ChildViableCountSum: number;
  rebuildLeafEventualOrthAdjHitsLt2ChildViableCountSum: number;
  promotedToClosureCount: number;
  closureAcceptedCount: number;
  closureFallbackCount: number;
  recoveredTopTwoInsideBlockFromBrokenRoot: number;
  recoveredCanHlMergeNextFromBrokenRoot: number;
  recoveredHlOpportunitySoonFromBrokenRoot: number;
  recoveredClosureProgressFromWeakRoot: number;
  exploredNodeCount: number;
  exploredNodeCanHlMergeNextCount: number;
  exploredNodeCanCreateHlOpportunitySoonCount: number;
  exploredNodeMadeClosureProgressCount: number;
  exploredNodeTopTwoInsideBlockCount: number;
  exploredLeafCount: number;
  exploredLeafCanHlMergeNextCount: number;
  exploredLeafCanCreateHlOpportunitySoonCount: number;
  exploredLeafMadeClosureProgressCount: number;
  anyExploredCanHlMergeNextCount: number;
  anyExploredCanCreateHlOpportunitySoonCount: number;
  anyExploredMadeClosureProgressCount: number;
  anyExploredTopTwoInsideBlockCount: number;
  rootSamples: number;
  rootLegalActionCount: number;
  rootCandidateAfterNoOp: number;
  rootCandidateAfterHardPrune: number;
  rootCandidateAfterCap: number;
  rootGeometrySamples: number;
  rootAnchorStable: number;
  rootTopTileInsideBlock: number;
  rootTopTwoInsideBlock: number;
  rootCornerClean: number;
  rootCanHlMergeNext: number;
  rootAllGeometryOk: number;
  rootClosureReadyStrict: number;
  rootClosureReadyLoose: number;
  initSamples: number;
  initAnchorStableAll: number;
  initTopEndInsideBlockAll: number;
  initCornerCleanAll: number;
  pruneTopOneEscaped: number;
  pruneAnchorLost: number;
  pruneContamination: number;
  pruneTopTwoEscaped: number;
  softTopOneBroken: number;
  softTopTwoBroken: number;
  failDidHlMergeOrWindowPath: number;
  failWindowUnbrokenAll: number;
  failWindowRunLen: number;
  failCanHlMergeNext: number;
  failAnchorStableAll: number;
  failTopEndInsideBlockAll: number;
  failCornerCleanAll: number;
  failMinSurvClassOnPath: number;
  failMinLegalClassOnPath: number;
};

export const closureDebugCounters: ClosureDebugCounters = {
  entry: 0,
  searchInvoked: 0,
  accepted: 0,
  fallback: 0,
  viable: 0,
  didHlMergePath: 0,
  repeatedBoardHits: 0,
  noBestDir: 0,
  evalSamples: 0,
  sumWindowRunLen: 0,
  windowRunLenGte3: 0,
  canHlMergeNextLeaf: 0,
  bestEvalSelectedCount: 0,
  bestEvalDidHlMergeCount: 0,
  bestEvalWindowUnbrokenCount: 0,
  bestEvalWindowRunLenSum: 0,
  bestEvalWindowRunLenGe1: 0,
  bestEvalWindowRunLenGe2: 0,
  bestEvalWindowRunLenGe3: 0,
  bestEvalCanHlMergeNextCount: 0,
  bestEvalAnchorStableAllCount: 0,
  bestEvalTopEndInsideBlockAllCount: 0,
  bestEvalCornerCleanAllCount: 0,
  bestEvalEverTopTwoInsideBlockCount: 0,
  bestEvalEverCanHlMergeNextCount: 0,
  bestEvalEverCanCreateHlOpportunitySoonCount: 0,
  bestEvalEverMadeClosureProgressCount: 0,
  bestEvalMinSurvClassGe1Count: 0,
  bestEvalMinLegalClassGe1Count: 0,
  bestEvalTopTwoDistanceImprovementSum: 0,
  bestEvalTopTwoDistanceImprovementGe1Count: 0,
  bestPathFollowThroughCount: 0,
  rebuildCandidateDeadPositionCount: 0,
  rebuildCandidateDoomedPositionCount: 0,
  rebuildAcceptedByStableViabilityCount: 0,
  rebuildRejectedByStableViabilityCount: 0,
  leafViableMoveCountSum: 0,
  leafChildViableCountSum: 0,
  leafDistinctViableChildCommitmentSignatureCountSum: 0,
  leafDominantViableChildCommitmentSignatureShareSum: 0,
  leafDistinctViableChildCommitmentFamilyCountSum: 0,
  leafDominantViableChildCommitmentFamilyShareSum: 0,
  leafDistinctViableChildEventualTopEndClassCountSum: 0,
  leafDominantViableChildEventualTopEndClassShareSum: 0,
  leafEventualOrthAdjHitCountSum: 0,
  leafEventualOrthAdjHitShareSum: 0,
  leafEventualOneSlideHitCountSum: 0,
  leafEventualOneSlideHitShareSum: 0,
  leafEventualClosureReadyHitCountSum: 0,
  leafEventualClosureReadyHitShareSum: 0,
  leavesAllClosureReadyEventualHitsOrthAdjCount: 0,
  leavesMixedClosureReadyEventualHitsCount: 0,
  leafDominantFamilySizeSum: 0,
  leafDominantFamilyShareSum: 0,
  leafDistinctSecondWithinDominantFamilyCountSum: 0,
  leafDominantSecondWithinDominantFamilyShareSum: 0,
  leafDistinctPairabilityModesWithinDominantFamilyCountSum: 0,
  dominantFamilyChildCountSum: 0,
  dominantFamilyChildViableCountSum: 0,
  dominantFamilyChildViableCountGe2CountSum: 0,
  leafDominantFamilyChildMinViableCountSum: 0,
  leafDominantFamilyChildBestViableCountSum: 0,
  offFamilyChildCountSum: 0,
  offFamilyChildViableCountSum: 0,
  offFamilyChildViableCountGe2CountSum: 0,
  leafOffFamilyChildMinViableCountSum: 0,
  leafOffFamilyChildBestViableCountSum: 0,
  rebuildLeavesWithOffFamilyChildrenCount: 0,
  rebuildLeavesWithDominantFamilySizeGe2Count: 0,
  subsetDominantFamilyChildCountSum: 0,
  subsetDominantFamilyChildViableCountSum: 0,
  subsetDominantFamilyChildViableCountGe2CountSum: 0,
  subsetLeafDominantFamilyChildMinViableCountSum: 0,
  subsetLeafDominantFamilyChildBestViableCountSum: 0,
  subsetOffFamilyChildCountSum: 0,
  subsetOffFamilyChildViableCountSum: 0,
  subsetOffFamilyChildViableCountGe2CountSum: 0,
  subsetLeafOffFamilyChildMinViableCountSum: 0,
  subsetLeafOffFamilyChildBestViableCountSum: 0,
  subsetLeavesWithOffFamilyChildrenCount: 0,
  acceptedLeafViableMoveCountSum: 0,
  acceptedLeafChildViableCountSum: 0,
  rejectedLeafViableMoveCountSum: 0,
  rejectedLeafChildViableCountSum: 0,
  minAcceptedLeafChildViableCount: 0,
  minRejectedLeafChildViableCount: 0,
  rebuildAcceptedByViableMoveCount: 0,
  rebuildRejectedByDeadPositionCount: 0,
  viableMoveCountAfterAcceptedRebuildSum: 0,
  viableMoveCountAfterRejectedRebuildSum: 0,
  rebuildCandidateValidatedCount: 0,
  rebuildAcceptedByMicroRolloutCount: 0,
  rebuildRejectedByMicroRolloutCount: 0,
  microRolloutBetterHlCount: 0,
  microRolloutBetterSecondMaxCount: 0,
  microRolloutBetterDistanceCount: 0,
  microRolloutBetterTopTwoInsideCount: 0,
  rebuildAcceptedCount: 0,
  rebuildEverTopTwoInsideBlockCount: 0,
  rebuildCandidateEverTopTwoCount: 0,
  rebuildCandidateAcceptedCount: 0,
  rebuildCandidateFollowThroughCount: 0,
  rebuildRejectedByNoFollowThroughCount: 0,
  rebuildCandidateDistanceImprovedCount: 0,
  rebuildRejectedByNoDistanceImprovementCount: 0,
  rebuildRejectedByWeakGeometryCount: 0,
  rebuildRejectedByWeakWindowCount: 0,
  rebuildRejectedByWeakSurvivalCount: 0,
  rebuildFallbackCount: 0,
  hlWithin4AfterRebuildAcceptedCount: 0,
  hlWithin8AfterRebuildAcceptedCount: 0,
  hlWithin8AfterRebuildAcceptedDominantFamilySizeGe2Count: 0,
  hlWithin8AfterRebuildAcceptedDominantFamilySizeEq1Count: 0,
  hlWithin8AfterRebuildAcceptedEventualClosureReadyHitsGe2Count: 0,
  hlWithin8AfterRebuildAcceptedEventualClosureReadyHitsLt2Count: 0,
  hlWithin8AfterRebuildAcceptedEventualOrthAdjHitsGe2Count: 0,
  hlWithin8AfterRebuildAcceptedEventualOrthAdjHitsLt2Count: 0,
  hlWithin12AfterRebuildAcceptedCount: 0,
  rebuildLeafDominantFamilySizeGe2Count: 0,
  rebuildLeafDominantFamilySizeEq1Count: 0,
  rebuildLeafDominantFamilySizeGe2ViableMoveCountSum: 0,
  rebuildLeafDominantFamilySizeEq1ViableMoveCountSum: 0,
  rebuildLeafDominantFamilySizeGe2MeanChildViableCountSum: 0,
  rebuildLeafDominantFamilySizeEq1MeanChildViableCountSum: 0,
  rebuildLeafDominantFamilySizeGe2MinChildViableCountSum: 0,
  rebuildLeafDominantFamilySizeEq1MinChildViableCountSum: 0,
  rebuildLeafDominantFamilySizeGe2ChildCountSum: 0,
  rebuildLeafDominantFamilySizeEq1ChildCountSum: 0,
  rebuildLeafDominantFamilySizeGe2ChildViableCountSum: 0,
  rebuildLeafDominantFamilySizeEq1ChildViableCountSum: 0,
  rebuildLeafDominantFamilySizeGe2ChildViableCountGe2CountSum: 0,
  rebuildLeafDominantFamilySizeEq1ChildViableCountGe2CountSum: 0,
  rebuildLeafDominantFamilySizeGe2DistinctEventualTopEndClassCountSum: 0,
  rebuildLeafDominantFamilySizeEq1DistinctEventualTopEndClassCountSum: 0,
  rebuildLeafDominantFamilySizeGe2DominantEventualTopEndClassShareSum: 0,
  rebuildLeafDominantFamilySizeEq1DominantEventualTopEndClassShareSum: 0,
  rebuildLeafEventualClosureReadyHitsGe2Count: 0,
  rebuildLeafEventualClosureReadyHitsLt2Count: 0,
  rebuildLeafEventualClosureReadyHitsGe2ViableMoveCountSum: 0,
  rebuildLeafEventualClosureReadyHitsLt2ViableMoveCountSum: 0,
  rebuildLeafEventualClosureReadyHitsGe2MeanChildViableCountSum: 0,
  rebuildLeafEventualClosureReadyHitsLt2MeanChildViableCountSum: 0,
  rebuildLeafEventualClosureReadyHitsGe2MinChildViableCountSum: 0,
  rebuildLeafEventualClosureReadyHitsLt2MinChildViableCountSum: 0,
  rebuildLeafEventualClosureReadyHitsGe2OrthAdjHitCountSum: 0,
  rebuildLeafEventualClosureReadyHitsLt2OrthAdjHitCountSum: 0,
  rebuildLeafEventualClosureReadyHitsGe2OneSlideHitCountSum: 0,
  rebuildLeafEventualClosureReadyHitsLt2OneSlideHitCountSum: 0,
  rebuildLeafEventualClosureReadyHitsGe2ClosureReadyHitCountSum: 0,
  rebuildLeafEventualClosureReadyHitsLt2ClosureReadyHitCountSum: 0,
  rebuildLeafEventualClosureReadyHitsGe2ClosureReadyHitShareSum: 0,
  rebuildLeafEventualClosureReadyHitsLt2ClosureReadyHitShareSum: 0,
  rebuildLeafEventualClosureReadyHitsGe2ChildCountSum: 0,
  rebuildLeafEventualClosureReadyHitsLt2ChildCountSum: 0,
  rebuildLeafEventualClosureReadyHitsGe2ChildViableCountSum: 0,
  rebuildLeafEventualClosureReadyHitsLt2ChildViableCountSum: 0,
  rebuildLeafEventualOrthAdjHitsGe2Count: 0,
  rebuildLeafEventualOrthAdjHitsLt2Count: 0,
  rebuildLeafEventualOrthAdjHitsGe2ViableMoveCountSum: 0,
  rebuildLeafEventualOrthAdjHitsLt2ViableMoveCountSum: 0,
  rebuildLeafEventualOrthAdjHitsGe2MeanChildViableCountSum: 0,
  rebuildLeafEventualOrthAdjHitsLt2MeanChildViableCountSum: 0,
  rebuildLeafEventualOrthAdjHitsGe2MinChildViableCountSum: 0,
  rebuildLeafEventualOrthAdjHitsLt2MinChildViableCountSum: 0,
  rebuildLeafEventualOrthAdjHitsGe2OrthAdjHitCountSum: 0,
  rebuildLeafEventualOrthAdjHitsLt2OrthAdjHitCountSum: 0,
  rebuildLeafEventualOrthAdjHitsGe2OrthAdjHitShareSum: 0,
  rebuildLeafEventualOrthAdjHitsLt2OrthAdjHitShareSum: 0,
  rebuildLeafEventualOrthAdjHitsGe2OneSlideHitCountSum: 0,
  rebuildLeafEventualOrthAdjHitsLt2OneSlideHitCountSum: 0,
  rebuildLeafEventualOrthAdjHitsGe2OneSlideHitShareSum: 0,
  rebuildLeafEventualOrthAdjHitsLt2OneSlideHitShareSum: 0,
  rebuildLeafEventualOrthAdjHitsGe2ChildCountSum: 0,
  rebuildLeafEventualOrthAdjHitsLt2ChildCountSum: 0,
  rebuildLeafEventualOrthAdjHitsGe2ChildViableCountSum: 0,
  rebuildLeafEventualOrthAdjHitsLt2ChildViableCountSum: 0,
  promotedToClosureCount: 0,
  closureAcceptedCount: 0,
  closureFallbackCount: 0,
  recoveredTopTwoInsideBlockFromBrokenRoot: 0,
  recoveredCanHlMergeNextFromBrokenRoot: 0,
  recoveredHlOpportunitySoonFromBrokenRoot: 0,
  recoveredClosureProgressFromWeakRoot: 0,
  exploredNodeCount: 0,
  exploredNodeCanHlMergeNextCount: 0,
  exploredNodeCanCreateHlOpportunitySoonCount: 0,
  exploredNodeMadeClosureProgressCount: 0,
  exploredNodeTopTwoInsideBlockCount: 0,
  exploredLeafCount: 0,
  exploredLeafCanHlMergeNextCount: 0,
  exploredLeafCanCreateHlOpportunitySoonCount: 0,
  exploredLeafMadeClosureProgressCount: 0,
  anyExploredCanHlMergeNextCount: 0,
  anyExploredCanCreateHlOpportunitySoonCount: 0,
  anyExploredMadeClosureProgressCount: 0,
  anyExploredTopTwoInsideBlockCount: 0,
  rootSamples: 0,
  rootLegalActionCount: 0,
  rootCandidateAfterNoOp: 0,
  rootCandidateAfterHardPrune: 0,
  rootCandidateAfterCap: 0,
  rootGeometrySamples: 0,
  rootAnchorStable: 0,
  rootTopTileInsideBlock: 0,
  rootTopTwoInsideBlock: 0,
  rootCornerClean: 0,
  rootCanHlMergeNext: 0,
  rootAllGeometryOk: 0,
  rootClosureReadyStrict: 0,
  rootClosureReadyLoose: 0,
  initSamples: 0,
  initAnchorStableAll: 0,
  initTopEndInsideBlockAll: 0,
  initCornerCleanAll: 0,
  pruneTopOneEscaped: 0,
  pruneAnchorLost: 0,
  pruneContamination: 0,
  pruneTopTwoEscaped: 0,
  softTopOneBroken: 0,
  softTopTwoBroken: 0,
  failDidHlMergeOrWindowPath: 0,
  failWindowUnbrokenAll: 0,
  failWindowRunLen: 0,
  failCanHlMergeNext: 0,
  failAnchorStableAll: 0,
  failTopEndInsideBlockAll: 0,
  failCornerCleanAll: 0,
  failMinSurvClassOnPath: 0,
  failMinLegalClassOnPath: 0,
};

export function resetClosureDebugCounters(): void {
  for (const key of Object.keys(closureDebugCounters) as (keyof ClosureDebugCounters)[]) {
    closureDebugCounters[key] = 0;
  }
}

export function snapshotClosureDebugCounters(): ClosureDebugCounters {
  return { ...closureDebugCounters };
}

const QUICK_TIE_ORDER: Direction[] = ["DOWN", "UP", "LEFT", "RIGHT"];
const DEFAULT_NORMAL_DEPTHS = [2, 4] as const;
const DEFAULT_EXTENDED_DEPTHS = [2, 4, 6, 8] as const;
const DEFAULT_MAX_ROOT_ACTIONS = 3;
const DEFAULT_MAX_INNER_ACTIONS = 2;
const REBUILD_FOLLOW_THROUGH_DEPTH = 4;

function reverseOf(dir: Direction): Direction {
  if (dir === "UP") return "DOWN";
  if (dir === "DOWN") return "UP";
  if (dir === "LEFT") return "RIGHT";
  return "LEFT";
}

function compareLexDesc(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return b[i]! - a[i]!;
  }
  return 0;
}

function boardSig(board: Board): string {
  return board.join(",");
}

function orderedFollowThroughActions(
  board: Board,
  anchorIndex: ClosureAnchorIndex
): readonly Direction[] {
  return legalActions(board)
    .map((action) => {
      const { next } = slide(board, action);
      return {
        action,
        key: [
          createsHighLevelMerge(board, next) ? 1 : 0,
          canHlMergeNext(next),
          topTwoTilesMustRemainInsideAnchorBlock(next, anchorIndex) ? 1 : 0,
          topTileMustRemainInsideAnchorBlock(next, anchorIndex) ? 1 : 0,
        ] as const,
      };
    })
    .sort((a, b) => {
      const cmp = compareLexDesc(a.key, b.key);
      if (cmp !== 0) return cmp;
      return QUICK_TIE_ORDER.indexOf(a.action) - QUICK_TIE_ORDER.indexOf(b.action);
    })
    .map((item) => item.action);
}

export function hasRebuildFollowThrough(
  leafBoard: Board,
  anchorIndex: ClosureAnchorIndex
): boolean {
  const seen = new Set<string>();

  function dfs(board: Board, depthLeft: number): boolean {
    if (canHlMergeNext(board) === 1) return true;
    if (depthLeft <= 0) return false;

    const sig = `${depthLeft}:${boardSig(board)}`;
    if (seen.has(sig)) return false;
    seen.add(sig);

    for (const action of orderedFollowThroughActions(board, anchorIndex)) {
      const { next, moved } = slide(board, action);
      if (!moved) continue;
      if (createsHighLevelMerge(board, next)) return true;
      if (dfs(next, depthLeft - 1)) return true;
    }

    return false;
  }

  return dfs(leafBoard, REBUILD_FOLLOW_THROUGH_DEPTH);
}

function representativeSpawnForViableMove(
  afterSlide: Board,
  anchorIndex: ClosureAnchorIndex | null
): Board {
  const spawned = spawnAll(afterSlide);
  if (spawned.length === 0) return afterSlide;

  if (anchorIndex == null) {
    spawned.sort((a, b) => boardSig(a).localeCompare(boardSig(b)));
    return spawned[0]!;
  }

  spawned.sort((a, b) => compareSpawnRiskWorstFirst(a, b, anchorIndex));
  return spawned[0]!;
}

function applyMoveWithRepresentativeSpawn(
  board: Board,
  move: Direction,
  anchorIndex: ClosureAnchorIndex | null
): { nextBoard: Board; win: boolean } | null {
  const { next, moved, win } = slide(board, move);
  if (!moved) return null;
  if (win) return { nextBoard: next, win: true };
  return {
    nextBoard: representativeSpawnForViableMove(next, anchorIndex),
    win: false,
  };
}

export function isViableMove(
  board: Board,
  move: Direction,
  anchorIndex: ClosureAnchorIndex | null
): boolean {
  const transition = applyMoveWithRepresentativeSpawn(board, move, anchorIndex);
  if (transition == null) return false;
  if (transition.win) return true;

  const afterSpawn = transition.nextBoard;
  const actions = legalActions(afterSpawn);
  const pair = getTopEndPairability(afterSpawn);
  const legalOk = actions.length >= 1;
  const survivalOk = countOneStepSurvivors(afterSpawn) >= 1;
  const anchorOk =
    anchorIndex == null || topTileMustRemainInsideAnchorBlock(afterSpawn, anchorIndex);
  const cleanEnough =
    anchorIndex == null ||
    anchorBlockContamination(afterSpawn, anchorIndex) <=
      Math.max(1, allowedAnchorBlockContamination(afterSpawn));
  const pairOk = pair.top2OrthAdj || pair.oneSlideTop2Adj;
  const structuralScore = Number(anchorOk) + Number(cleanEnough) + Number(pairOk);

  return legalOk && survivalOk && structuralScore >= 2;
}

export function countViableMoves(
  board: Board,
  anchorIndex: ClosureAnchorIndex | null
): number {
  let total = 0;
  for (const move of legalActions(board)) {
    if (isViableMove(board, move, anchorIndex)) total++;
  }
  return total;
}

function avg(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function countAtLeast(values: readonly number[], threshold: number): number {
  let total = 0;
  for (const value of values) {
    if (value >= threshold) total++;
  }
  return total;
}

export function getCommittedTopTilePositions(
  board: Board,
  anchorIndex: ClosureAnchorIndex | null
): [number, number] {
  const ranked: { idx: number; val: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const val = board[i]!;
    if (val > 0) ranked.push({ idx: i, val });
  }

  ranked.sort(
    (a, b) =>
      b.val - a.val ||
      (anchorIndex == null ? 0 : distToAnchor(a.idx, anchorIndex) - distToAnchor(b.idx, anchorIndex)) ||
      a.idx - b.idx
  );

  return [ranked[0]?.idx ?? -1, ranked[1]?.idx ?? -1];
}

function childCommitmentSignature(
  board: Board,
  anchorIndex: ClosureAnchorIndex | null
): string {
  const resolvedAnchor = anchorIndex ?? detectCornerWithMax(board);
  const [maxPos, secondMaxPos] = getCommittedTopTilePositions(board, resolvedAnchor);
  return `${resolvedAnchor ?? -1}|${maxPos}|${secondMaxPos}`;
}

function childCommitmentFamilySignature(
  board: Board,
  anchorIndex: ClosureAnchorIndex | null
): string {
  const resolvedAnchor = anchorIndex ?? detectCornerWithMax(board);
  const [maxPos] = getCommittedTopTilePositions(board, resolvedAnchor);
  return `${resolvedAnchor ?? -1}|${maxPos}`;
}

function dominantSignatureShare(signatures: readonly string[]): number {
  if (signatures.length === 0) return 0;
  const counts = new Map<string, number>();
  let best = 0;
  for (const signature of signatures) {
    const next = (counts.get(signature) ?? 0) + 1;
    counts.set(signature, next);
    if (next > best) best = next;
  }
  return best / signatures.length;
}

function pairabilityModeSignature(board: Board): string {
  const pair = getTopEndPairability(board);
  if (pair.top2OrthAdj) return "top2OrthAdj";
  if (pair.oneSlideTop2Adj) return "oneSlideTop2Adj";
  return "none";
}

function topEndEventClass(board: Board): string {
  const pair = getTopEndPairability(board);
  if (pair.top2OrthAdj) return "top2OrthAdj";
  if (pair.oneSlideTop2Adj) return "oneSlideTop2Adj";
  return "separated";
}

function isClosureReadyEventualClass(eventualClass: string): boolean {
  return eventualClass === "top2OrthAdj" || eventualClass === "oneSlideTop2Adj";
}

function representativeEventualTopEndClass(
  board: Board,
  anchorIndex: ClosureAnchorIndex | null
): string {
  for (const move of legalActions(board)) {
    if (!isViableMove(board, move, anchorIndex)) continue;
    const transition = applyMoveWithRepresentativeSpawn(board, move, anchorIndex);
    if (transition == null) continue;
    return topEndEventClass(transition.nextBoard);
  }
  return topEndEventClass(board);
}

function dominantBucket(
  values: readonly string[]
): { key: string | null; size: number; share: number; indices: number[] } {
  if (values.length === 0) {
    return { key: null, size: 0, share: 0, indices: [] };
  }

  const buckets = new Map<string, number[]>();
  for (let i = 0; i < values.length; i++) {
    const key = values[i]!;
    const existing = buckets.get(key);
    if (existing != null) existing.push(i);
    else buckets.set(key, [i]);
  }

  let bestKey: string | null = null;
  let bestIndices: number[] = [];
  for (const [key, indices] of buckets) {
    if (
      indices.length > bestIndices.length ||
      (indices.length === bestIndices.length && (bestKey == null || key < bestKey))
    ) {
      bestKey = key;
      bestIndices = indices;
    }
  }

  return {
    key: bestKey,
    size: bestIndices.length,
    share: bestIndices.length / values.length,
    indices: bestIndices,
  };
}

function summarizeChildBranchQuality(values: readonly number[]): ChildBranchQualitySummary {
  if (values.length === 0) {
    return {
      count: 0,
      viableCountSum: 0,
      viableCountGe2Count: 0,
      minViableCount: 0,
      bestViableCount: 0,
    };
  }

  let viableCountSum = 0;
  let viableCountGe2Count = 0;
  let minViableCount = values[0]!;
  let bestViableCount = values[0]!;

  for (const value of values) {
    viableCountSum += value;
    if (value >= 2) viableCountGe2Count++;
    if (value < minViableCount) minViableCount = value;
    if (value > bestViableCount) bestViableCount = value;
  }

  return {
    count: values.length,
    viableCountSum,
    viableCountGe2Count,
    minViableCount,
    bestViableCount,
  };
}

function splitDominantFamilyBranchQuality(
  profile: Pick<ViabilityProfile, "childViableCounts" | "viableChildCommitmentFamilySignatures">
): {
  dominant: ChildBranchQualitySummary;
  off: ChildBranchQualitySummary;
  dominantFamilySizeGe2: boolean;
} {
  const dominantFamily = dominantBucket(profile.viableChildCommitmentFamilySignatures);
  const dominantFamilyIndexSet = new Set(dominantFamily.indices);
  const dominantChildViableCounts: number[] = [];
  const offFamilyChildViableCounts: number[] = [];

  for (let i = 0; i < profile.childViableCounts.length; i++) {
    const value = profile.childViableCounts[i]!;
    if (dominantFamilyIndexSet.has(i)) dominantChildViableCounts.push(value);
    else offFamilyChildViableCounts.push(value);
  }

  return {
    dominant: summarizeChildBranchQuality(dominantChildViableCounts),
    off: summarizeChildBranchQuality(offFamilyChildViableCounts),
    dominantFamilySizeGe2: dominantFamily.indices.length >= 2,
  };
}

export function getViabilityProfile(
  board: Board,
  anchorIndex: ClosureAnchorIndex | null
): ViabilityProfile {
  const legalMoves = legalActions(board);
  const childViableCounts: number[] = [];
  const viableChildCommitmentSignatures: string[] = [];
  const viableChildCommitmentFamilySignatures: string[] = [];
  const viableChildEventualTopEndClasses: string[] = [];
  const viableChildSecondPositions: number[] = [];
  const viableChildPairabilityModes: string[] = [];
  let viableMoveCount = 0;

  for (const move of legalMoves) {
    if (!isViableMove(board, move, anchorIndex)) continue;
    viableMoveCount++;

    const transition = applyMoveWithRepresentativeSpawn(board, move, anchorIndex);
    if (transition == null) continue;

    const childAnchorIndex = anchorIndex ?? detectCornerWithMax(transition.nextBoard);
    const [maxPos, secondMaxPos] = getCommittedTopTilePositions(
      transition.nextBoard,
      childAnchorIndex
    );
    viableChildCommitmentSignatures.push(
      `${childAnchorIndex ?? -1}|${maxPos}|${secondMaxPos}`
    );
    viableChildCommitmentFamilySignatures.push(
      `${childAnchorIndex ?? -1}|${maxPos}`
    );
    viableChildEventualTopEndClasses.push(
      transition.win
        ? topEndEventClass(transition.nextBoard)
        : representativeEventualTopEndClass(transition.nextBoard, childAnchorIndex)
    );
    viableChildSecondPositions.push(secondMaxPos);
    viableChildPairabilityModes.push(pairabilityModeSignature(transition.nextBoard));

    if (transition.win) {
      childViableCounts.push(1);
      continue;
    }

    childViableCounts.push(countViableMoves(transition.nextBoard, childAnchorIndex));
  }

  const minChildViableCount =
    childViableCounts.length > 0 ? Math.min(...childViableCounts) : 0;
  const maxChildViableCount =
    childViableCounts.length > 0 ? Math.max(...childViableCounts) : 0;
  const dominantFamily = dominantBucket(viableChildCommitmentFamilySignatures);
  const secondWithinDominantFamily = dominantFamily.indices.map(
    (idx) => String(viableChildSecondPositions[idx] ?? -1)
  );
  const dominantSecondWithinDominantFamily = dominantBucket(secondWithinDominantFamily);
  const pairabilityModesWithinDominantFamily = dominantFamily.indices.map(
    (idx) => viableChildPairabilityModes[idx] ?? "none"
  );
  const eventualOrthAdjHitCount = viableChildEventualTopEndClasses.filter(
    (eventualClass) => eventualClass === "top2OrthAdj"
  ).length;
  const eventualOneSlideHitCount = viableChildEventualTopEndClasses.filter(
    (eventualClass) => eventualClass === "oneSlideTop2Adj"
  ).length;
  const eventualClosureReadyHitCount = viableChildEventualTopEndClasses.filter(
    isClosureReadyEventualClass
  ).length;

  return {
    legalMoveCount: legalMoves.length,
    viableMoveCount,
    childViableCounts,
    viableChildCommitmentSignatures,
    distinctViableChildCommitmentSignatureCount: new Set(viableChildCommitmentSignatures).size,
    dominantViableChildCommitmentSignatureShare: dominantSignatureShare(
      viableChildCommitmentSignatures
    ),
    viableChildCommitmentFamilySignatures,
    distinctViableChildCommitmentFamilyCount: new Set(viableChildCommitmentFamilySignatures).size,
    dominantViableChildCommitmentFamilyShare: dominantSignatureShare(
      viableChildCommitmentFamilySignatures
    ),
    viableChildEventualTopEndClasses,
    distinctViableChildEventualTopEndClassCount: new Set(viableChildEventualTopEndClasses).size,
    dominantViableChildEventualTopEndClassShare: dominantSignatureShare(
      viableChildEventualTopEndClasses
    ),
    eventualOrthAdjHitCount,
    eventualOrthAdjHitShare:
      viableChildEventualTopEndClasses.length > 0
        ? eventualOrthAdjHitCount / viableChildEventualTopEndClasses.length
        : 0,
    eventualOneSlideHitCount,
    eventualOneSlideHitShare:
      viableChildEventualTopEndClasses.length > 0
        ? eventualOneSlideHitCount / viableChildEventualTopEndClasses.length
        : 0,
    eventualClosureReadyHitCount,
    eventualClosureReadyHitShare:
      viableChildEventualTopEndClasses.length > 0
        ? eventualClosureReadyHitCount / viableChildEventualTopEndClasses.length
        : 0,
    dominantFamilySize: dominantFamily.size,
    dominantFamilyShare: dominantFamily.share,
    distinctSecondWithinDominantFamilyCount: new Set(secondWithinDominantFamily).size,
    dominantSecondWithinDominantFamilyShare: dominantSecondWithinDominantFamily.share,
    distinctPairabilityModesWithinDominantFamilyCount: new Set(
      pairabilityModesWithinDominantFamily
    ).size,
    meanChildViableCount: avg(childViableCounts),
    minChildViableCount,
    maxChildViableCount,
    dead: viableMoveCount === 0,
    doomed: viableMoveCount <= 1,
  };
}

export function isDeadPosition(
  board: Board,
  anchorIndex: ClosureAnchorIndex | null
): boolean {
  return getViabilityProfile(board, anchorIndex).dead;
}

function recordHardPrune(reason: HardPruneReason | null): void {
  if (reason === "top_one_escaped") closureDebugCounters.pruneTopOneEscaped++;
}

function recordSoftTopOneBreak(board: Board, anchorIndex: ClosureAnchorIndex): void {
  if (!topTileMustRemainInsideAnchorBlock(board, anchorIndex)) {
    closureDebugCounters.softTopOneBroken++;
  }
}

function recordRootCandidateDiagnostics(
  legalCount: number,
  afterNoOpCount: number,
  afterHardPruneCount: number,
  afterCapCount: number
): void {
  closureDebugCounters.rootSamples++;
  closureDebugCounters.rootLegalActionCount += legalCount;
  closureDebugCounters.rootCandidateAfterNoOp += afterNoOpCount;
  closureDebugCounters.rootCandidateAfterHardPrune += afterHardPruneCount;
  closureDebugCounters.rootCandidateAfterCap += afterCapCount;
}

function recordRootGeometry(board: Board, anchorIndex: ClosureAnchorIndex): void {
  const geom = geometryState(board, anchorIndex);
  const rootCanHlMerge = canHlMergeNext(board);
  const rootAllGeometryOk =
    geom.anchorStable === 1 && geom.topTwoInside === 1 && geom.cleanEnough === 1 ? 1 : 0;
  const rootClosureReadyStrict = rootAllGeometryOk === 1 && rootCanHlMerge === 1 ? 1 : 0;
  const rootClosureReadyLoose =
    geom.topTileInside === 1 && geom.cleanEnough === 1 ? 1 : 0;

  closureDebugCounters.rootGeometrySamples++;
  closureDebugCounters.rootAnchorStable += geom.anchorStable;
  closureDebugCounters.rootTopTileInsideBlock += geom.topTileInside;
  closureDebugCounters.rootTopTwoInsideBlock += geom.topTwoInside;
  closureDebugCounters.rootCornerClean += geom.cleanEnough;
  closureDebugCounters.rootCanHlMergeNext += rootCanHlMerge;
  closureDebugCounters.rootAllGeometryOk += rootAllGeometryOk;
  closureDebugCounters.rootClosureReadyStrict += rootClosureReadyStrict;
  closureDebugCounters.rootClosureReadyLoose += rootClosureReadyLoose;
}

function recordInitialPathState(path: ClosurePathState): void {
  closureDebugCounters.initSamples++;
  closureDebugCounters.initAnchorStableAll += path.anchorStableAll;
  closureDebugCounters.initTopEndInsideBlockAll += path.topEndInsideBlockAll;
  closureDebugCounters.initCornerCleanAll += path.cornerCleanAll;
}

function createExplorationTracker(path: ClosurePathState): SearchExplorationTracker {
  return {
    rootGap: path.rootGap,
    rootSurvival: path.rootSurvival,
    rootProgressScore: path.rootProgressScore,
    anyCanHlMergeNext: false,
    anyCanCreateHlOpportunitySoon: false,
    anyMadeClosureProgress: false,
    anyTopTwoInsideBlock: false,
  };
}

function recordExploredNode(
  board: Board,
  anchorIndex: ClosureAnchorIndex,
  tracker: SearchExplorationTracker
): void {
  const canMergeNext = canHlMergeNext(board);
  const canCreateSoon = canCreateHlOpportunitySoon(board, anchorIndex);
  const madeProgress =
    closureProgressScore(board, anchorIndex, tracker.rootGap, tracker.rootSurvival) >
    tracker.rootProgressScore
      ? 1
      : 0;
  const topTwoInside = topTwoTilesMustRemainInsideAnchorBlock(board, anchorIndex) ? 1 : 0;

  closureDebugCounters.exploredNodeCount++;
  closureDebugCounters.exploredNodeCanHlMergeNextCount += canMergeNext;
  closureDebugCounters.exploredNodeCanCreateHlOpportunitySoonCount += canCreateSoon;
  closureDebugCounters.exploredNodeMadeClosureProgressCount += madeProgress;
  closureDebugCounters.exploredNodeTopTwoInsideBlockCount += topTwoInside;

  if (canMergeNext === 1) tracker.anyCanHlMergeNext = true;
  if (canCreateSoon === 1) tracker.anyCanCreateHlOpportunitySoon = true;
  if (madeProgress === 1) tracker.anyMadeClosureProgress = true;
  if (topTwoInside === 1) tracker.anyTopTwoInsideBlock = true;
}

function recordExploredLeaf(
  board: Board,
  anchorIndex: ClosureAnchorIndex,
  tracker: SearchExplorationTracker
): void {
  const canMergeNext = canHlMergeNext(board);
  const canCreateSoon = canCreateHlOpportunitySoon(board, anchorIndex);
  const madeProgress =
    closureProgressScore(board, anchorIndex, tracker.rootGap, tracker.rootSurvival) >
    tracker.rootProgressScore
      ? 1
      : 0;
  closureDebugCounters.exploredLeafCount++;
  closureDebugCounters.exploredLeafCanHlMergeNextCount += canMergeNext;
  closureDebugCounters.exploredLeafCanCreateHlOpportunitySoonCount += canCreateSoon;
  closureDebugCounters.exploredLeafMadeClosureProgressCount += madeProgress;
  if (canMergeNext === 1) tracker.anyCanHlMergeNext = true;
  if (canCreateSoon === 1) tracker.anyCanCreateHlOpportunitySoon = true;
  if (madeProgress === 1) tracker.anyMadeClosureProgress = true;
}

function finalizeExplorationTracker(tracker: SearchExplorationTracker): void {
  if (tracker.anyCanHlMergeNext) closureDebugCounters.anyExploredCanHlMergeNextCount++;
  if (tracker.anyCanCreateHlOpportunitySoon) {
    closureDebugCounters.anyExploredCanCreateHlOpportunitySoonCount++;
  }
  if (tracker.anyMadeClosureProgress) {
    closureDebugCounters.anyExploredMadeClosureProgressCount++;
  }
  if (tracker.anyTopTwoInsideBlock) closureDebugCounters.anyExploredTopTwoInsideBlockCount++;
}

function getHardPruneReason(board: Board, anchorIndex: ClosureAnchorIndex): HardPruneReason | null {
  return null;
}

function geometryState(
  board: Board,
  anchorIndex: ClosureAnchorIndex
): {
  topTileInside: 0 | 1;
  topTwoInside: 0 | 1;
  anchorStable: 0 | 1;
  cleanEnough: 0 | 1;
  contam: number;
} {
  const contam = anchorBlockContamination(board, anchorIndex);
  return {
    topTileInside: topTileMustRemainInsideAnchorBlock(board, anchorIndex) ? 1 : 0,
    topTwoInside: topTwoTilesMustRemainInsideAnchorBlock(board, anchorIndex) ? 1 : 0,
    anchorStable: maxTileAtAnchor(board, anchorIndex) === 1 ? 1 : 0,
    cleanEnough: contam <= allowedAnchorBlockContamination(board) ? 1 : 0,
    contam,
  };
}

function quickActionKey(
  board: Board,
  afterSlide: Board,
  action: Direction,
  anchorIndex: ClosureAnchorIndex,
  prevDir: Direction | null,
  path: ClosurePathState
): readonly number[] {
  const gap = getMaxTileGap(afterSlide);
  const pair = getTopEndPairability(afterSlide);
  const surv = countOneStepSurvivors(afterSlide);
  const legal = legalActions(afterSlide).length;
  const directionBreak = prevDir !== null && prevDir !== action ? 1 : 0;
  const reversal = prevDir !== null && reverseOf(prevDir) === action ? 1 : 0;
  const geom = geometryState(afterSlide, anchorIndex);
  const nextAnchorStableAll =
    path.anchorStableAll === 1 && geom.anchorStable === 1 ? 1 : 0;
  const nextTopEndInsideBlockAll =
    path.topEndInsideBlockAll === 1 && geom.topTwoInside === 1 ? 1 : 0;
  const nextCornerCleanAll =
    path.cornerCleanAll === 1 && isCornerClean(afterSlide, anchorIndex) ? 1 : 0;
  const nextEverTopTwoInsideBlock =
    path.everTopTwoInsideBlock === 1 || geom.topTwoInside === 1 ? 1 : 0;
  const nextEverCanHlMergeNext =
    path.everCanHlMergeNext === 1 || canHlMergeNext(afterSlide) === 1 ? 1 : 0;
  const nextEverCanCreateHlOpportunitySoon =
    path.everCanCreateHlOpportunitySoon === 1 ||
    canCreateHlOpportunitySoon(afterSlide, anchorIndex) === 1
      ? 1
      : 0;
  const nextEverMadeClosureProgress =
    path.everMadeClosureProgress === 1 ||
    closureProgressScore(afterSlide, anchorIndex, path.rootGap, path.rootSurvival) >
      path.rootProgressScore
      ? 1
      : 0;
  const allGeometryBroken =
    nextAnchorStableAll === 0 &&
    nextTopEndInsideBlockAll === 0 &&
    nextCornerCleanAll === 0
      ? 1
      : 0;

  return [
    geom.topTileInside,
    geom.topTwoInside,
    geom.anchorStable,
    geom.cleanEnough,
    allGeometryBroken === 1 ? 0 : 1,
    createsHighLevelMerge(board, afterSlide) ? 1 : 0,
    isClosureWindowOpen(afterSlide) ? 1 : 0,
    canHlMergeNext(afterSlide),
    classifySurvivalCount(surv),
    classifyLegalCount(legal),
    pair.top2OrthAdj ? 1 : 0,
    pair.oneSlideTop2Adj ? 1 : 0,
    nextAnchorStableAll,
    nextTopEndInsideBlockAll,
    nextCornerCleanAll,
    nextEverTopTwoInsideBlock,
    nextEverMadeClosureProgress,
    nextEverCanCreateHlOpportunitySoon,
    nextEverCanHlMergeNext,
    -geom.contam,
    -gap,
    -directionBreak,
    -reversal,
  ];
}

function shouldFilterOscillatingReverse(
  board: Board,
  action: Direction,
  prevDir: Direction | null,
  afterSlide: Board,
  actionCount: number
): boolean {
  if (prevDir == null || actionCount <= 2) return false;
  if (reverseOf(prevDir) !== action) return false;
  if (createsHighLevelMerge(board, afterSlide)) return false;
  return !isClosureWindowOpen(afterSlide);
}

function selectCandidateActions(
  board: Board,
  actions: Direction[],
  anchorIndex: ClosureAnchorIndex,
  path: ClosurePathState,
  limit: number
): CandidateSelection {
  const afterNoOp: CandidateAction[] = [];

  for (const action of actions) {
    const { next, moved } = slide(board, action);
    if (!moved) continue;
    if (shouldFilterOscillatingReverse(board, action, path.lastDir, next, actions.length)) continue;

    afterNoOp.push({
      action,
      afterSlide: next,
      didHlMerge: createsHighLevelMerge(board, next),
    });
  }

  const afterHardPrune: CandidateAction[] = [];
  for (const candidate of afterNoOp) {
    recordSoftTopOneBreak(candidate.afterSlide, anchorIndex);
    const prune = getHardPruneReason(candidate.afterSlide, anchorIndex);
    if (prune != null) {
      recordHardPrune(prune);
      continue;
    }
    afterHardPrune.push(candidate);
  }

  afterHardPrune.sort((a, b) => {
    const cmp = compareLexDesc(
      quickActionKey(board, a.afterSlide, a.action, anchorIndex, path.lastDir, path),
      quickActionKey(board, b.afterSlide, b.action, anchorIndex, path.lastDir, path)
    );
    if (cmp !== 0) return cmp;
    return QUICK_TIE_ORDER.indexOf(a.action) - QUICK_TIE_ORDER.indexOf(b.action);
  });

  const candidates = afterHardPrune.slice(0, Math.max(1, limit));
  return {
    candidates,
    afterNoOpCount: afterNoOp.length,
    afterHardPruneCount: afterHardPrune.length,
    afterCapCount: candidates.length,
  };
}

export function spawnRiskKey(
  board: Board,
  anchorIndex: ClosureAnchorIndex
): readonly [number, number, number, number, number, number, number, number, number] {
  const geom = geometryState(board, anchorIndex);
  const survClass = classifySurvivalCount(countOneStepSurvivors(board));
  return [
    geom.topTileInside === 1 ? 0 : 1,
    geom.topTwoInside === 1 ? 0 : 1,
    geom.anchorStable === 1 ? 0 : 1,
    geom.cleanEnough === 1 ? 0 : 1,
    canHlMergeNext(board) === 1 ? 0 : 1,
    2 - survClass,
    geom.contam,
    getMaxTileGap(board),
    -legalActions(board).length,
  ];
}

export function compareSpawnRiskWorstFirst(
  a: Board,
  b: Board,
  anchorIndex: ClosureAnchorIndex
): number {
  const ka = spawnRiskKey(a, anchorIndex);
  const kb = spawnRiskKey(b, anchorIndex);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
  }
  return boardSig(a).localeCompare(boardSig(b));
}

function representativeSpawns(afterSlide: Board, anchorIndex: ClosureAnchorIndex): Board[] {
  const spawned = spawnAll(afterSlide).sort((a, b) =>
    compareSpawnRiskWorstFirst(a, b, anchorIndex)
  );

  return spawned.length === 0
    ? []
    : [
        spawned[0]!,
        ...spawned
          .slice(1)
          .filter((s) => compareSpawnRiskWorstFirst(s, spawned[0]!, anchorIndex) === 0)
          .slice(0, 1),
      ];
}

function searchBestOutcome(
  board: Board,
  anchorIndex: ClosureAnchorIndex,
  path: ClosurePathState,
  depthLeft: number,
  cfg: Required<ClosureSearchConfig>,
  tracker: SearchExplorationTracker,
  isRoot = false
): SearchOutcome | null {
  if (depthLeft <= 0) {
    recordExploredLeaf(board, anchorIndex, tracker);
    return { eval: evaluateClosureLeaf(board, path), path };
  }

  const actions = legalActions(board);
  if (actions.length === 0) {
    recordExploredLeaf(board, anchorIndex, tracker);
    return { eval: evaluateClosureLeaf(board, path), path };
  }

  const selection = selectCandidateActions(
    board,
    actions,
    anchorIndex,
    path,
    isRoot ? cfg.maxRootActions : cfg.maxInnerActions
  );
  const candidates = selection.candidates;

  let bestOutcome: SearchOutcome | null = null;
  for (const candidate of candidates) {
    const outcomeForAction = evaluateActionWorstCase(
      board,
      candidate,
      anchorIndex,
      path,
      depthLeft,
      cfg,
      tracker
    );
    if (outcomeForAction == null) continue;
    if (bestOutcome == null || compareClosureEval(outcomeForAction.eval, bestOutcome.eval) > 0) {
      bestOutcome = outcomeForAction;
    }
  }

  return bestOutcome;
}

function evaluateActionWorstCase(
  board: Board,
  candidate: CandidateAction,
  anchorIndex: ClosureAnchorIndex,
  path: ClosurePathState,
  depthLeft: number,
  cfg: Required<ClosureSearchConfig>,
  tracker: SearchExplorationTracker
): SearchOutcome | null {
  const afterSlide = candidate.afterSlide;
  recordExploredNode(afterSlide, anchorIndex, tracker);
  recordSoftTopOneBreak(afterSlide, anchorIndex);
  const slidePrune = getHardPruneReason(afterSlide, anchorIndex);
  if (slidePrune != null) {
    recordHardPrune(slidePrune);
    return null;
  }

  const reps = representativeSpawns(afterSlide, anchorIndex);
  if (reps.length === 0) {
    const nextPath = advanceClosurePathState(
      path,
      afterSlide,
      anchorIndex,
      candidate.action,
      candidate.didHlMerge
    );
    if (depthLeft <= 1) {
      recordExploredLeaf(afterSlide, anchorIndex, tracker);
      return { eval: evaluateClosureLeaf(afterSlide, nextPath), path: nextPath };
    }
    return (
      searchBestOutcome(afterSlide, anchorIndex, nextPath, depthLeft - 1, cfg, tracker) ?? {
        eval: (() => {
          recordExploredLeaf(afterSlide, anchorIndex, tracker);
          return evaluateClosureLeaf(afterSlide, nextPath);
        })(),
        path: nextPath,
      }
    );
  }

  let worstOutcome: SearchOutcome | null = null;
  for (const rep of reps) {
    recordExploredNode(rep, anchorIndex, tracker);
    recordSoftTopOneBreak(rep, anchorIndex);
    const repPrune = getHardPruneReason(rep, anchorIndex);
    if (repPrune != null) {
      recordHardPrune(repPrune);
      return null;
    }

    const nextPath = advanceClosurePathState(
      path,
      rep,
      anchorIndex,
      candidate.action,
      candidate.didHlMerge
    );

    const repOutcome =
      depthLeft <= 1 || legalActions(rep).length === 0
        ? (() => {
            recordExploredLeaf(rep, anchorIndex, tracker);
            return { eval: evaluateClosureLeaf(rep, nextPath), path: nextPath };
          })()
        : searchBestOutcome(rep, anchorIndex, nextPath, depthLeft - 1, cfg, tracker) ?? {
            eval: (() => {
              recordExploredLeaf(rep, anchorIndex, tracker);
              return evaluateClosureLeaf(rep, nextPath);
            })(),
            path: nextPath,
          };

    if (worstOutcome == null || compareClosureEval(repOutcome.eval, worstOutcome.eval) < 0) {
      worstOutcome = repOutcome;
    }
  }

  return worstOutcome;
}

function normalizeConfig(cfg?: ClosureSearchConfig): Required<ClosureSearchConfig> {
  return {
    normalDepths: cfg?.normalDepths ?? DEFAULT_NORMAL_DEPTHS,
    extendedDepths: cfg?.extendedDepths ?? DEFAULT_EXTENDED_DEPTHS,
    maxRootActions: cfg?.maxRootActions ?? DEFAULT_MAX_ROOT_ACTIONS,
    maxInnerActions: cfg?.maxInnerActions ?? DEFAULT_MAX_INNER_ACTIONS,
  };
}

export function getClosureDecisionReport(result: ClosureSearchResult | null): ClosureDecisionReport {
  const fields = result?.bestEvalFields ?? readClosureEval(MIN_CLOSURE_EVAL);
  const bestPath = result?.bestPath;
  const hasBestDir = result?.bestDir != null;

  const failWindowUnbroken =
    hasBestDir && fields.didHlMerge === 0 && fields.windowUnbrokenAll !== 1 ? 1 : 0;
  const failWindowRunLen =
    hasBestDir && fields.didHlMerge === 0 && fields.windowRunLen < 3 ? 1 : 0;
  const failCanHlMergeNext =
    hasBestDir && fields.didHlMerge === 0 && fields.canHlMergeNext !== 1 ? 1 : 0;
  const failAnchorStable =
    hasBestDir && fields.didHlMerge === 0 && fields.anchorStableAll !== 1 ? 1 : 0;
  const failTopEndInside =
    hasBestDir && fields.didHlMerge === 0 && fields.topEndInsideBlockAll !== 1 ? 1 : 0;
  const failCornerClean =
    hasBestDir && fields.didHlMerge === 0 && fields.cornerCleanAll !== 1 ? 1 : 0;
  const failMinSurv =
    hasBestDir && fields.didHlMerge === 0 && fields.minSurvClassOnPath < 1 ? 1 : 0;
  const failMinLegal =
    hasBestDir && fields.didHlMerge === 0 && fields.minLegalClassOnPath < 1 ? 1 : 0;

  const viable =
    hasBestDir &&
    (fields.didHlMerge === 1 ||
      (fields.windowUnbrokenAll === 1 &&
        fields.windowRunLen >= 3 &&
        fields.canHlMergeNext === 1 &&
        fields.anchorStableAll === 1 &&
        fields.topEndInsideBlockAll === 1 &&
        fields.cornerCleanAll === 1 &&
        fields.minSurvClassOnPath >= 1 &&
        fields.minLegalClassOnPath >= 1));

  return {
    hasBestDir,
    viable,
    didHlMerge: fields.didHlMerge,
    windowUnbrokenAll: fields.windowUnbrokenAll,
    windowRunLen: fields.windowRunLen,
    canHlMergeNext: fields.canHlMergeNext,
    anchorStableAll: fields.anchorStableAll,
    topEndInsideBlockAll: fields.topEndInsideBlockAll,
    cornerCleanAll: fields.cornerCleanAll,
    everTopTwoInsideBlock: bestPath?.everTopTwoInsideBlock ?? 0,
    everCanHlMergeNext: bestPath?.everCanHlMergeNext ?? 0,
    everCanCreateHlOpportunitySoon: bestPath?.everCanCreateHlOpportunitySoon ?? 0,
    everMadeClosureProgress: bestPath?.everMadeClosureProgress ?? 0,
    rootTopTwoInsideBlock: result?.rootTopTwoInsideBlock ?? 0,
    rootCanHlMergeNext: result?.rootCanHlMergeNext ?? 0,
    rootCanCreateHlOpportunitySoon: result?.rootCanCreateHlOpportunitySoon ?? 0,
    minSurvClassOnPath: fields.minSurvClassOnPath,
    minLegalClassOnPath: fields.minLegalClassOnPath,
    failWindowUnbroken,
    failWindowRunLen,
    failCanHlMergeNext,
    failAnchorStable,
    failTopEndInside,
    failCornerClean,
    failMinSurv,
    failMinLegal,
  };
}

export function hasRebuildSuccess(
  path:
    | Pick<
        ClosurePathState,
        "leafBoard" | "anchorIndex"
      >
    | null
    | undefined
): boolean {
  if (path == null) return false;
  const profile = getViabilityProfile(path.leafBoard, path.anchorIndex);
  return profile.viableMoveCount >= 2 && profile.minChildViableCount >= 1;
}

function getRebuildCandidateBreakdown(
  path:
    | Pick<
        ClosurePathState,
        "leafBoard" | "anchorIndex"
      >
    | null
    | undefined
): {
  profile: ViabilityProfile;
  accepted: boolean;
} {
  const profile =
    path != null
      ? getViabilityProfile(path.leafBoard, path.anchorIndex)
      : {
          legalMoveCount: 0,
          viableMoveCount: 0,
          childViableCounts: [],
          viableChildCommitmentSignatures: [],
          distinctViableChildCommitmentSignatureCount: 0,
          dominantViableChildCommitmentSignatureShare: 0,
          viableChildCommitmentFamilySignatures: [],
          distinctViableChildCommitmentFamilyCount: 0,
          dominantViableChildCommitmentFamilyShare: 0,
          viableChildEventualTopEndClasses: [],
          distinctViableChildEventualTopEndClassCount: 0,
          dominantViableChildEventualTopEndClassShare: 0,
          eventualOrthAdjHitCount: 0,
          eventualOrthAdjHitShare: 0,
          eventualOneSlideHitCount: 0,
          eventualOneSlideHitShare: 0,
          eventualClosureReadyHitCount: 0,
          eventualClosureReadyHitShare: 0,
          dominantFamilySize: 0,
          dominantFamilyShare: 0,
          distinctSecondWithinDominantFamilyCount: 0,
          dominantSecondWithinDominantFamilyShare: 0,
          distinctPairabilityModesWithinDominantFamilyCount: 0,
          meanChildViableCount: 0,
          minChildViableCount: 0,
          maxChildViableCount: 0,
          dead: true,
          doomed: true,
        };

  return {
    profile,
    accepted: path != null && profile.viableMoveCount >= 2 && profile.minChildViableCount >= 1,
  };
}

function updateTrackedMin(current: number, next: number): number {
  return current === 0 ? next : Math.min(current, next);
}

export function recordClosureDecision(
  report: ClosureDecisionReport,
  accepted: boolean,
  phase: ClosurePhase | null = null,
  bestPath: ClosurePathState | null = null
): void {
  closureDebugCounters.evalSamples++;
  closureDebugCounters.sumWindowRunLen += report.windowRunLen;
  if (report.windowRunLen >= 3) closureDebugCounters.windowRunLenGte3++;
  if (report.canHlMergeNext === 1) closureDebugCounters.canHlMergeNextLeaf++;
  if (report.didHlMerge === 1) closureDebugCounters.didHlMergePath++;
  if (report.topEndInsideBlockAll === 0) closureDebugCounters.softTopTwoBroken++;
  if (report.viable) closureDebugCounters.viable++;
  if (accepted) closureDebugCounters.accepted++;
  else closureDebugCounters.fallback++;
  if (phase === "rebuild") {
    if (report.everTopTwoInsideBlock === 1) closureDebugCounters.rebuildEverTopTwoInsideBlockCount++;
    if (accepted) closureDebugCounters.rebuildAcceptedCount++;
    else closureDebugCounters.rebuildFallbackCount++;
  } else if (phase === "closure") {
    if (accepted) closureDebugCounters.closureAcceptedCount++;
    else closureDebugCounters.closureFallbackCount++;
  }

  if (!report.hasBestDir) {
    closureDebugCounters.noBestDir++;
    return;
  }

  if (phase === "rebuild" && bestPath != null) {
    const rebuild = getRebuildCandidateBreakdown(bestPath);
    const { profile } = rebuild;
    const familyBranchQuality = splitDominantFamilyBranchQuality(profile);

    if (profile.dead) closureDebugCounters.rebuildCandidateDeadPositionCount++;
    if (profile.doomed) closureDebugCounters.rebuildCandidateDoomedPositionCount++;

    closureDebugCounters.leafViableMoveCountSum += profile.viableMoveCount;
    closureDebugCounters.leafChildViableCountSum += profile.meanChildViableCount;
    closureDebugCounters.leafDistinctViableChildCommitmentSignatureCountSum +=
      profile.distinctViableChildCommitmentSignatureCount;
    closureDebugCounters.leafDominantViableChildCommitmentSignatureShareSum +=
      profile.dominantViableChildCommitmentSignatureShare;
    closureDebugCounters.leafDistinctViableChildCommitmentFamilyCountSum +=
      profile.distinctViableChildCommitmentFamilyCount;
    closureDebugCounters.leafDominantViableChildCommitmentFamilyShareSum +=
      profile.dominantViableChildCommitmentFamilyShare;
    closureDebugCounters.leafDistinctViableChildEventualTopEndClassCountSum +=
      profile.distinctViableChildEventualTopEndClassCount;
    closureDebugCounters.leafDominantViableChildEventualTopEndClassShareSum +=
      profile.dominantViableChildEventualTopEndClassShare;
    closureDebugCounters.leafEventualOrthAdjHitCountSum += profile.eventualOrthAdjHitCount;
    closureDebugCounters.leafEventualOrthAdjHitShareSum += profile.eventualOrthAdjHitShare;
    closureDebugCounters.leafEventualOneSlideHitCountSum += profile.eventualOneSlideHitCount;
    closureDebugCounters.leafEventualOneSlideHitShareSum += profile.eventualOneSlideHitShare;
    closureDebugCounters.leafEventualClosureReadyHitCountSum +=
      profile.eventualClosureReadyHitCount;
    closureDebugCounters.leafEventualClosureReadyHitShareSum +=
      profile.eventualClosureReadyHitShare;
    if (profile.eventualOrthAdjHitCount > 0 && profile.eventualOneSlideHitCount === 0) {
      closureDebugCounters.leavesAllClosureReadyEventualHitsOrthAdjCount++;
    }
    if (profile.eventualOrthAdjHitCount > 0 && profile.eventualOneSlideHitCount > 0) {
      closureDebugCounters.leavesMixedClosureReadyEventualHitsCount++;
    }
    closureDebugCounters.leafDominantFamilySizeSum += profile.dominantFamilySize;
    closureDebugCounters.leafDominantFamilyShareSum += profile.dominantFamilyShare;
    closureDebugCounters.leafDistinctSecondWithinDominantFamilyCountSum +=
      profile.distinctSecondWithinDominantFamilyCount;
    closureDebugCounters.leafDominantSecondWithinDominantFamilyShareSum +=
      profile.dominantSecondWithinDominantFamilyShare;
    closureDebugCounters.leafDistinctPairabilityModesWithinDominantFamilyCountSum +=
      profile.distinctPairabilityModesWithinDominantFamilyCount;
    closureDebugCounters.dominantFamilyChildCountSum += familyBranchQuality.dominant.count;
    closureDebugCounters.dominantFamilyChildViableCountSum +=
      familyBranchQuality.dominant.viableCountSum;
    closureDebugCounters.dominantFamilyChildViableCountGe2CountSum +=
      familyBranchQuality.dominant.viableCountGe2Count;
    closureDebugCounters.leafDominantFamilyChildMinViableCountSum +=
      familyBranchQuality.dominant.minViableCount;
    closureDebugCounters.leafDominantFamilyChildBestViableCountSum +=
      familyBranchQuality.dominant.bestViableCount;
    closureDebugCounters.offFamilyChildCountSum += familyBranchQuality.off.count;
    closureDebugCounters.offFamilyChildViableCountSum += familyBranchQuality.off.viableCountSum;
    closureDebugCounters.offFamilyChildViableCountGe2CountSum +=
      familyBranchQuality.off.viableCountGe2Count;
    if (familyBranchQuality.off.count > 0) {
      closureDebugCounters.rebuildLeavesWithOffFamilyChildrenCount++;
      closureDebugCounters.leafOffFamilyChildMinViableCountSum +=
        familyBranchQuality.off.minViableCount;
      closureDebugCounters.leafOffFamilyChildBestViableCountSum +=
        familyBranchQuality.off.bestViableCount;
    }
    if (familyBranchQuality.dominantFamilySizeGe2) {
      closureDebugCounters.rebuildLeavesWithDominantFamilySizeGe2Count++;
      closureDebugCounters.subsetDominantFamilyChildCountSum += familyBranchQuality.dominant.count;
      closureDebugCounters.subsetDominantFamilyChildViableCountSum +=
        familyBranchQuality.dominant.viableCountSum;
      closureDebugCounters.subsetDominantFamilyChildViableCountGe2CountSum +=
        familyBranchQuality.dominant.viableCountGe2Count;
      closureDebugCounters.subsetLeafDominantFamilyChildMinViableCountSum +=
        familyBranchQuality.dominant.minViableCount;
      closureDebugCounters.subsetLeafDominantFamilyChildBestViableCountSum +=
        familyBranchQuality.dominant.bestViableCount;
      closureDebugCounters.subsetOffFamilyChildCountSum += familyBranchQuality.off.count;
      closureDebugCounters.subsetOffFamilyChildViableCountSum +=
        familyBranchQuality.off.viableCountSum;
      closureDebugCounters.subsetOffFamilyChildViableCountGe2CountSum +=
        familyBranchQuality.off.viableCountGe2Count;
      if (familyBranchQuality.off.count > 0) {
        closureDebugCounters.subsetLeavesWithOffFamilyChildrenCount++;
        closureDebugCounters.subsetLeafOffFamilyChildMinViableCountSum +=
          familyBranchQuality.off.minViableCount;
        closureDebugCounters.subsetLeafOffFamilyChildBestViableCountSum +=
          familyBranchQuality.off.bestViableCount;
      }
    }
    if (profile.dominantFamilySize >= 2) {
      closureDebugCounters.rebuildLeafDominantFamilySizeGe2Count++;
      closureDebugCounters.rebuildLeafDominantFamilySizeGe2ViableMoveCountSum +=
        profile.viableMoveCount;
      closureDebugCounters.rebuildLeafDominantFamilySizeGe2MeanChildViableCountSum +=
        profile.meanChildViableCount;
      closureDebugCounters.rebuildLeafDominantFamilySizeGe2MinChildViableCountSum +=
        profile.minChildViableCount;
      closureDebugCounters.rebuildLeafDominantFamilySizeGe2ChildCountSum +=
        profile.childViableCounts.length;
      closureDebugCounters.rebuildLeafDominantFamilySizeGe2ChildViableCountSum += sum(
        profile.childViableCounts
      );
      closureDebugCounters.rebuildLeafDominantFamilySizeGe2ChildViableCountGe2CountSum +=
        countAtLeast(profile.childViableCounts, 2);
      closureDebugCounters.rebuildLeafDominantFamilySizeGe2DistinctEventualTopEndClassCountSum +=
        profile.distinctViableChildEventualTopEndClassCount;
      closureDebugCounters.rebuildLeafDominantFamilySizeGe2DominantEventualTopEndClassShareSum +=
        profile.dominantViableChildEventualTopEndClassShare;
    } else {
      closureDebugCounters.rebuildLeafDominantFamilySizeEq1Count++;
      closureDebugCounters.rebuildLeafDominantFamilySizeEq1ViableMoveCountSum +=
        profile.viableMoveCount;
      closureDebugCounters.rebuildLeafDominantFamilySizeEq1MeanChildViableCountSum +=
        profile.meanChildViableCount;
      closureDebugCounters.rebuildLeafDominantFamilySizeEq1MinChildViableCountSum +=
        profile.minChildViableCount;
      closureDebugCounters.rebuildLeafDominantFamilySizeEq1ChildCountSum +=
        profile.childViableCounts.length;
      closureDebugCounters.rebuildLeafDominantFamilySizeEq1ChildViableCountSum += sum(
        profile.childViableCounts
      );
      closureDebugCounters.rebuildLeafDominantFamilySizeEq1ChildViableCountGe2CountSum +=
        countAtLeast(profile.childViableCounts, 2);
      closureDebugCounters.rebuildLeafDominantFamilySizeEq1DistinctEventualTopEndClassCountSum +=
        profile.distinctViableChildEventualTopEndClassCount;
      closureDebugCounters.rebuildLeafDominantFamilySizeEq1DominantEventualTopEndClassShareSum +=
        profile.dominantViableChildEventualTopEndClassShare;
    }

    if (profile.eventualClosureReadyHitCount >= 2) {
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsGe2Count++;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsGe2ViableMoveCountSum +=
        profile.viableMoveCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsGe2MeanChildViableCountSum +=
        profile.meanChildViableCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsGe2MinChildViableCountSum +=
        profile.minChildViableCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsGe2OrthAdjHitCountSum +=
        profile.eventualOrthAdjHitCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsGe2OneSlideHitCountSum +=
        profile.eventualOneSlideHitCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsGe2ClosureReadyHitCountSum +=
        profile.eventualClosureReadyHitCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsGe2ClosureReadyHitShareSum +=
        profile.eventualClosureReadyHitShare;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsGe2ChildCountSum +=
        profile.childViableCounts.length;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsGe2ChildViableCountSum += sum(
        profile.childViableCounts
      );
    } else {
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsLt2Count++;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsLt2ViableMoveCountSum +=
        profile.viableMoveCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsLt2MeanChildViableCountSum +=
        profile.meanChildViableCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsLt2MinChildViableCountSum +=
        profile.minChildViableCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsLt2OrthAdjHitCountSum +=
        profile.eventualOrthAdjHitCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsLt2OneSlideHitCountSum +=
        profile.eventualOneSlideHitCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsLt2ClosureReadyHitCountSum +=
        profile.eventualClosureReadyHitCount;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsLt2ClosureReadyHitShareSum +=
        profile.eventualClosureReadyHitShare;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsLt2ChildCountSum +=
        profile.childViableCounts.length;
      closureDebugCounters.rebuildLeafEventualClosureReadyHitsLt2ChildViableCountSum += sum(
        profile.childViableCounts
      );
    }

    if (profile.eventualOrthAdjHitCount >= 2) {
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsGe2Count++;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsGe2ViableMoveCountSum +=
        profile.viableMoveCount;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsGe2MeanChildViableCountSum +=
        profile.meanChildViableCount;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsGe2MinChildViableCountSum +=
        profile.minChildViableCount;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsGe2OrthAdjHitCountSum +=
        profile.eventualOrthAdjHitCount;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsGe2OrthAdjHitShareSum +=
        profile.eventualOrthAdjHitShare;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsGe2OneSlideHitCountSum +=
        profile.eventualOneSlideHitCount;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsGe2OneSlideHitShareSum +=
        profile.eventualOneSlideHitShare;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsGe2ChildCountSum +=
        profile.childViableCounts.length;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsGe2ChildViableCountSum += sum(
        profile.childViableCounts
      );
    } else {
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsLt2Count++;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsLt2ViableMoveCountSum +=
        profile.viableMoveCount;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsLt2MeanChildViableCountSum +=
        profile.meanChildViableCount;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsLt2MinChildViableCountSum +=
        profile.minChildViableCount;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsLt2OrthAdjHitCountSum +=
        profile.eventualOrthAdjHitCount;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsLt2OrthAdjHitShareSum +=
        profile.eventualOrthAdjHitShare;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsLt2OneSlideHitCountSum +=
        profile.eventualOneSlideHitCount;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsLt2OneSlideHitShareSum +=
        profile.eventualOneSlideHitShare;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsLt2ChildCountSum +=
        profile.childViableCounts.length;
      closureDebugCounters.rebuildLeafEventualOrthAdjHitsLt2ChildViableCountSum += sum(
        profile.childViableCounts
      );
    }

    if (accepted) {
      closureDebugCounters.rebuildAcceptedByStableViabilityCount++;
      closureDebugCounters.acceptedLeafViableMoveCountSum += profile.viableMoveCount;
      closureDebugCounters.acceptedLeafChildViableCountSum += profile.meanChildViableCount;
      closureDebugCounters.minAcceptedLeafChildViableCount = updateTrackedMin(
        closureDebugCounters.minAcceptedLeafChildViableCount,
        profile.minChildViableCount
      );
    } else {
      closureDebugCounters.rebuildRejectedByStableViabilityCount++;
      closureDebugCounters.rejectedLeafViableMoveCountSum += profile.viableMoveCount;
      closureDebugCounters.rejectedLeafChildViableCountSum += profile.meanChildViableCount;
      closureDebugCounters.minRejectedLeafChildViableCount = updateTrackedMin(
        closureDebugCounters.minRejectedLeafChildViableCount,
        profile.minChildViableCount
      );
    }

    if (profile.dead) {
      closureDebugCounters.rebuildRejectedByDeadPositionCount++;
      closureDebugCounters.viableMoveCountAfterRejectedRebuildSum += profile.viableMoveCount;
    } else if (accepted) {
      closureDebugCounters.rebuildAcceptedByViableMoveCount++;
      closureDebugCounters.viableMoveCountAfterAcceptedRebuildSum += profile.viableMoveCount;
    }
  }

  closureDebugCounters.bestEvalSelectedCount++;
  closureDebugCounters.bestEvalWindowRunLenSum += report.windowRunLen;
  if (report.didHlMerge === 1) closureDebugCounters.bestEvalDidHlMergeCount++;
  if (report.windowUnbrokenAll === 1) closureDebugCounters.bestEvalWindowUnbrokenCount++;
  if (report.windowRunLen >= 1) closureDebugCounters.bestEvalWindowRunLenGe1++;
  if (report.windowRunLen >= 2) closureDebugCounters.bestEvalWindowRunLenGe2++;
  if (report.windowRunLen >= 3) closureDebugCounters.bestEvalWindowRunLenGe3++;
  if (report.canHlMergeNext === 1) closureDebugCounters.bestEvalCanHlMergeNextCount++;
  if (report.anchorStableAll === 1) closureDebugCounters.bestEvalAnchorStableAllCount++;
  if (report.topEndInsideBlockAll === 1) closureDebugCounters.bestEvalTopEndInsideBlockAllCount++;
  if (report.cornerCleanAll === 1) closureDebugCounters.bestEvalCornerCleanAllCount++;
  if (report.everTopTwoInsideBlock === 1) closureDebugCounters.bestEvalEverTopTwoInsideBlockCount++;
  if (report.everCanHlMergeNext === 1) closureDebugCounters.bestEvalEverCanHlMergeNextCount++;
  if (report.everCanCreateHlOpportunitySoon === 1) {
    closureDebugCounters.bestEvalEverCanCreateHlOpportunitySoonCount++;
  }
  if (report.everMadeClosureProgress === 1) {
    closureDebugCounters.bestEvalEverMadeClosureProgressCount++;
  }
  if (report.minSurvClassOnPath >= 1) closureDebugCounters.bestEvalMinSurvClassGe1Count++;
  if (report.minLegalClassOnPath >= 1) closureDebugCounters.bestEvalMinLegalClassGe1Count++;
  closureDebugCounters.bestEvalTopTwoDistanceImprovementSum += bestPath?.bestTopTwoDistanceImprovement ?? 0;
  if ((bestPath?.bestTopTwoDistanceImprovement ?? 0) >= 1) {
    closureDebugCounters.bestEvalTopTwoDistanceImprovementGe1Count++;
  }
  if (report.rootTopTwoInsideBlock === 0 && report.everTopTwoInsideBlock === 1) {
    closureDebugCounters.recoveredTopTwoInsideBlockFromBrokenRoot++;
  }
  if (report.rootCanHlMergeNext === 0 && report.everCanHlMergeNext === 1) {
    closureDebugCounters.recoveredCanHlMergeNextFromBrokenRoot++;
  }
  if (report.rootCanCreateHlOpportunitySoon === 0 && report.everCanCreateHlOpportunitySoon === 1) {
    closureDebugCounters.recoveredHlOpportunitySoonFromBrokenRoot++;
  }
  if (report.rootTopTwoInsideBlock === 0 && report.everMadeClosureProgress === 1) {
    closureDebugCounters.recoveredClosureProgressFromWeakRoot++;
  }

  if (!report.viable) {
    closureDebugCounters.failDidHlMergeOrWindowPath++;
    closureDebugCounters.failWindowUnbrokenAll += report.failWindowUnbroken;
    closureDebugCounters.failWindowRunLen += report.failWindowRunLen;
    closureDebugCounters.failCanHlMergeNext += report.failCanHlMergeNext;
    closureDebugCounters.failAnchorStableAll += report.failAnchorStable;
    closureDebugCounters.failTopEndInsideBlockAll += report.failTopEndInside;
    closureDebugCounters.failCornerCleanAll += report.failCornerClean;
    closureDebugCounters.failMinSurvClassOnPath += report.failMinSurv;
    closureDebugCounters.failMinLegalClassOnPath += report.failMinLegal;
  }
}

export function recordClosureEntry(): void {
  closureDebugCounters.entry++;
}

export function recordClosureRepeatedBoardHit(): void {
  closureDebugCounters.repeatedBoardHits++;
}

export function recordClosureSearchInvocation(): void {
  closureDebugCounters.searchInvoked++;
}

export function meanClosureWindowRunLen(counters: Pick<ClosureDebugCounters, "evalSamples" | "sumWindowRunLen">): number {
  return counters.evalSamples > 0 ? counters.sumWindowRunLen / counters.evalSamples : 0;
}

export function fracClosureWindowRunLenGte3(
  counters: Pick<ClosureDebugCounters, "evalSamples" | "windowRunLenGte3">
): number {
  return counters.evalSamples > 0 ? counters.windowRunLenGte3 / counters.evalSamples : 0;
}

export function fracClosureCanHlMergeNext(
  counters: Pick<ClosureDebugCounters, "evalSamples" | "canHlMergeNextLeaf">
): number {
  return counters.evalSamples > 0 ? counters.canHlMergeNextLeaf / counters.evalSamples : 0;
}

export function fracClosureDidHlMergePath(
  counters: Pick<ClosureDebugCounters, "evalSamples" | "didHlMergePath">
): number {
  return counters.evalSamples > 0 ? counters.didHlMergePath / counters.evalSamples : 0;
}

export function fracClosureAccepted(
  counters: Pick<ClosureDebugCounters, "searchInvoked" | "accepted">
): number {
  return counters.searchInvoked > 0 ? counters.accepted / counters.searchInvoked : 0;
}

export function fracClosureFallback(
  counters: Pick<ClosureDebugCounters, "searchInvoked" | "fallback">
): number {
  return counters.searchInvoked > 0 ? counters.fallback / counters.searchInvoked : 0;
}

export function fracClosureViable(
  counters: Pick<ClosureDebugCounters, "searchInvoked" | "viable">
): number {
  return counters.searchInvoked > 0 ? counters.viable / counters.searchInvoked : 0;
}

export function meanBestEvalWindowRunLen(
  counters: Pick<ClosureDebugCounters, "bestEvalSelectedCount" | "bestEvalWindowRunLenSum">
): number {
  return counters.bestEvalSelectedCount > 0
    ? counters.bestEvalWindowRunLenSum / counters.bestEvalSelectedCount
    : 0;
}

export function meanBestTopTwoDistanceImprovement(
  counters: Pick<ClosureDebugCounters, "bestEvalSelectedCount" | "bestEvalTopTwoDistanceImprovementSum">
): number {
  return counters.bestEvalSelectedCount > 0
    ? counters.bestEvalTopTwoDistanceImprovementSum / counters.bestEvalSelectedCount
    : 0;
}

export function fracBestTopTwoDistanceImprovementGe1(
  counters: Pick<ClosureDebugCounters, "bestEvalSelectedCount" | "bestEvalTopTwoDistanceImprovementGe1Count">
): number {
  return counters.bestEvalSelectedCount > 0
    ? counters.bestEvalTopTwoDistanceImprovementGe1Count / counters.bestEvalSelectedCount
    : 0;
}

export function meanViableMoveCountOnRebuildCandidates(
  counters: Pick<
    ClosureDebugCounters,
    | "rebuildAcceptedByViableMoveCount"
    | "rebuildRejectedByDeadPositionCount"
    | "viableMoveCountAfterAcceptedRebuildSum"
    | "viableMoveCountAfterRejectedRebuildSum"
  >
): number {
  const denom =
    counters.rebuildAcceptedByViableMoveCount + counters.rebuildRejectedByDeadPositionCount;
  return denom > 0
    ? (counters.viableMoveCountAfterAcceptedRebuildSum +
        counters.viableMoveCountAfterRejectedRebuildSum) /
        denom
    : 0;
}

export function meanViableMoveCountAfterAcceptedRebuild(
  counters: Pick<
    ClosureDebugCounters,
    "rebuildAcceptedByViableMoveCount" | "viableMoveCountAfterAcceptedRebuildSum"
  >
): number {
  return counters.rebuildAcceptedByViableMoveCount > 0
    ? counters.viableMoveCountAfterAcceptedRebuildSum / counters.rebuildAcceptedByViableMoveCount
    : 0;
}

export function meanViableMoveCountAfterRejectedRebuild(
  counters: Pick<
    ClosureDebugCounters,
    "rebuildRejectedByDeadPositionCount" | "viableMoveCountAfterRejectedRebuildSum"
  >
): number {
  return counters.rebuildRejectedByDeadPositionCount > 0
    ? counters.viableMoveCountAfterRejectedRebuildSum / counters.rebuildRejectedByDeadPositionCount
    : 0;
}

export function meanLeafViableMoveCount(
  counters: Pick<
    ClosureDebugCounters,
    | "rebuildAcceptedByStableViabilityCount"
    | "rebuildRejectedByStableViabilityCount"
    | "leafViableMoveCountSum"
  >
): number {
  const denom =
    counters.rebuildAcceptedByStableViabilityCount +
    counters.rebuildRejectedByStableViabilityCount;
  return denom > 0 ? counters.leafViableMoveCountSum / denom : 0;
}

export function meanLeafChildViableCount(
  counters: Pick<
    ClosureDebugCounters,
    | "rebuildAcceptedByStableViabilityCount"
    | "rebuildRejectedByStableViabilityCount"
    | "leafChildViableCountSum"
  >
): number {
  const denom =
    counters.rebuildAcceptedByStableViabilityCount +
    counters.rebuildRejectedByStableViabilityCount;
  return denom > 0 ? counters.leafChildViableCountSum / denom : 0;
}

export function meanAcceptedLeafViableMoveCount(
  counters: Pick<
    ClosureDebugCounters,
    "rebuildAcceptedByStableViabilityCount" | "acceptedLeafViableMoveCountSum"
  >
): number {
  return counters.rebuildAcceptedByStableViabilityCount > 0
    ? counters.acceptedLeafViableMoveCountSum / counters.rebuildAcceptedByStableViabilityCount
    : 0;
}

export function meanAcceptedLeafChildViableCount(
  counters: Pick<
    ClosureDebugCounters,
    "rebuildAcceptedByStableViabilityCount" | "acceptedLeafChildViableCountSum"
  >
): number {
  return counters.rebuildAcceptedByStableViabilityCount > 0
    ? counters.acceptedLeafChildViableCountSum / counters.rebuildAcceptedByStableViabilityCount
    : 0;
}

export function meanRejectedLeafViableMoveCount(
  counters: Pick<
    ClosureDebugCounters,
    "rebuildRejectedByStableViabilityCount" | "rejectedLeafViableMoveCountSum"
  >
): number {
  return counters.rebuildRejectedByStableViabilityCount > 0
    ? counters.rejectedLeafViableMoveCountSum / counters.rebuildRejectedByStableViabilityCount
    : 0;
}

export function meanRejectedLeafChildViableCount(
  counters: Pick<
    ClosureDebugCounters,
    "rebuildRejectedByStableViabilityCount" | "rejectedLeafChildViableCountSum"
  >
): number {
  return counters.rebuildRejectedByStableViabilityCount > 0
    ? counters.rejectedLeafChildViableCountSum / counters.rebuildRejectedByStableViabilityCount
    : 0;
}

export function isViableClosureSearchResult(result: ClosureSearchResult | null): boolean {
  if (result == null || result.bestDir == null) return false;
  return getClosureDecisionReport(result).viable;
}

export function closureSearch(
  board: Board,
  actions: Direction[],
  ctx: ClosureCtx,
  cfg?: ClosureSearchConfig
): ClosureSearchResult {
  recordClosureSearchInvocation();

  const normalized = normalizeConfig(cfg);
  const status = getClosureModeStatus(board, ctx);
  const anchorIndex =
    status.anchor ?? (ctx.anchorIndex != null ? ctx.anchorIndex : detectCornerWithMax(board));

  if (anchorIndex == null) {
    return {
      bestDir: null,
      bestEval: MIN_CLOSURE_EVAL,
      bestEvalFields: readClosureEval(MIN_CLOSURE_EVAL),
      bestPath: null,
      depthReached: 0,
      anchorIndex: null,
      rootTopTwoInsideBlock: 0,
      rootCanHlMergeNext: 0,
      rootCanCreateHlOpportunitySoon: 0,
    };
  }

  recordRootGeometry(board, anchorIndex);
  const rootPath = createInitialClosurePathState(board, anchorIndex, ctx.lastDir);
  const tracker = createExplorationTracker(rootPath);
  recordExploredNode(board, anchorIndex, tracker);
  recordInitialPathState(rootPath);
  const rootTopTwoInsideBlock = rootPath.everTopTwoInsideBlock;
  const rootCanHlMergeNext = rootPath.everCanHlMergeNext;
  const rootCanCreateHlOpportunitySoon = rootPath.everCanCreateHlOpportunitySoon;

  const rootActions = actions.filter((dir) => legalActions(board).includes(dir));
  if (rootActions.length === 0) {
    finalizeExplorationTracker(tracker);
    return {
      bestDir: null,
      bestEval: MIN_CLOSURE_EVAL,
      bestEvalFields: readClosureEval(MIN_CLOSURE_EVAL),
      bestPath: rootPath,
      depthReached: 0,
      anchorIndex,
      rootTopTwoInsideBlock,
      rootCanHlMergeNext,
      rootCanCreateHlOpportunitySoon,
    };
  }

  const rootSelection = selectCandidateActions(
    board,
    rootActions,
    anchorIndex,
    rootPath,
    normalized.maxRootActions
  );
  recordRootCandidateDiagnostics(
    rootActions.length,
    rootSelection.afterNoOpCount,
    rootSelection.afterHardPruneCount,
    rootSelection.afterCapCount
  );
  const depths = shouldUseExtendedClosureDepth(board, ctx)
    ? normalized.extendedDepths
    : normalized.normalDepths;

  let bestDir: Direction | null = null;
  let bestEval: ClosureEval = MIN_CLOSURE_EVAL;
  let bestPath: ClosurePathState | null = null;
  let depthReached = 0;

  for (const depth of depths) {
    const candidates = rootSelection.candidates;

    let depthBestDir: Direction | null = null;
    let depthBestEval: ClosureEval | null = null;

    for (const candidate of candidates) {
      const outcomeForAction = evaluateActionWorstCase(
        board,
        candidate,
        anchorIndex,
        rootPath,
        depth,
        normalized,
        tracker
      );
      if (outcomeForAction == null) continue;
      if (depthBestEval == null || compareClosureEval(outcomeForAction.eval, depthBestEval) > 0) {
        depthBestEval = outcomeForAction.eval;
        depthBestDir = candidate.action;
        bestPath = outcomeForAction.path;
      }
    }

    if (depthBestDir != null && depthBestEval != null) {
      bestDir = depthBestDir;
      bestEval = depthBestEval;
      depthReached = depth;
    }
  }

  finalizeExplorationTracker(tracker);

  return {
    bestDir,
    bestEval,
    bestEvalFields: readClosureEval(bestEval),
    bestPath,
    depthReached,
    anchorIndex,
    rootTopTwoInsideBlock,
    rootCanHlMergeNext,
    rootCanCreateHlOpportunitySoon,
  };
}

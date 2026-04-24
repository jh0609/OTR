import {
  createRng,
  emptyBoard,
  emptyCount,
  legalActions,
  slide,
  spawnRandom,
  maxTileLevel,
  secondMaxTile,
  hasSimultaneousOne8AndOne7,
  hasSimultaneousTwo8s,
  hasTwoOrMoreTilesEqual,
  createEarlyPost7LiftMinimalPolicy,
  createHybridPolicy,
  resetMinimalPolicyExperimentDebugCounters,
  snapshotMinimalPolicyExperimentDebugCounters,
  resetClosureDebugCounters,
  snapshotClosureDebugCounters,
  meanClosureWindowRunLen,
  meanBestEvalWindowRunLen,
  meanBestTopTwoDistanceImprovement,
  meanLeafViableMoveCount,
  meanLeafChildViableCount,
  meanAcceptedLeafViableMoveCount,
  meanAcceptedLeafChildViableCount,
  meanRejectedLeafViableMoveCount,
  meanRejectedLeafChildViableCount,
  fracClosureAccepted,
  fracBestTopTwoDistanceImprovementGe1,
  fracClosureCanHlMergeNext,
  fracClosureDidHlMergePath,
  fracClosureFallback,
  fracClosureViable,
  fracClosureWindowRunLenGte3,
  countViableMoves,
  type Board,
  type MinimalPolicyExperimentDebugCounters,
  type Policy,
  type TerminalReason,
  TERMINAL_REASONS,
} from "../src/sim/index.ts";
import type { ClosureDebugCounters } from "../src/sim/closureSearch.ts";
import { getCommittedTopTilePositions } from "../src/sim/closureSearch.ts";
import { detectCornerWithMax } from "../src/sim/closureMode.ts";
import { createsHighLevelMerge } from "../src/sim/topEndPairability.ts";

type EpisodeMetrics = {
  win: boolean;
  steps: number;
  terminalReason: TerminalReason;
  maxLevelReached: number;
  finalMaxLevel: number;
  finalSecondMaxTile: number;
  hlMergeCount: number;
  everTwo7s: boolean;
  everOne8One7: boolean;
  everTwo8s: boolean;
  first7Turn: number | null;
  first8Diagnostics: First8EpisodeDiagnostics;
};

type RunMetrics = {
  episodes: number;
  wins: number;
  avgSteps: number;
  level8ReachRate: number;
  hlConversionRate: number;
  hlChainRate: number;
  avgFinalMaxTile: number;
  avgFinalSecondMaxTile: number;
  avgFirst7EntryTurn: number | null;
  everTwo7sRate: number;
  everOne8One7Rate: number;
  everTwo8sRate: number;
  terminalReasons: Record<TerminalReason, number>;
  first8Research: First8ResearchSummary;
  first8SecondaryResearch: First8ResearchSummary | null;
  earlyPost7RecoveryResearch: EarlyPost7RecoverySummary;
  earlyPost7RecoverySecondaryResearch: EarlyPost7RecoverySummary | null;
};

type WindowSnapshot = {
  emptyCount: number;
  legalMoveCount: number;
  viableMoveCount: number;
  anchorIndex: number;
  maxPos: number;
  secondMaxPos: number;
  secondMaxTile: number;
  occupiedCount: number;
  lowTileCount: number;
  midTileCount: number;
};

type WindowMetrics = {
  meanEmptyCount: number;
  minEmptyCount: number;
  zeroEmptyTurnCount: number;
  zeroEmptyLegalMovesLe2Count: number;
  viableMovesLe1TurnCount: number;
  anchorChangeCount: number;
  maxPosChangeCount: number;
  secondMaxPosChangeCount: number;
  occupiedCountMean: number;
  lowTileCountMean: number;
  midTileCountMean: number;
};

type TernaryBucketCounts = {
  zero: number;
  one: number;
  twoPlus: number;
};

type PlateauBucketCounts = {
  zeroToThree: number;
  fourToSeven: number;
  eightPlus: number;
};

type Post8WindowMetrics = WindowMetrics & {
  post8FinalSecondMax: number;
  post8MaxSecondMax: number;
  secondMaxPlateauLength: number;
};

type EarlyPost7WindowMetrics = {
  post7EarlyForcedCount: number;
  post7EarlyZeroEmptyLegalLe2Count: number;
  post7EarlyMeanEmptyCount: number;
  post7EarlySecondMaxGain: number;
  post7EarlyAnchorChangeCount: number;
  post7EarlySecondMaxPosChangeCount: number;
};

type First8EpisodeDiagnostics = {
  first8Reached: boolean;
  pre8: WindowMetrics | null;
  post8: Post8WindowMetrics | null;
  earlyPost7: EarlyPost7WindowMetrics | null;
};

type First8ResearchGroupAccumulator = {
  episodes: number;
  wins: number;
  everTwo8s: number;
  pre8MeanEmptyCountSum: number;
  pre8MinEmptyCountSum: number;
  pre8ZeroEmptyTurnCountSum: number;
  pre8ZeroEmptyLegalMovesLe2CountSum: number;
  pre8ViableMovesLe1TurnCountSum: number;
  pre8AnchorChangeCountSum: number;
  pre8MaxPosChangeCountSum: number;
  pre8SecondMaxPosChangeCountSum: number;
  pre8OccupiedCountMeanSum: number;
  pre8LowTileCountMeanSum: number;
  pre8MidTileCountMeanSum: number;
  post8MeanEmptyCountSum: number;
  post8MinEmptyCountSum: number;
  post8ZeroEmptyTurnCountSum: number;
  post8ZeroEmptyLegalMovesLe2CountSum: number;
  post8ViableMovesLe1TurnCountSum: number;
  post8AnchorChangeCountSum: number;
  post8MaxPosChangeCountSum: number;
  post8SecondMaxPosChangeCountSum: number;
  post8OccupiedCountMeanSum: number;
  post8LowTileCountMeanSum: number;
  post8MidTileCountMeanSum: number;
  post8FinalSecondMaxSum: number;
  post8MaxSecondMaxSum: number;
  secondMaxPlateauLengthSum: number;
  pre8ZeroEmptyLegalMovesLe2Buckets: TernaryBucketCounts;
  pre8ViableMovesLe1Buckets: TernaryBucketCounts;
  post8ZeroEmptyLegalMovesLe2Buckets: TernaryBucketCounts;
  post8ViableMovesLe1Buckets: TernaryBucketCounts;
  secondMaxPlateauLengthBuckets: PlateauBucketCounts;
};

type First8ResearchGroupSummary = {
  episodes: number;
  wins: number;
  everTwo8s: number;
  pre8MeanEmptyCount: number | null;
  pre8MinEmptyCount: number | null;
  pre8ZeroEmptyTurnCount: number | null;
  pre8ZeroEmptyLegalMovesLe2Count: number | null;
  pre8ViableMovesLe1TurnCount: number | null;
  pre8AnchorChangeCount: number | null;
  pre8MaxPosChangeCount: number | null;
  pre8SecondMaxPosChangeCount: number | null;
  pre8OccupiedCountMean: number | null;
  pre8LowTileCountMean: number | null;
  pre8MidTileCountMean: number | null;
  post8MeanEmptyCount: number | null;
  post8MinEmptyCount: number | null;
  post8ZeroEmptyTurnCount: number | null;
  post8ZeroEmptyLegalMovesLe2Count: number | null;
  post8ViableMovesLe1TurnCount: number | null;
  post8AnchorChangeCount: number | null;
  post8MaxPosChangeCount: number | null;
  post8SecondMaxPosChangeCount: number | null;
  post8OccupiedCountMean: number | null;
  post8LowTileCountMean: number | null;
  post8MidTileCountMean: number | null;
  post8FinalSecondMax: number | null;
  post8MaxSecondMax: number | null;
  secondMaxPlateauLength: number | null;
  pre8ZeroEmptyLegalMovesLe2Buckets: TernaryBucketCounts;
  pre8ViableMovesLe1Buckets: TernaryBucketCounts;
  post8ZeroEmptyLegalMovesLe2Buckets: TernaryBucketCounts;
  post8ViableMovesLe1Buckets: TernaryBucketCounts;
  secondMaxPlateauLengthBuckets: PlateauBucketCounts;
};

type First8ResearchSummary = {
  sampleSize: number;
  noFirst8Count: number;
  post7MaxSecondMaxThreshold: number;
  groupA: First8ResearchGroupSummary;
  groupB: First8ResearchGroupSummary;
};

type EarlyPost7RecoveryGroupAccumulator = {
  episodes: number;
  outcomePost7MaxSecondMaxGeThresholdCount: number;
  post7EarlyForcedCountSum: number;
  post7EarlyZeroEmptyLegalLe2CountSum: number;
  post7EarlyMeanEmptyCountSum: number;
  post7EarlySecondMaxGainSum: number;
  post7EarlyAnchorChangeCountSum: number;
  post7EarlySecondMaxPosChangeCountSum: number;
  post7MaxSecondMaxSum: number;
  post7FinalSecondMaxSum: number;
  secondMaxPlateauLengthSum: number;
};

type EarlyPost7RecoveryGroupSummary = {
  episodes: number;
  outcomePost7MaxSecondMaxGeThresholdCount: number;
  post7EarlyForcedCount: number | null;
  post7EarlyZeroEmptyLegalLe2Count: number | null;
  post7EarlyMeanEmptyCount: number | null;
  post7EarlySecondMaxGain: number | null;
  post7EarlyAnchorChangeCount: number | null;
  post7EarlySecondMaxPosChangeCount: number | null;
  post7MaxSecondMax: number | null;
  post7FinalSecondMax: number | null;
  secondMaxPlateauLength: number | null;
};

type EarlyPost7RecoverySummary = {
  sampleSize: number;
  noFirst7Count: number;
  groupAMaxForcedCount: number;
  outcomePost7MaxSecondMaxThreshold: number;
  groupA: EarlyPost7RecoveryGroupSummary;
  groupB: EarlyPost7RecoveryGroupSummary;
};

const episodesRaw = Number(process.env.CLOSURE_AB_N ?? "1000");
const episodes = Number.isFinite(episodesRaw) && episodesRaw > 0 ? Math.floor(episodesRaw) : 1000;
const seedBaseRaw = Number(process.env.CLOSURE_AB_SEED ?? "20260420");
const seedBase = Number.isFinite(seedBaseRaw) ? Math.floor(seedBaseRaw) : 20260420;
const maxStepsRaw = Number(process.env.CLOSURE_AB_MAX_STEPS ?? "500000");
const maxSteps = Number.isFinite(maxStepsRaw) && maxStepsRaw > 0 ? Math.floor(maxStepsRaw) : 500000;
const PRE8_WINDOW_TURNS = 12;
const POST8_WINDOW_TURNS = 16;
const EARLY_POST7_WINDOW_TURNS = 6;
const LOW_TILE_MAX_LEVEL = 2;
const MID_TILE_MIN_LEVEL = 3;
const MID_TILE_MAX_LEVEL = 5;
const PRIMARY_POST7_SECOND_MAX_THRESHOLD = 6;
const SECONDARY_POST7_SECOND_MAX_THRESHOLD = 5;
const PRIMARY_EARLY_POST7_FORCED_MAX = 0;
const SECONDARY_EARLY_POST7_FORCED_MAX = 1;
const EARLY_POST7_RECOVERY_OUTCOME_THRESHOLD = 5;
const PRIOR_RAW_EARLY_LIFT_REFERENCE = {
  practicalEpisodes: 150,
  first7Sample: 14,
  earlyLiftWindowEntryCount: 84,
  earlyLiftPreferredMoveChosenCount: 15,
  earlyLiftNoGainCandidateCount: 69,
  earlyLiftRejectedByViabilityGuardCount: 1,
  post7MaxSecondMaxGe5Count: 6,
  post7MaxSecondMaxGe6Count: 0,
  avgFinalSecondMaxTile: 4.4,
} as const;
const PRIOR_CAPACITY_BURN_REFERENCE = {
  practicalEpisodes: 150,
  first7Sample: 14,
  earlyLiftWindowEntryCount: 84,
  earlyLiftPreferredMoveChosenCount: 15,
  earlyLiftNoGainCandidateCount: 69,
  earlyLiftRejectedByViabilityCount: 1,
  earlyLiftRejectedByCapacityBurnCount: 0,
  post7MaxSecondMaxGe5Count: 6,
  post7MaxSecondMaxGe6Count: 0,
  avgFinalSecondMaxTile: 4.393,
} as const;
const PRIOR_STRICT_VIABILITY_REFERENCE = {
  practicalEpisodes: 150,
  first7Sample: 14,
  earlyLiftWindowEntryCount: 84,
  earlyLiftPreferredMoveChosenCount: 5,
  earlyLiftNoGainCandidateCount: 64,
  earlyLiftRejectedByViabilityRegressionCount: 18,
  earlyLiftRejectedByNoStrictViabilityGainCount: 18,
  post7MaxSecondMaxGe5Count: 5,
  post7MaxSecondMaxGe6Count: 0,
  avgFinalSecondMaxTile: 4.393,
} as const;
const PRIOR_LOCAL_DOWNSTREAM_PROXY_REFERENCE = {
  practicalEpisodes: 150,
  first7Sample: 14,
  earlyLiftWindowEntryCount: 84,
  earlyLiftPreferredMoveChosenCount: 15,
  earlyLiftNoGainCandidateCount: 69,
  post7MaxSecondMaxGe5Count: 4,
  post7MaxSecondMaxGe6Count: 0,
  avgFinalSecondMaxTile: 4.407,
} as const;
const PRIOR_SHALLOW_FUTURE_PEAK_REFERENCE = {
  practicalEpisodes: 150,
  first7Sample: 14,
  earlyLiftWindowEntryCount: 84,
  earlyLiftPreferredMoveChosenCount: 15,
  earlyLiftNoGainCandidateCount: 69,
  post7MaxSecondMaxGe5Count: 5,
  post7MaxSecondMaxGe6Count: 0,
  avgFinalSecondMaxTile: 4.407,
} as const;
const PRIOR_ANCHOR_ROLLOUT_REFERENCE = {
  practicalEpisodes: 150,
  first7Sample: 14,
  earlyLiftWindowEntryCount: 84,
  earlyLiftPreferredMoveChosenCount: 14,
  earlyLiftNoGainCandidateCount: 65,
  earlyLiftRejectedByAnchorDriftCount: 0,
  post7MaxSecondMaxGe5Count: 4,
  post7MaxSecondMaxGe6Count: 0,
  avgFinalSecondMaxTile: 4.393,
} as const;
const PRIOR_BRANCH_PRUNE_REFERENCE = {
  practicalEpisodes: 150,
  first7Sample: 14,
  earlyLiftWindowEntryCount: 84,
  earlyLiftPreferredMoveChosenCount: 14,
  earlyLiftNoGainCandidateCount: 68,
  post7MaxSecondMaxGe5Count: 3,
  post7MaxSecondMaxGe6Count: 0,
  avgFinalSecondMaxTile: 4.407,
} as const;
const PRIOR_SPAWN_ROBUST_IMMEDIATE_DEAD_REFERENCE = {
  practicalEpisodes: 150,
  first7Sample: 14,
  earlyLiftWindowEntryCount: 84,
  earlyLiftPreferredMoveChosenCount: 84,
  earlyLiftNoGainCandidateCount: 0,
  post7MaxSecondMaxGe5Count: 4,
  post7MaxSecondMaxGe6Count: 0,
  avgFinalSecondMaxTile: 4.387,
} as const;
const EARLY_LIFT_SELECTOR_RULE =
  "merge-opportunity transition filter first; then staged time-bounded best-first search with canonical transposition caching; root-level target=(maxTile-2) pair-reachability ranks root moves only: early skipped, critical soft, post-7 strong preference";

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function avg(sum: number, count: number): number {
  return count > 0 ? sum / count : 0;
}

function avgOrNull(sum: number, count: number): number | null {
  return count > 0 ? sum / count : null;
}

function pctCount(count: number, total: number): string {
  return total > 0 ? pct(count / total) : "n/a";
}

function emptyTernaryBucketCounts(): TernaryBucketCounts {
  return { zero: 0, one: 0, twoPlus: 0 };
}

function emptyPlateauBucketCounts(): PlateauBucketCounts {
  return { zeroToThree: 0, fourToSeven: 0, eightPlus: 0 };
}

function addTernaryBucketCount(buckets: TernaryBucketCounts, value: number): void {
  if (value <= 0) {
    buckets.zero++;
  } else if (value === 1) {
    buckets.one++;
  } else {
    buckets.twoPlus++;
  }
}

function addPlateauBucketCount(buckets: PlateauBucketCounts, value: number): void {
  if (value <= 3) {
    buckets.zeroToThree++;
  } else if (value <= 7) {
    buckets.fourToSeven++;
  } else {
    buckets.eightPlus++;
  }
}

function emptyFirst8ResearchGroupAccumulator(): First8ResearchGroupAccumulator {
  return {
    episodes: 0,
    wins: 0,
    everTwo8s: 0,
    pre8MeanEmptyCountSum: 0,
    pre8MinEmptyCountSum: 0,
    pre8ZeroEmptyTurnCountSum: 0,
    pre8ZeroEmptyLegalMovesLe2CountSum: 0,
    pre8ViableMovesLe1TurnCountSum: 0,
    pre8AnchorChangeCountSum: 0,
    pre8MaxPosChangeCountSum: 0,
    pre8SecondMaxPosChangeCountSum: 0,
    pre8OccupiedCountMeanSum: 0,
    pre8LowTileCountMeanSum: 0,
    pre8MidTileCountMeanSum: 0,
    post8MeanEmptyCountSum: 0,
    post8MinEmptyCountSum: 0,
    post8ZeroEmptyTurnCountSum: 0,
    post8ZeroEmptyLegalMovesLe2CountSum: 0,
    post8ViableMovesLe1TurnCountSum: 0,
    post8AnchorChangeCountSum: 0,
    post8MaxPosChangeCountSum: 0,
    post8SecondMaxPosChangeCountSum: 0,
    post8OccupiedCountMeanSum: 0,
    post8LowTileCountMeanSum: 0,
    post8MidTileCountMeanSum: 0,
    post8FinalSecondMaxSum: 0,
    post8MaxSecondMaxSum: 0,
    secondMaxPlateauLengthSum: 0,
    pre8ZeroEmptyLegalMovesLe2Buckets: emptyTernaryBucketCounts(),
    pre8ViableMovesLe1Buckets: emptyTernaryBucketCounts(),
    post8ZeroEmptyLegalMovesLe2Buckets: emptyTernaryBucketCounts(),
    post8ViableMovesLe1Buckets: emptyTernaryBucketCounts(),
    secondMaxPlateauLengthBuckets: emptyPlateauBucketCounts(),
  };
}

function emptyEarlyPost7RecoveryGroupAccumulator(): EarlyPost7RecoveryGroupAccumulator {
  return {
    episodes: 0,
    outcomePost7MaxSecondMaxGeThresholdCount: 0,
    post7EarlyForcedCountSum: 0,
    post7EarlyZeroEmptyLegalLe2CountSum: 0,
    post7EarlyMeanEmptyCountSum: 0,
    post7EarlySecondMaxGainSum: 0,
    post7EarlyAnchorChangeCountSum: 0,
    post7EarlySecondMaxPosChangeCountSum: 0,
    post7MaxSecondMaxSum: 0,
    post7FinalSecondMaxSum: 0,
    secondMaxPlateauLengthSum: 0,
  };
}

function makeWindowSnapshot(board: Board): WindowSnapshot {
  const anchorIndex = detectCornerWithMax(board);
  const [maxPos, secondMaxPos] = getCommittedTopTilePositions(board, anchorIndex);
  let occupiedCount = 0;
  let lowTileCount = 0;
  let midTileCount = 0;
  for (const value of board) {
    if (value <= 0) continue;
    occupiedCount++;
    if (value <= LOW_TILE_MAX_LEVEL) lowTileCount++;
    if (value >= MID_TILE_MIN_LEVEL && value <= MID_TILE_MAX_LEVEL) midTileCount++;
  }
  return {
    emptyCount: emptyCount(board),
    legalMoveCount: legalActions(board).length,
    viableMoveCount: countViableMoves(board, anchorIndex),
    anchorIndex: anchorIndex ?? -1,
    maxPos,
    secondMaxPos,
    secondMaxTile: secondMaxTile(board),
    occupiedCount,
    lowTileCount,
    midTileCount,
  };
}

function summarizeWindow(boards: readonly Board[]): WindowMetrics | null {
  if (boards.length === 0) return null;
  const snapshots = boards.map(makeWindowSnapshot);
  let emptySum = 0;
  let minEmpty = snapshots[0]!.emptyCount;
  let zeroEmptyTurnCount = 0;
  let zeroEmptyLegalMovesLe2Count = 0;
  let viableMovesLe1TurnCount = 0;
  let occupiedCountSum = 0;
  let lowTileCountSum = 0;
  let midTileCountSum = 0;
  let anchorChangeCount = 0;
  let maxPosChangeCount = 0;
  let secondMaxPosChangeCount = 0;

  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i]!;
    emptySum += snapshot.emptyCount;
    if (snapshot.emptyCount < minEmpty) minEmpty = snapshot.emptyCount;
    if (snapshot.emptyCount === 0) {
      zeroEmptyTurnCount++;
      if (snapshot.legalMoveCount <= 2) zeroEmptyLegalMovesLe2Count++;
    }
    if (snapshot.viableMoveCount <= 1) viableMovesLe1TurnCount++;
    occupiedCountSum += snapshot.occupiedCount;
    lowTileCountSum += snapshot.lowTileCount;
    midTileCountSum += snapshot.midTileCount;
    if (i === 0) continue;
    const prev = snapshots[i - 1]!;
    if (snapshot.anchorIndex !== prev.anchorIndex) anchorChangeCount++;
    if (snapshot.maxPos !== prev.maxPos) maxPosChangeCount++;
    if (snapshot.secondMaxPos !== prev.secondMaxPos) secondMaxPosChangeCount++;
  }

  return {
    meanEmptyCount: avg(emptySum, snapshots.length),
    minEmptyCount: minEmpty,
    zeroEmptyTurnCount,
    zeroEmptyLegalMovesLe2Count,
    viableMovesLe1TurnCount,
    anchorChangeCount,
    maxPosChangeCount,
    secondMaxPosChangeCount,
    occupiedCountMean: avg(occupiedCountSum, snapshots.length),
    lowTileCountMean: avg(lowTileCountSum, snapshots.length),
    midTileCountMean: avg(midTileCountSum, snapshots.length),
  };
}

function longestSecondMaxPlateau(snapshots: readonly WindowSnapshot[]): number {
  if (snapshots.length === 0) return 0;
  let bestSecondMax = -1;
  let currentSpan = 0;
  let longestSpan = 0;
  for (const snapshot of snapshots) {
    if (snapshot.secondMaxTile > bestSecondMax) {
      bestSecondMax = snapshot.secondMaxTile;
      currentSpan = 1;
    } else {
      currentSpan++;
    }
    if (currentSpan > longestSpan) longestSpan = currentSpan;
  }
  return longestSpan;
}

function summarizePost8Window(boards: readonly Board[]): Post8WindowMetrics | null {
  if (boards.length === 0) return null;
  const base = summarizeWindow(boards);
  if (base == null) return null;
  const snapshots = boards.map(makeWindowSnapshot);
  let post8MaxSecondMax = snapshots[0]!.secondMaxTile;
  for (const snapshot of snapshots) {
    if (snapshot.secondMaxTile > post8MaxSecondMax) post8MaxSecondMax = snapshot.secondMaxTile;
  }
  return {
    ...base,
    post8FinalSecondMax: snapshots[snapshots.length - 1]!.secondMaxTile,
    post8MaxSecondMax,
    secondMaxPlateauLength: longestSecondMaxPlateau(snapshots),
  };
}

function summarizeEarlyPost7Window(boards: readonly Board[]): EarlyPost7WindowMetrics | null {
  if (boards.length === 0) return null;
  const base = summarizeWindow(boards);
  if (base == null) return null;
  const snapshots = boards.map(makeWindowSnapshot);
  let earlyMaxSecondMax = snapshots[0]!.secondMaxTile;
  for (const snapshot of snapshots) {
    if (snapshot.secondMaxTile > earlyMaxSecondMax) earlyMaxSecondMax = snapshot.secondMaxTile;
  }
  return {
    post7EarlyForcedCount: base.viableMovesLe1TurnCount,
    post7EarlyZeroEmptyLegalLe2Count: base.zeroEmptyLegalMovesLe2Count,
    post7EarlyMeanEmptyCount: base.meanEmptyCount,
    post7EarlySecondMaxGain: earlyMaxSecondMax - snapshots[0]!.secondMaxTile,
    post7EarlyAnchorChangeCount: base.anchorChangeCount,
    post7EarlySecondMaxPosChangeCount: base.secondMaxPosChangeCount,
  };
}

function analyzeFirst7Episode(pre7Boards: readonly Board[], post7Boards: readonly Board[]): First8EpisodeDiagnostics {
  if (post7Boards.length === 0) {
    return {
      first8Reached: false,
      pre8: null,
      post8: null,
      earlyPost7: null,
    };
  }
  return {
    first8Reached: true,
    pre8: summarizeWindow(pre7Boards),
    post8: summarizePost8Window(post7Boards),
    earlyPost7: summarizeEarlyPost7Window(post7Boards.slice(0, EARLY_POST7_WINDOW_TURNS)),
  };
}

function accumulateFirst8Group(
  acc: First8ResearchGroupAccumulator,
  result: EpisodeMetrics
): void {
  const { pre8, post8 } = result.first8Diagnostics;
  if (pre8 == null || post8 == null) return;
  acc.episodes++;
  if (result.win) acc.wins++;
  if (result.everTwo8s) acc.everTwo8s++;

  acc.pre8MeanEmptyCountSum += pre8.meanEmptyCount;
  acc.pre8MinEmptyCountSum += pre8.minEmptyCount;
  acc.pre8ZeroEmptyTurnCountSum += pre8.zeroEmptyTurnCount;
  acc.pre8ZeroEmptyLegalMovesLe2CountSum += pre8.zeroEmptyLegalMovesLe2Count;
  acc.pre8ViableMovesLe1TurnCountSum += pre8.viableMovesLe1TurnCount;
  acc.pre8AnchorChangeCountSum += pre8.anchorChangeCount;
  acc.pre8MaxPosChangeCountSum += pre8.maxPosChangeCount;
  acc.pre8SecondMaxPosChangeCountSum += pre8.secondMaxPosChangeCount;
  acc.pre8OccupiedCountMeanSum += pre8.occupiedCountMean;
  acc.pre8LowTileCountMeanSum += pre8.lowTileCountMean;
  acc.pre8MidTileCountMeanSum += pre8.midTileCountMean;
  addTernaryBucketCount(acc.pre8ZeroEmptyLegalMovesLe2Buckets, pre8.zeroEmptyLegalMovesLe2Count);
  addTernaryBucketCount(acc.pre8ViableMovesLe1Buckets, pre8.viableMovesLe1TurnCount);

  acc.post8MeanEmptyCountSum += post8.meanEmptyCount;
  acc.post8MinEmptyCountSum += post8.minEmptyCount;
  acc.post8ZeroEmptyTurnCountSum += post8.zeroEmptyTurnCount;
  acc.post8ZeroEmptyLegalMovesLe2CountSum += post8.zeroEmptyLegalMovesLe2Count;
  acc.post8ViableMovesLe1TurnCountSum += post8.viableMovesLe1TurnCount;
  acc.post8AnchorChangeCountSum += post8.anchorChangeCount;
  acc.post8MaxPosChangeCountSum += post8.maxPosChangeCount;
  acc.post8SecondMaxPosChangeCountSum += post8.secondMaxPosChangeCount;
  acc.post8OccupiedCountMeanSum += post8.occupiedCountMean;
  acc.post8LowTileCountMeanSum += post8.lowTileCountMean;
  acc.post8MidTileCountMeanSum += post8.midTileCountMean;
  acc.post8FinalSecondMaxSum += post8.post8FinalSecondMax;
  acc.post8MaxSecondMaxSum += post8.post8MaxSecondMax;
  acc.secondMaxPlateauLengthSum += post8.secondMaxPlateauLength;
  addTernaryBucketCount(acc.post8ZeroEmptyLegalMovesLe2Buckets, post8.zeroEmptyLegalMovesLe2Count);
  addTernaryBucketCount(acc.post8ViableMovesLe1Buckets, post8.viableMovesLe1TurnCount);
  addPlateauBucketCount(acc.secondMaxPlateauLengthBuckets, post8.secondMaxPlateauLength);
}

function finalizeFirst8Group(acc: First8ResearchGroupAccumulator): First8ResearchGroupSummary {
  return {
    episodes: acc.episodes,
    wins: acc.wins,
    everTwo8s: acc.everTwo8s,
    pre8MeanEmptyCount: avgOrNull(acc.pre8MeanEmptyCountSum, acc.episodes),
    pre8MinEmptyCount: avgOrNull(acc.pre8MinEmptyCountSum, acc.episodes),
    pre8ZeroEmptyTurnCount: avgOrNull(acc.pre8ZeroEmptyTurnCountSum, acc.episodes),
    pre8ZeroEmptyLegalMovesLe2Count: avgOrNull(acc.pre8ZeroEmptyLegalMovesLe2CountSum, acc.episodes),
    pre8ViableMovesLe1TurnCount: avgOrNull(acc.pre8ViableMovesLe1TurnCountSum, acc.episodes),
    pre8AnchorChangeCount: avgOrNull(acc.pre8AnchorChangeCountSum, acc.episodes),
    pre8MaxPosChangeCount: avgOrNull(acc.pre8MaxPosChangeCountSum, acc.episodes),
    pre8SecondMaxPosChangeCount: avgOrNull(acc.pre8SecondMaxPosChangeCountSum, acc.episodes),
    pre8OccupiedCountMean: avgOrNull(acc.pre8OccupiedCountMeanSum, acc.episodes),
    pre8LowTileCountMean: avgOrNull(acc.pre8LowTileCountMeanSum, acc.episodes),
    pre8MidTileCountMean: avgOrNull(acc.pre8MidTileCountMeanSum, acc.episodes),
    post8MeanEmptyCount: avgOrNull(acc.post8MeanEmptyCountSum, acc.episodes),
    post8MinEmptyCount: avgOrNull(acc.post8MinEmptyCountSum, acc.episodes),
    post8ZeroEmptyTurnCount: avgOrNull(acc.post8ZeroEmptyTurnCountSum, acc.episodes),
    post8ZeroEmptyLegalMovesLe2Count: avgOrNull(acc.post8ZeroEmptyLegalMovesLe2CountSum, acc.episodes),
    post8ViableMovesLe1TurnCount: avgOrNull(acc.post8ViableMovesLe1TurnCountSum, acc.episodes),
    post8AnchorChangeCount: avgOrNull(acc.post8AnchorChangeCountSum, acc.episodes),
    post8MaxPosChangeCount: avgOrNull(acc.post8MaxPosChangeCountSum, acc.episodes),
    post8SecondMaxPosChangeCount: avgOrNull(acc.post8SecondMaxPosChangeCountSum, acc.episodes),
    post8OccupiedCountMean: avgOrNull(acc.post8OccupiedCountMeanSum, acc.episodes),
    post8LowTileCountMean: avgOrNull(acc.post8LowTileCountMeanSum, acc.episodes),
    post8MidTileCountMean: avgOrNull(acc.post8MidTileCountMeanSum, acc.episodes),
    post8FinalSecondMax: avgOrNull(acc.post8FinalSecondMaxSum, acc.episodes),
    post8MaxSecondMax: avgOrNull(acc.post8MaxSecondMaxSum, acc.episodes),
    secondMaxPlateauLength: avgOrNull(acc.secondMaxPlateauLengthSum, acc.episodes),
    pre8ZeroEmptyLegalMovesLe2Buckets: { ...acc.pre8ZeroEmptyLegalMovesLe2Buckets },
    pre8ViableMovesLe1Buckets: { ...acc.pre8ViableMovesLe1Buckets },
    post8ZeroEmptyLegalMovesLe2Buckets: { ...acc.post8ZeroEmptyLegalMovesLe2Buckets },
    post8ViableMovesLe1Buckets: { ...acc.post8ViableMovesLe1Buckets },
    secondMaxPlateauLengthBuckets: { ...acc.secondMaxPlateauLengthBuckets },
  };
}

function summarizeFirst8Research(
  groupAAcc: First8ResearchGroupAccumulator,
  groupBAcc: First8ResearchGroupAccumulator,
  noFirst8Count: number,
  post7MaxSecondMaxThreshold: number
): First8ResearchSummary {
  return {
    sampleSize: groupAAcc.episodes + groupBAcc.episodes,
    noFirst8Count,
    post7MaxSecondMaxThreshold,
    groupA: finalizeFirst8Group(groupAAcc),
    groupB: finalizeFirst8Group(groupBAcc),
  };
}

function accumulateEarlyPost7RecoveryGroup(
  acc: EarlyPost7RecoveryGroupAccumulator,
  result: EpisodeMetrics
): void {
  const earlyPost7 = result.first8Diagnostics.earlyPost7;
  const post8 = result.first8Diagnostics.post8;
  if (earlyPost7 == null || post8 == null) return;
  acc.episodes++;
  if (post8.post8MaxSecondMax >= EARLY_POST7_RECOVERY_OUTCOME_THRESHOLD) {
    acc.outcomePost7MaxSecondMaxGeThresholdCount++;
  }
  acc.post7EarlyForcedCountSum += earlyPost7.post7EarlyForcedCount;
  acc.post7EarlyZeroEmptyLegalLe2CountSum += earlyPost7.post7EarlyZeroEmptyLegalLe2Count;
  acc.post7EarlyMeanEmptyCountSum += earlyPost7.post7EarlyMeanEmptyCount;
  acc.post7EarlySecondMaxGainSum += earlyPost7.post7EarlySecondMaxGain;
  acc.post7EarlyAnchorChangeCountSum += earlyPost7.post7EarlyAnchorChangeCount;
  acc.post7EarlySecondMaxPosChangeCountSum += earlyPost7.post7EarlySecondMaxPosChangeCount;
  acc.post7MaxSecondMaxSum += post8.post8MaxSecondMax;
  acc.post7FinalSecondMaxSum += post8.post8FinalSecondMax;
  acc.secondMaxPlateauLengthSum += post8.secondMaxPlateauLength;
}

function finalizeEarlyPost7RecoveryGroup(
  acc: EarlyPost7RecoveryGroupAccumulator
): EarlyPost7RecoveryGroupSummary {
  return {
    episodes: acc.episodes,
    outcomePost7MaxSecondMaxGeThresholdCount: acc.outcomePost7MaxSecondMaxGeThresholdCount,
    post7EarlyForcedCount: avgOrNull(acc.post7EarlyForcedCountSum, acc.episodes),
    post7EarlyZeroEmptyLegalLe2Count: avgOrNull(acc.post7EarlyZeroEmptyLegalLe2CountSum, acc.episodes),
    post7EarlyMeanEmptyCount: avgOrNull(acc.post7EarlyMeanEmptyCountSum, acc.episodes),
    post7EarlySecondMaxGain: avgOrNull(acc.post7EarlySecondMaxGainSum, acc.episodes),
    post7EarlyAnchorChangeCount: avgOrNull(acc.post7EarlyAnchorChangeCountSum, acc.episodes),
    post7EarlySecondMaxPosChangeCount: avgOrNull(
      acc.post7EarlySecondMaxPosChangeCountSum,
      acc.episodes
    ),
    post7MaxSecondMax: avgOrNull(acc.post7MaxSecondMaxSum, acc.episodes),
    post7FinalSecondMax: avgOrNull(acc.post7FinalSecondMaxSum, acc.episodes),
    secondMaxPlateauLength: avgOrNull(acc.secondMaxPlateauLengthSum, acc.episodes),
  };
}

function summarizeEarlyPost7Recovery(
  groupAAcc: EarlyPost7RecoveryGroupAccumulator,
  groupBAcc: EarlyPost7RecoveryGroupAccumulator,
  noFirst7Count: number,
  groupAMaxForcedCount: number
): EarlyPost7RecoverySummary {
  return {
    sampleSize: groupAAcc.episodes + groupBAcc.episodes,
    noFirst7Count,
    groupAMaxForcedCount,
    outcomePost7MaxSecondMaxThreshold: EARLY_POST7_RECOVERY_OUTCOME_THRESHOLD,
    groupA: finalizeEarlyPost7RecoveryGroup(groupAAcc),
    groupB: finalizeEarlyPost7RecoveryGroup(groupBAcc),
  };
}

function initialBoard(rng: () => number): Board {
  let board = emptyBoard();
  board = spawnRandom(board, rng);
  return spawnRandom(board, rng);
}

function emptyTerminalReasons(): Record<TerminalReason, number> {
  const out = {} as Record<TerminalReason, number>;
  for (const reason of TERMINAL_REASONS) out[reason] = 0;
  return out;
}

function observeEpisodeBoard(
  board: Board,
  state: {
    maxLevelReached: number;
    everTwo7s: boolean;
    everOne8One7: boolean;
    everTwo8s: boolean;
  }
): void {
  const mx = maxTileLevel(board);
  if (mx > state.maxLevelReached) state.maxLevelReached = mx;
  if (hasTwoOrMoreTilesEqual(board, 7)) state.everTwo7s = true;
  if (hasSimultaneousOne8AndOne7(board)) state.everOne8One7 = true;
  if (hasSimultaneousTwo8s(board)) state.everTwo8s = true;
}

function simulateEpisode(policyFactory: () => Policy, episodeSeed: number): EpisodeMetrics {
  const rng = createRng(episodeSeed);
  const policy = policyFactory();
  let board = initialBoard(rng);
  let steps = 0;
  let hlMergeCount = 0;
  let first7Turn: number | null = null;
  const recentPre7Boards: Board[] = [];
  let pre7Boards: readonly Board[] | null = null;
  const post7Boards: Board[] = [];
  let first7Seen = false;
  const observed = {
    maxLevelReached: 0,
    everTwo7s: false,
    everOne8One7: false,
    everTwo8s: false,
  };

  observeEpisodeBoard(board, observed);

  function recordTurnStartBoard(current: Board): void {
    if (!first7Seen) {
      if (maxTileLevel(current) === 7) {
        first7Seen = true;
        first7Turn = steps;
        pre7Boards = [...recentPre7Boards];
        post7Boards.push(current);
        return;
      }
      recentPre7Boards.push(current);
      if (recentPre7Boards.length > PRE8_WINDOW_TURNS) recentPre7Boards.shift();
      return;
    }
    if (post7Boards.length < POST8_WINDOW_TURNS) post7Boards.push(current);
  }

  function finishEpisode(win: boolean, terminalReason: TerminalReason, terminalBoard: Board): EpisodeMetrics {
    return {
      win,
      steps,
      terminalReason,
      maxLevelReached: observed.maxLevelReached,
      finalMaxLevel: maxTileLevel(terminalBoard),
      finalSecondMaxTile: secondMaxTile(terminalBoard),
      hlMergeCount,
      everTwo7s: observed.everTwo7s,
      everOne8One7: observed.everOne8One7,
      everTwo8s: observed.everTwo8s,
      first7Turn,
      first8Diagnostics: analyzeFirst7Episode(pre7Boards ?? [], post7Boards),
    };
  }

  while (steps < maxSteps) {
    recordTurnStartBoard(board);
    const actions = legalActions(board);
    if (actions.length === 0) {
      return finishEpisode(false, "no_legal_moves", board);
    }

    const dir = policy(board, actions);
    const { next, moved, win } = slide(board, dir);
    if (moved && createsHighLevelMerge(board, next)) hlMergeCount++;
    observeEpisodeBoard(next, observed);
    steps++;

    if (win) {
      return finishEpisode(true, "win", next);
    }

    if (!moved) {
      return finishEpisode(false, "policy_illegal_move", next);
    }

    board = spawnRandom(next, rng);
    observeEpisodeBoard(board, observed);
  }

  return finishEpisode(false, "max_steps", board);
}

function runPolicy(label: string, policyFactory: () => Policy): { label: string; metrics: RunMetrics } {
  let wins = 0;
  let stepsSum = 0;
  let level8Reach = 0;
  let hlConversionEpisodes = 0;
  let hlChainEpisodes = 0;
  let finalMaxSum = 0;
  let finalSecondMaxSum = 0;
  let everTwo7s = 0;
  let everOne8One7 = 0;
  let everTwo8s = 0;
  let first7TurnSum = 0;
  let first7TurnCount = 0;
  const terminalReasons = emptyTerminalReasons();
  const groupAAcc = emptyFirst8ResearchGroupAccumulator();
  const groupBAcc = emptyFirst8ResearchGroupAccumulator();
  const secondaryGroupAAcc = emptyFirst8ResearchGroupAccumulator();
  const secondaryGroupBAcc = emptyFirst8ResearchGroupAccumulator();
  const earlyRecoveryGroupAAcc = emptyEarlyPost7RecoveryGroupAccumulator();
  const earlyRecoveryGroupBAcc = emptyEarlyPost7RecoveryGroupAccumulator();
  const earlyRecoverySecondaryGroupAAcc = emptyEarlyPost7RecoveryGroupAccumulator();
  const earlyRecoverySecondaryGroupBAcc = emptyEarlyPost7RecoveryGroupAccumulator();
  let noFirst7Count = 0;

  for (let i = 0; i < episodes; i++) {
    const episodeSeed = seedBase + i;
    const result = simulateEpisode(policyFactory, episodeSeed);
    if (result.win) wins++;
    stepsSum += result.steps;
    terminalReasons[result.terminalReason]++;
    if (result.maxLevelReached >= 8) level8Reach++;
    if (result.hlMergeCount >= 1) hlConversionEpisodes++;
    if (result.hlMergeCount >= 2) hlChainEpisodes++;
    finalMaxSum += result.finalMaxLevel;
    finalSecondMaxSum += result.finalSecondMaxTile;
    if (result.everTwo7s) everTwo7s++;
    if (result.everOne8One7) everOne8One7++;
    if (result.everTwo8s) everTwo8s++;
    if (result.first7Turn != null) {
      first7TurnSum += result.first7Turn;
      first7TurnCount++;
    }
    if (!result.first8Diagnostics.first8Reached) {
      noFirst7Count++;
    } else {
      const post7MaxSecondMax = result.first8Diagnostics.post8?.post8MaxSecondMax ?? -1;
      const post7EarlyForcedCount = result.first8Diagnostics.earlyPost7?.post7EarlyForcedCount ?? Number.POSITIVE_INFINITY;
      if (post7MaxSecondMax >= PRIMARY_POST7_SECOND_MAX_THRESHOLD) {
        accumulateFirst8Group(groupAAcc, result);
      } else {
        accumulateFirst8Group(groupBAcc, result);
      }
      if (post7MaxSecondMax >= SECONDARY_POST7_SECOND_MAX_THRESHOLD) {
        accumulateFirst8Group(secondaryGroupAAcc, result);
      } else {
        accumulateFirst8Group(secondaryGroupBAcc, result);
      }
      if (post7EarlyForcedCount <= PRIMARY_EARLY_POST7_FORCED_MAX) {
        accumulateEarlyPost7RecoveryGroup(earlyRecoveryGroupAAcc, result);
      } else {
        accumulateEarlyPost7RecoveryGroup(earlyRecoveryGroupBAcc, result);
      }
      if (post7EarlyForcedCount <= SECONDARY_EARLY_POST7_FORCED_MAX) {
        accumulateEarlyPost7RecoveryGroup(earlyRecoverySecondaryGroupAAcc, result);
      } else {
        accumulateEarlyPost7RecoveryGroup(earlyRecoverySecondaryGroupBAcc, result);
      }
    }
  }

  return {
    label,
    metrics: {
      episodes,
      wins,
      avgSteps: avg(stepsSum, episodes),
      level8ReachRate: avg(level8Reach, episodes),
      hlConversionRate: avg(hlConversionEpisodes, episodes),
      hlChainRate: avg(hlChainEpisodes, episodes),
      avgFinalMaxTile: avg(finalMaxSum, episodes),
      avgFinalSecondMaxTile: avg(finalSecondMaxSum, episodes),
      avgFirst7EntryTurn: avgOrNull(first7TurnSum, first7TurnCount),
      everTwo7sRate: avg(everTwo7s, episodes),
      everOne8One7Rate: avg(everOne8One7, episodes),
      everTwo8sRate: avg(everTwo8s, episodes),
      terminalReasons,
      first8Research: summarizeFirst8Research(
        groupAAcc,
        groupBAcc,
        noFirst7Count,
        PRIMARY_POST7_SECOND_MAX_THRESHOLD
      ),
      first8SecondaryResearch:
        groupAAcc.episodes >= 3
          ? null
          : summarizeFirst8Research(
              secondaryGroupAAcc,
              secondaryGroupBAcc,
              noFirst7Count,
              SECONDARY_POST7_SECOND_MAX_THRESHOLD
            ),
      earlyPost7RecoveryResearch: summarizeEarlyPost7Recovery(
        earlyRecoveryGroupAAcc,
        earlyRecoveryGroupBAcc,
        noFirst7Count,
        PRIMARY_EARLY_POST7_FORCED_MAX
      ),
      earlyPost7RecoverySecondaryResearch:
        earlyRecoveryGroupAAcc.episodes >= 3
          ? null
          : summarizeEarlyPost7Recovery(
              earlyRecoverySecondaryGroupAAcc,
              earlyRecoverySecondaryGroupBAcc,
              noFirst7Count,
              SECONDARY_EARLY_POST7_FORCED_MAX
            ),
    },
  };
}

function printMetricRow(metric: string, baseline: string, hybrid: string): void {
  console.log(
    `${metric.padEnd(28)} ${baseline.padStart(12)} ${hybrid.padStart(12)}`
  );
}

function printCoreTable(base: RunMetrics, hybrid: RunMetrics): void {
  console.log("\nCore Metrics");
  console.log(`${"metric".padEnd(28)} ${"baseline".padStart(12)} ${"hybrid".padStart(12)}`);
  printMetricRow("win rate", pct(base.wins / base.episodes), pct(hybrid.wins / hybrid.episodes));
  printMetricRow("level 8 reach", pct(base.level8ReachRate), pct(hybrid.level8ReachRate));
  printMetricRow("HL conversion", pct(base.hlConversionRate), pct(hybrid.hlConversionRate));
  printMetricRow("HL chain", pct(base.hlChainRate), pct(hybrid.hlChainRate));
  printMetricRow("avg final max", base.avgFinalMaxTile.toFixed(3), hybrid.avgFinalMaxTile.toFixed(3));
  printMetricRow(
    "avg final second max",
    base.avgFinalSecondMaxTile.toFixed(3),
    hybrid.avgFinalSecondMaxTile.toFixed(3)
  );
  printMetricRow("ever two 7s", pct(base.everTwo7sRate), pct(hybrid.everTwo7sRate));
  printMetricRow("ever one 8+one 7", pct(base.everOne8One7Rate), pct(hybrid.everOne8One7Rate));
  printMetricRow("ever two 8s", pct(base.everTwo8sRate), pct(hybrid.everTwo8sRate));
}

function printTerminalReasons(label: string, stats: RunMetrics): void {
  const parts = TERMINAL_REASONS.map(
    (reason) => `${reason}=${stats.terminalReasons[reason]}`
  );
  console.log(`${label}: ${parts.join("  ")}`);
}

function fmtMaybe(value: number | null, digits: number = 4): string {
  return value == null ? "n/a" : value.toFixed(digits);
}

function printEarlyLiftOutcomeComparisonRow(
  label: string,
  chosen: number,
  entered: number,
  first7Sample: number,
  post7Ge5: number,
  post7Ge6: number,
  avgFinalSecondMax: number
): void {
  const coverage = entered > 0 ? chosen / entered : 0;
  console.log(
    `${label.padEnd(24)} ${`${chosen}/${entered}`.padStart(12)} ${pct(coverage).padStart(10)} ${`${post7Ge5}/${first7Sample}`.padStart(10)} ${`${post7Ge6}/${first7Sample}`.padStart(10)} ${avgFinalSecondMax.toFixed(3).padStart(12)}`
  );
}

function printFirst8ComparisonRow(metric: string, groupA: number | null, groupB: number | null): void {
  console.log(
    `${metric.padEnd(38)} ${fmtMaybe(groupA).padStart(12)} ${fmtMaybe(groupB).padStart(12)}`
  );
}

function formatTernaryBuckets(buckets: TernaryBucketCounts, total: number): string {
  return `0=${buckets.zero}/${total} (${pctCount(buckets.zero, total)})  1=${buckets.one}/${total} (${pctCount(
    buckets.one,
    total
  )})  2+=${buckets.twoPlus}/${total} (${pctCount(buckets.twoPlus, total)})`;
}

function formatPlateauBuckets(buckets: PlateauBucketCounts, total: number): string {
  return `0-3=${buckets.zeroToThree}/${total} (${pctCount(
    buckets.zeroToThree,
    total
  )})  4-7=${buckets.fourToSeven}/${total} (${pctCount(
    buckets.fourToSeven,
    total
  )})  8+=${buckets.eightPlus}/${total} (${pctCount(buckets.eightPlus, total)})`;
}

function printFirst8ResearchSummary(
  label: string,
  stats: RunMetrics,
  summary: First8ResearchSummary,
  analysisLabel: string
): void {
  console.log(
    `\nFirst-7 Prefix Research (${label}, ${analysisLabel}, pre=${PRE8_WINDOW_TURNS}, post=${POST8_WINDOW_TURNS}, low<=${LOW_TILE_MAX_LEVEL}, mid=${MID_TILE_MIN_LEVEL}..${MID_TILE_MAX_LEVEL})`
  );
  console.log(`first7 sample: ${summary.sampleSize}/${stats.episodes}`);
  console.log(`no first7: ${summary.noFirst8Count}/${stats.episodes}`);
  console.log(
    `groupA post7MaxSecondMax>=${summary.post7MaxSecondMaxThreshold}: ${summary.groupA.episodes}/${summary.sampleSize} (${pctCount(
      summary.groupA.episodes,
      summary.sampleSize
    )})`
  );
  console.log(
    `groupB post7MaxSecondMax<${summary.post7MaxSecondMaxThreshold}: ${summary.groupB.episodes}/${summary.sampleSize} (${pctCount(
      summary.groupB.episodes,
      summary.sampleSize
    )})`
  );
  console.log(
    `groupA everTwo8s: ${summary.groupA.everTwo8s}/${summary.groupA.episodes} (${pctCount(
      summary.groupA.everTwo8s,
      summary.groupA.episodes
    )})`
  );
  console.log(
    `groupB everTwo8s: ${summary.groupB.everTwo8s}/${summary.groupB.episodes} (${pctCount(
      summary.groupB.everTwo8s,
      summary.groupB.episodes
    )})`
  );
  console.log(
    `groupA wins: ${summary.groupA.wins}/${summary.groupA.episodes} (${pctCount(
      summary.groupA.wins,
      summary.groupA.episodes
    )})`
  );
  console.log(
    `groupB wins: ${summary.groupB.wins}/${summary.groupB.episodes} (${pctCount(
      summary.groupB.wins,
      summary.groupB.episodes
    )})`
  );

  console.log(`${"metric".padEnd(38)} ${"groupA".padStart(12)} ${"groupB".padStart(12)}`);
  console.log("Pre-7");
  printFirst8ComparisonRow("mean empty count", summary.groupA.pre8MeanEmptyCount, summary.groupB.pre8MeanEmptyCount);
  printFirst8ComparisonRow("mean min empty count", summary.groupA.pre8MinEmptyCount, summary.groupB.pre8MinEmptyCount);
  printFirst8ComparisonRow("mean zero-empty turns", summary.groupA.pre8ZeroEmptyTurnCount, summary.groupB.pre8ZeroEmptyTurnCount);
  printFirst8ComparisonRow(
    "mean zero-empty legal<=2 turns",
    summary.groupA.pre8ZeroEmptyLegalMovesLe2Count,
    summary.groupB.pre8ZeroEmptyLegalMovesLe2Count
  );
  printFirst8ComparisonRow(
    "mean viable<=1 turns",
    summary.groupA.pre8ViableMovesLe1TurnCount,
    summary.groupB.pre8ViableMovesLe1TurnCount
  );
  printFirst8ComparisonRow("anchor change count", summary.groupA.pre8AnchorChangeCount, summary.groupB.pre8AnchorChangeCount);
  printFirst8ComparisonRow("max-pos change count", summary.groupA.pre8MaxPosChangeCount, summary.groupB.pre8MaxPosChangeCount);
  printFirst8ComparisonRow(
    "second-max-pos change count",
    summary.groupA.pre8SecondMaxPosChangeCount,
    summary.groupB.pre8SecondMaxPosChangeCount
  );
  printFirst8ComparisonRow("occupied count mean", summary.groupA.pre8OccupiedCountMean, summary.groupB.pre8OccupiedCountMean);
  printFirst8ComparisonRow("low tile count mean", summary.groupA.pre8LowTileCountMean, summary.groupB.pre8LowTileCountMean);
  printFirst8ComparisonRow("mid tile count mean", summary.groupA.pre8MidTileCountMean, summary.groupB.pre8MidTileCountMean);

  console.log("Post-7");
  printFirst8ComparisonRow("mean empty count", summary.groupA.post8MeanEmptyCount, summary.groupB.post8MeanEmptyCount);
  printFirst8ComparisonRow("mean min empty count", summary.groupA.post8MinEmptyCount, summary.groupB.post8MinEmptyCount);
  printFirst8ComparisonRow("mean zero-empty turns", summary.groupA.post8ZeroEmptyTurnCount, summary.groupB.post8ZeroEmptyTurnCount);
  printFirst8ComparisonRow(
    "mean zero-empty legal<=2 turns",
    summary.groupA.post8ZeroEmptyLegalMovesLe2Count,
    summary.groupB.post8ZeroEmptyLegalMovesLe2Count
  );
  printFirst8ComparisonRow(
    "mean viable<=1 turns",
    summary.groupA.post8ViableMovesLe1TurnCount,
    summary.groupB.post8ViableMovesLe1TurnCount
  );
  printFirst8ComparisonRow("anchor change count", summary.groupA.post8AnchorChangeCount, summary.groupB.post8AnchorChangeCount);
  printFirst8ComparisonRow("max-pos change count", summary.groupA.post8MaxPosChangeCount, summary.groupB.post8MaxPosChangeCount);
  printFirst8ComparisonRow(
    "second-max-pos change count",
    summary.groupA.post8SecondMaxPosChangeCount,
    summary.groupB.post8SecondMaxPosChangeCount
  );
  printFirst8ComparisonRow("occupied count mean", summary.groupA.post8OccupiedCountMean, summary.groupB.post8OccupiedCountMean);
  printFirst8ComparisonRow("low tile count mean", summary.groupA.post8LowTileCountMean, summary.groupB.post8LowTileCountMean);
  printFirst8ComparisonRow("mid tile count mean", summary.groupA.post8MidTileCountMean, summary.groupB.post8MidTileCountMean);
  printFirst8ComparisonRow("post7 final second max", summary.groupA.post8FinalSecondMax, summary.groupB.post8FinalSecondMax);
  printFirst8ComparisonRow("post7 max second max", summary.groupA.post8MaxSecondMax, summary.groupB.post8MaxSecondMax);
  printFirst8ComparisonRow("second-max plateau len", summary.groupA.secondMaxPlateauLength, summary.groupB.secondMaxPlateauLength);

  console.log("Buckets");
  console.log(
    `pre7 zero-empty legal<=2  groupA ${formatTernaryBuckets(
      summary.groupA.pre8ZeroEmptyLegalMovesLe2Buckets,
      summary.groupA.episodes
    )}`
  );
  console.log(
    `pre7 zero-empty legal<=2  groupB ${formatTernaryBuckets(
      summary.groupB.pre8ZeroEmptyLegalMovesLe2Buckets,
      summary.groupB.episodes
    )}`
  );
  console.log(
    `pre7 viable<=1           groupA ${formatTernaryBuckets(
      summary.groupA.pre8ViableMovesLe1Buckets,
      summary.groupA.episodes
    )}`
  );
  console.log(
    `pre7 viable<=1           groupB ${formatTernaryBuckets(
      summary.groupB.pre8ViableMovesLe1Buckets,
      summary.groupB.episodes
    )}`
  );
  console.log(
    `post7 zero-empty legal<=2 groupA ${formatTernaryBuckets(
      summary.groupA.post8ZeroEmptyLegalMovesLe2Buckets,
      summary.groupA.episodes
    )}`
  );
  console.log(
    `post7 zero-empty legal<=2 groupB ${formatTernaryBuckets(
      summary.groupB.post8ZeroEmptyLegalMovesLe2Buckets,
      summary.groupB.episodes
    )}`
  );
  console.log(
    `post7 viable<=1          groupA ${formatTernaryBuckets(
      summary.groupA.post8ViableMovesLe1Buckets,
      summary.groupA.episodes
    )}`
  );
  console.log(
    `post7 viable<=1          groupB ${formatTernaryBuckets(
      summary.groupB.post8ViableMovesLe1Buckets,
      summary.groupB.episodes
    )}`
  );
  console.log(
    `post7 plateau            groupA ${formatPlateauBuckets(
      summary.groupA.secondMaxPlateauLengthBuckets,
      summary.groupA.episodes
    )}`
  );
  console.log(
    `post7 plateau            groupB ${formatPlateauBuckets(
      summary.groupB.secondMaxPlateauLengthBuckets,
      summary.groupB.episodes
    )}`
  );
}

function printFirst8Research(label: string, stats: RunMetrics): void {
  printFirst8ResearchSummary(label, stats, stats.first8Research, "primary");
  if (stats.first8SecondaryResearch != null) {
    printFirst8ResearchSummary(label, stats, stats.first8SecondaryResearch, "secondary");
  }
}

function printEarlyPost7RecoveryComparisonRow(
  metric: string,
  groupA: number | null,
  groupB: number | null
): void {
  console.log(
    `${metric.padEnd(42)} ${fmtMaybe(groupA).padStart(12)} ${fmtMaybe(groupB).padStart(12)}`
  );
}

function formatForcedCountGroup(maxForcedCount: number): string {
  return maxForcedCount === 0 ? "==0" : `<=${maxForcedCount}`;
}

function formatForcedCountOtherGroup(maxForcedCount: number): string {
  return maxForcedCount === 0 ? ">0" : `>${maxForcedCount}`;
}

function printEarlyPost7RecoveryResearchSummary(
  label: string,
  stats: RunMetrics,
  summary: EarlyPost7RecoverySummary,
  analysisLabel: string
): void {
  console.log(
    `\nEarly Post-7 Recovery Research (${label}, ${analysisLabel}, early=${EARLY_POST7_WINDOW_TURNS}, outcome>=${summary.outcomePost7MaxSecondMaxThreshold})`
  );
  console.log(`first7 sample: ${summary.sampleSize}/${stats.episodes}`);
  console.log(`no first7: ${summary.noFirst7Count}/${stats.episodes}`);
  console.log(
    `groupA post7EarlyForcedCount${formatForcedCountGroup(summary.groupAMaxForcedCount)}: ${summary.groupA.episodes}/${summary.sampleSize} (${pctCount(
      summary.groupA.episodes,
      summary.sampleSize
    )})`
  );
  console.log(
    `groupB post7EarlyForcedCount${formatForcedCountOtherGroup(summary.groupAMaxForcedCount)}: ${summary.groupB.episodes}/${summary.sampleSize} (${pctCount(
      summary.groupB.episodes,
      summary.sampleSize
    )})`
  );
  console.log(
    `groupA outcome post7MaxSecondMax>=${summary.outcomePost7MaxSecondMaxThreshold}: ${summary.groupA.outcomePost7MaxSecondMaxGeThresholdCount}/${summary.groupA.episodes} (${pctCount(
      summary.groupA.outcomePost7MaxSecondMaxGeThresholdCount,
      summary.groupA.episodes
    )})`
  );
  console.log(
    `groupB outcome post7MaxSecondMax>=${summary.outcomePost7MaxSecondMaxThreshold}: ${summary.groupB.outcomePost7MaxSecondMaxGeThresholdCount}/${summary.groupB.episodes} (${pctCount(
      summary.groupB.outcomePost7MaxSecondMaxGeThresholdCount,
      summary.groupB.episodes
    )})`
  );

  console.log(`${"metric".padEnd(42)} ${"groupA".padStart(12)} ${"groupB".padStart(12)}`);
  console.log("Early Post-7");
  printEarlyPost7RecoveryComparisonRow(
    "post7EarlyForcedCount",
    summary.groupA.post7EarlyForcedCount,
    summary.groupB.post7EarlyForcedCount
  );
  printEarlyPost7RecoveryComparisonRow(
    "post7EarlyZeroEmptyLegalLe2Count",
    summary.groupA.post7EarlyZeroEmptyLegalLe2Count,
    summary.groupB.post7EarlyZeroEmptyLegalLe2Count
  );
  printEarlyPost7RecoveryComparisonRow(
    "post7EarlyMeanEmptyCount",
    summary.groupA.post7EarlyMeanEmptyCount,
    summary.groupB.post7EarlyMeanEmptyCount
  );
  printEarlyPost7RecoveryComparisonRow(
    "post7EarlySecondMaxGain",
    summary.groupA.post7EarlySecondMaxGain,
    summary.groupB.post7EarlySecondMaxGain
  );
  printEarlyPost7RecoveryComparisonRow(
    "post7EarlyAnchorChangeCount",
    summary.groupA.post7EarlyAnchorChangeCount,
    summary.groupB.post7EarlyAnchorChangeCount
  );
  printEarlyPost7RecoveryComparisonRow(
    "post7EarlySecondMaxPosChangeCount",
    summary.groupA.post7EarlySecondMaxPosChangeCount,
    summary.groupB.post7EarlySecondMaxPosChangeCount
  );

  console.log("Post-7");
  printEarlyPost7RecoveryComparisonRow(
    "post7MaxSecondMax",
    summary.groupA.post7MaxSecondMax,
    summary.groupB.post7MaxSecondMax
  );
  printEarlyPost7RecoveryComparisonRow(
    "post7FinalSecondMax",
    summary.groupA.post7FinalSecondMax,
    summary.groupB.post7FinalSecondMax
  );
  printEarlyPost7RecoveryComparisonRow(
    "secondMaxPlateauLength",
    summary.groupA.secondMaxPlateauLength,
    summary.groupB.secondMaxPlateauLength
  );
}

function printEarlyPost7RecoveryResearch(label: string, stats: RunMetrics): void {
  printEarlyPost7RecoveryResearchSummary(label, stats, stats.earlyPost7RecoveryResearch, "primary");
  if (stats.earlyPost7RecoverySecondaryResearch != null) {
    printEarlyPost7RecoveryResearchSummary(
      label,
      stats,
      stats.earlyPost7RecoverySecondaryResearch,
      "secondary"
    );
  }
}

function printEarlyLiftExperimentSummary(
  stats: RunMetrics,
  counters: MinimalPolicyExperimentDebugCounters
): void {
  const oracleSearchEnabled = process.env.CLOSURE_AB_ORACLE_SEARCH === "1";
  const first7Sample = stats.first8Research.sampleSize;
  const post7Ge5 = stats.first8SecondaryResearch?.groupA.episodes ?? 0;
  const post7Ge6 = stats.first8Research.groupA.episodes;
  const coverage =
    counters.mergeWindowEntryCount > 0
      ? counters.mergeChosenMoveCount / counters.mergeWindowEntryCount
      : 0;

  console.log("\nAlways-On Staged Merge Search");
  console.log(`selector rule: ${EARLY_LIFT_SELECTOR_RULE}`);
  console.log(
    `oracle search: ${oracleSearchEnabled ? "enabled for critical/post7 node-cap diagnostics" : "disabled"}`
  );
  console.log(
    oracleSearchEnabled
      ? "early: timed horizon 6 ~60ms sampled spawns; critical: oracle horizon 18 node cap 200000 all spawns; post-7: oracle horizon 24 node cap 400000 all spawns"
      : "early: best-first horizon 6 ~60ms with sampled spawns; critical: best-first horizon 12 ~200ms with wider spawn-aware search; post-7: best-first horizon 20 ~1s with all-spawn expansion"
  );
  console.log(`first7 sample: ${first7Sample}/${stats.episodes}`);
  console.log(`avg first7 entry turn: ${fmtMaybe(stats.avgFirst7EntryTurn, 2)}`);
  console.log(`earlySearchDecisionCount: ${counters.earlySearchDecisionCount}`);
  console.log(`earlySearchMeanMoveTimeMs: ${counters.earlySearchMeanMoveTimeMs.toFixed(2)}`);
  console.log(`earlySearchMeanSearchTimeMs: ${counters.earlySearchMeanSearchTimeMs.toFixed(2)}`);
  console.log(
    `earlySearchMeanReachabilityTimeMs: ${counters.earlySearchMeanReachabilityTimeMs.toFixed(2)}`
  );
  console.log(
    `earlySearchMeanBestDepthReached: ${counters.earlySearchMeanBestDepthReached.toFixed(2)}`
  );
  console.log(`earlySearchExpandedNodeCount: ${counters.earlySearchExpandedNodeCount}`);
  console.log(
    `earlySearchCacheHitRate: ${pctCount(
      counters.earlySearchCacheHitCount,
      counters.earlySearchCacheHitCount + counters.earlySearchCacheMissCount
    )}`
  );
  console.log(`criticalSearchDecisionCount: ${counters.criticalSearchDecisionCount}`);
  console.log(`criticalSearchMeanMoveTimeMs: ${counters.criticalSearchMeanMoveTimeMs.toFixed(2)}`);
  console.log(
    `criticalSearchMeanSearchTimeMs: ${counters.criticalSearchMeanSearchTimeMs.toFixed(2)}`
  );
  console.log(
    `criticalSearchMeanReachabilityTimeMs: ${counters.criticalSearchMeanReachabilityTimeMs.toFixed(2)}`
  );
  console.log(
    `criticalSearchMeanBestDepthReached: ${counters.criticalSearchMeanBestDepthReached.toFixed(2)}`
  );
  console.log(`criticalSearchExpandedNodeCount: ${counters.criticalSearchExpandedNodeCount}`);
  console.log(
    `criticalSearchCacheHitRate: ${pctCount(
      counters.criticalSearchCacheHitCount,
      counters.criticalSearchCacheHitCount + counters.criticalSearchCacheMissCount
    )}`
  );
  console.log(`post7SearchDecisionCount: ${counters.post7SearchDecisionCount}`);
  console.log(`post7SearchMeanMoveTimeMs: ${counters.post7SearchMeanMoveTimeMs.toFixed(2)}`);
  console.log(`post7SearchMeanSearchTimeMs: ${counters.post7SearchMeanSearchTimeMs.toFixed(2)}`);
  console.log(
    `post7SearchMeanReachabilityTimeMs: ${counters.post7SearchMeanReachabilityTimeMs.toFixed(2)}`
  );
  console.log(`post7SearchEntryCount: ${counters.mergeWindowEntryCount}`);
  console.log(
    `post7SearchMeanBestDepthReached: ${counters.post7SearchMeanBestDepthReached.toFixed(2)}`
  );
  console.log(
    `post7SearchExpandedNodeCount: ${counters.post7SearchExpandedNodeCount}`
  );
  console.log(`mergeMoveEvaluatedCount: ${counters.mergeMoveEvaluatedCount}`);
  console.log(`mergeChosenMoveCount: ${counters.mergeChosenMoveCount}`);
  console.log(
    `post7SearchCoverage: ${counters.mergeChosenMoveCount}/${counters.mergeWindowEntryCount} (${pct(coverage)})`
  );
  console.log(
    `mergeChosenCapturedImmediate77Count: ${counters.mergeChosenCapturedImmediate77Count}`
  );
  console.log(
    `mergeChosenCapturedImmediate66Count: ${counters.mergeChosenCapturedImmediate66Count}`
  );
  console.log(
    `mergeChosenCapturedOnlyChainSustainCount: ${counters.mergeChosenCapturedOnlyChainSustainCount}`
  );
  console.log(
    `mergeChosenMissedImmediateHighMergeCount: ${counters.mergeChosenMissedImmediateHighMergeCount}`
  );
  console.log(
    `mergeChosenAllSpawnsNoMergeCount: ${counters.mergeChosenAllSpawnsNoMergeCount}`
  );
  console.log(
    `mergeChosenMeanNoMergeShare: ${counters.mergeChosenMeanNoMergeShare.toFixed(4)}`
  );
  console.log(
    `mergeChosenMeanWorstImmediateMergeLevel: ${counters.mergeChosenMeanWorstImmediateMergeLevel.toFixed(4)}`
  );
  console.log(
    `mergeChosenMeanWorstNearTermMergeLevel: ${counters.mergeChosenMeanWorstNearTermMergeLevel.toFixed(4)}`
  );
  console.log(
    `mergeChosenMeanChainSustainMergeCount: ${counters.mergeChosenMeanChainSustainMergeCount.toFixed(4)}`
  );
  console.log(
    `mergeChosenMeanViableMoveCount: ${counters.mergeChosenMeanViableMoveCount.toFixed(4)}`
  );
  console.log(
    `post7SearchChosenMeanSearchScore: ${counters.post7SearchChosenMeanSearchScore.toFixed(2)}`
  );
  console.log(
    `post7SearchChosenMeanReachableRatio: ${counters.post7SearchChosenMeanReachableRatio.toFixed(4)}`
  );
  console.log(
    `post7SearchChosenMeanWorstReachableImmediateMergeLevel: ${counters.post7SearchChosenMeanWorstReachableImmediateMergeLevel.toFixed(4)}`
  );
  console.log(
    `post7SearchChosenMeanWorstReachableNearTermMergeLevel: ${counters.post7SearchChosenMeanWorstReachableNearTermMergeLevel.toFixed(4)}`
  );
  console.log(
    `post7SearchChosenMeanFinalNoMergeShare: ${counters.post7SearchChosenMeanFinalNoMergeShare.toFixed(4)}`
  );
  console.log(
    `mergeTotalSpawnChildrenEvaluated: ${counters.mergeTotalSpawnChildrenEvaluated}`
  );
  console.log(
    `moveCache: ${counters.moveCacheHitCount} hit / ${counters.moveCacheMissCount} miss`
  );
  console.log(
    `spawnCache: ${counters.spawnCacheHitCount} hit / ${counters.spawnCacheMissCount} miss`
  );
  console.log(
    `stateSignalCache: ${counters.stateSignalCacheHitCount} hit / ${counters.stateSignalCacheMissCount} miss`
  );
  console.log(
    `earlySearchTranspositionCache: ${counters.earlySearchCacheHitCount} hit / ${counters.earlySearchCacheMissCount} miss`
  );
  console.log(
    `criticalSearchTranspositionCache: ${counters.criticalSearchCacheHitCount} hit / ${counters.criticalSearchCacheMissCount} miss`
  );
  console.log(
    `post7SearchTranspositionCache: ${counters.post7SearchCacheHitCount} hit / ${counters.post7SearchCacheMissCount} miss`
  );
  console.log(
    `post7SearchCacheHitRate: ${pctCount(
      counters.post7SearchCacheHitCount,
      counters.post7SearchCacheHitCount + counters.post7SearchCacheMissCount
    )}`
  );
  console.log(
    `post7MaxSecondMax>=5: ${post7Ge5}/${first7Sample} (${pctCount(post7Ge5, first7Sample)})`
  );
  console.log(
    `post7MaxSecondMax>=6: ${post7Ge6}/${first7Sample} (${pctCount(post7Ge6, first7Sample)})`
  );
  console.log(`avg final second max: ${stats.avgFinalSecondMaxTile.toFixed(3)}`);
  console.log(`\n${"run".padEnd(24)} ${"chosen/entry".padStart(12)} ${"coverage".padStart(10)} ${">=5".padStart(10)} ${">=6".padStart(10)} ${"avg2nd".padStart(12)}`);
  printEarlyLiftOutcomeComparisonRow(
    "raw early-lift",
    PRIOR_RAW_EARLY_LIFT_REFERENCE.earlyLiftPreferredMoveChosenCount,
    PRIOR_RAW_EARLY_LIFT_REFERENCE.earlyLiftWindowEntryCount,
    PRIOR_RAW_EARLY_LIFT_REFERENCE.first7Sample,
    PRIOR_RAW_EARLY_LIFT_REFERENCE.post7MaxSecondMaxGe5Count,
    PRIOR_RAW_EARLY_LIFT_REFERENCE.post7MaxSecondMaxGe6Count,
    PRIOR_RAW_EARLY_LIFT_REFERENCE.avgFinalSecondMaxTile
  );
  printEarlyLiftOutcomeComparisonRow(
    "capacity-burn",
    PRIOR_CAPACITY_BURN_REFERENCE.earlyLiftPreferredMoveChosenCount,
    PRIOR_CAPACITY_BURN_REFERENCE.earlyLiftWindowEntryCount,
    PRIOR_CAPACITY_BURN_REFERENCE.first7Sample,
    PRIOR_CAPACITY_BURN_REFERENCE.post7MaxSecondMaxGe5Count,
    PRIOR_CAPACITY_BURN_REFERENCE.post7MaxSecondMaxGe6Count,
    PRIOR_CAPACITY_BURN_REFERENCE.avgFinalSecondMaxTile
  );
  printEarlyLiftOutcomeComparisonRow(
    "strict viability",
    PRIOR_STRICT_VIABILITY_REFERENCE.earlyLiftPreferredMoveChosenCount,
    PRIOR_STRICT_VIABILITY_REFERENCE.earlyLiftWindowEntryCount,
    PRIOR_STRICT_VIABILITY_REFERENCE.first7Sample,
    PRIOR_STRICT_VIABILITY_REFERENCE.post7MaxSecondMaxGe5Count,
    PRIOR_STRICT_VIABILITY_REFERENCE.post7MaxSecondMaxGe6Count,
    PRIOR_STRICT_VIABILITY_REFERENCE.avgFinalSecondMaxTile
  );
  printEarlyLiftOutcomeComparisonRow(
    "local down-proxy",
    PRIOR_LOCAL_DOWNSTREAM_PROXY_REFERENCE.earlyLiftPreferredMoveChosenCount,
    PRIOR_LOCAL_DOWNSTREAM_PROXY_REFERENCE.earlyLiftWindowEntryCount,
    PRIOR_LOCAL_DOWNSTREAM_PROXY_REFERENCE.first7Sample,
    PRIOR_LOCAL_DOWNSTREAM_PROXY_REFERENCE.post7MaxSecondMaxGe5Count,
    PRIOR_LOCAL_DOWNSTREAM_PROXY_REFERENCE.post7MaxSecondMaxGe6Count,
    PRIOR_LOCAL_DOWNSTREAM_PROXY_REFERENCE.avgFinalSecondMaxTile
  );
  printEarlyLiftOutcomeComparisonRow(
    "future peak",
    PRIOR_SHALLOW_FUTURE_PEAK_REFERENCE.earlyLiftPreferredMoveChosenCount,
    PRIOR_SHALLOW_FUTURE_PEAK_REFERENCE.earlyLiftWindowEntryCount,
    PRIOR_SHALLOW_FUTURE_PEAK_REFERENCE.first7Sample,
    PRIOR_SHALLOW_FUTURE_PEAK_REFERENCE.post7MaxSecondMaxGe5Count,
    PRIOR_SHALLOW_FUTURE_PEAK_REFERENCE.post7MaxSecondMaxGe6Count,
    PRIOR_SHALLOW_FUTURE_PEAK_REFERENCE.avgFinalSecondMaxTile
  );
  printEarlyLiftOutcomeComparisonRow(
    "anchor+rollout",
    PRIOR_ANCHOR_ROLLOUT_REFERENCE.earlyLiftPreferredMoveChosenCount,
    PRIOR_ANCHOR_ROLLOUT_REFERENCE.earlyLiftWindowEntryCount,
    PRIOR_ANCHOR_ROLLOUT_REFERENCE.first7Sample,
    PRIOR_ANCHOR_ROLLOUT_REFERENCE.post7MaxSecondMaxGe5Count,
    PRIOR_ANCHOR_ROLLOUT_REFERENCE.post7MaxSecondMaxGe6Count,
    PRIOR_ANCHOR_ROLLOUT_REFERENCE.avgFinalSecondMaxTile
  );
  printEarlyLiftOutcomeComparisonRow(
    "branch+prune",
    PRIOR_BRANCH_PRUNE_REFERENCE.earlyLiftPreferredMoveChosenCount,
    PRIOR_BRANCH_PRUNE_REFERENCE.earlyLiftWindowEntryCount,
    PRIOR_BRANCH_PRUNE_REFERENCE.first7Sample,
    PRIOR_BRANCH_PRUNE_REFERENCE.post7MaxSecondMaxGe5Count,
    PRIOR_BRANCH_PRUNE_REFERENCE.post7MaxSecondMaxGe6Count,
    PRIOR_BRANCH_PRUNE_REFERENCE.avgFinalSecondMaxTile
  );
  printEarlyLiftOutcomeComparisonRow(
    "spawn-robust",
    PRIOR_SPAWN_ROBUST_IMMEDIATE_DEAD_REFERENCE.earlyLiftPreferredMoveChosenCount,
    PRIOR_SPAWN_ROBUST_IMMEDIATE_DEAD_REFERENCE.earlyLiftWindowEntryCount,
    PRIOR_SPAWN_ROBUST_IMMEDIATE_DEAD_REFERENCE.first7Sample,
    PRIOR_SPAWN_ROBUST_IMMEDIATE_DEAD_REFERENCE.post7MaxSecondMaxGe5Count,
    PRIOR_SPAWN_ROBUST_IMMEDIATE_DEAD_REFERENCE.post7MaxSecondMaxGe6Count,
    PRIOR_SPAWN_ROBUST_IMMEDIATE_DEAD_REFERENCE.avgFinalSecondMaxTile
  );
  printEarlyLiftOutcomeComparisonRow(
    "staged-search",
    counters.mergeChosenMoveCount,
    counters.mergeWindowEntryCount,
    first7Sample,
    post7Ge5,
    post7Ge6,
    stats.avgFinalSecondMaxTile
  );
}

function printClosureSummary(counters: ClosureDebugCounters): void {
  const stableViabilityDenom =
    counters.rebuildAcceptedByStableViabilityCount + counters.rebuildRejectedByStableViabilityCount;
  const dominantLeavesWithOffFamilyDenom = Math.max(1, counters.rebuildLeavesWithOffFamilyChildrenCount);
  const dominantFamilySizeGe2Denom = Math.max(1, counters.rebuildLeavesWithDominantFamilySizeGe2Count);
  const subsetLeavesWithOffFamilyDenom = Math.max(1, counters.subsetLeavesWithOffFamilyChildrenCount);
  const groupADenom = Math.max(1, counters.rebuildLeafDominantFamilySizeGe2Count);
  const groupBDenom = Math.max(1, counters.rebuildLeafDominantFamilySizeEq1Count);
  const closureReadyGroupADenom = Math.max(1, counters.rebuildLeafEventualClosureReadyHitsGe2Count);
  const closureReadyGroupBDenom = Math.max(1, counters.rebuildLeafEventualClosureReadyHitsLt2Count);
  const orthAdjGroupADenom = Math.max(1, counters.rebuildLeafEventualOrthAdjHitsGe2Count);
  const orthAdjGroupBDenom = Math.max(1, counters.rebuildLeafEventualOrthAdjHitsLt2Count);

  console.log("\nClosure Debug");
  console.log(`entry: ${counters.entry}`);
  console.log(`searchInvoked: ${counters.searchInvoked}`);
  console.log(`accepted: ${counters.accepted}`);
  console.log(`fallback: ${counters.fallback}`);
  console.log(`viable: ${counters.viable}`);
  console.log(`rebuildCandidateDeadPositionCount: ${counters.rebuildCandidateDeadPositionCount}`);
  console.log(`rebuildCandidateDoomedPositionCount: ${counters.rebuildCandidateDoomedPositionCount}`);
  console.log(
    `rebuildAcceptedByStableViabilityCount: ${counters.rebuildAcceptedByStableViabilityCount}`
  );
  console.log(
    `rebuildRejectedByStableViabilityCount: ${counters.rebuildRejectedByStableViabilityCount}`
  );
  console.log(`rebuildCandidateValidatedCount: ${counters.rebuildCandidateValidatedCount}`);
  console.log(`rebuildAcceptedByMicroRolloutCount: ${counters.rebuildAcceptedByMicroRolloutCount}`);
  console.log(`rebuildRejectedByMicroRolloutCount: ${counters.rebuildRejectedByMicroRolloutCount}`);
  console.log(`microRolloutBetterHlCount: ${counters.microRolloutBetterHlCount}`);
  console.log(`microRolloutBetterSecondMaxCount: ${counters.microRolloutBetterSecondMaxCount}`);
  console.log(`microRolloutBetterDistanceCount: ${counters.microRolloutBetterDistanceCount}`);
  console.log(
    `microRolloutBetterTopTwoInsideCount: ${counters.microRolloutBetterTopTwoInsideCount}`
  );
  console.log(`rebuildAcceptedCount: ${counters.rebuildAcceptedCount}`);
  console.log(`bestPathFollowThroughCount: ${counters.bestPathFollowThroughCount}`);
  console.log(`rebuildEverTopTwoInsideBlockCount: ${counters.rebuildEverTopTwoInsideBlockCount}`);
  console.log(`rebuildCandidateEverTopTwoCount: ${counters.rebuildCandidateEverTopTwoCount}`);
  console.log(`rebuildCandidateAcceptedCount: ${counters.rebuildCandidateAcceptedCount}`);
  console.log(`rebuildCandidateFollowThroughCount: ${counters.rebuildCandidateFollowThroughCount}`);
  console.log(
    `rebuildRejectedByNoFollowThroughCount: ${counters.rebuildRejectedByNoFollowThroughCount}`
  );
  console.log(
    `rebuildCandidateDistanceImprovedCount: ${counters.rebuildCandidateDistanceImprovedCount}`
  );
  console.log(
    `rebuildRejectedByNoDistanceImprovementCount: ${counters.rebuildRejectedByNoDistanceImprovementCount}`
  );
  console.log(`rebuildRejectedByWeakSurvivalCount: ${counters.rebuildRejectedByWeakSurvivalCount}`);
  console.log(`rebuildFallbackCount: ${counters.rebuildFallbackCount}`);
  console.log(`hlWithin4AfterRebuildAcceptedCount: ${counters.hlWithin4AfterRebuildAcceptedCount}`);
  console.log(`hlWithin8AfterRebuildAcceptedCount: ${counters.hlWithin8AfterRebuildAcceptedCount}`);
  console.log(`hlWithin12AfterRebuildAcceptedCount: ${counters.hlWithin12AfterRebuildAcceptedCount}`);
  console.log(`promotedToClosureCount: ${counters.promotedToClosureCount}`);
  console.log(`closureAcceptedCount: ${counters.closureAcceptedCount}`);
  console.log(`closureFallbackCount: ${counters.closureFallbackCount}`);
  console.log(`didHlMergePath: ${counters.didHlMergePath}`);
  console.log(`repeatedBoardHits: ${counters.repeatedBoardHits}`);
  console.log(`entry/episode: ${(counters.entry / episodes).toFixed(4)}`);
  console.log(`accepted/episode: ${(counters.accepted / episodes).toFixed(4)}`);
  console.log(`fallback rate: ${pct(fracClosureFallback(counters))}`);
  console.log(`accepted rate: ${pct(fracClosureAccepted(counters))}`);
  console.log(`viable rate: ${pct(fracClosureViable(counters))}`);
  console.log(`mean windowRunLen: ${meanClosureWindowRunLen(counters).toFixed(4)}`);
  console.log(`windowRunLen>=3 ratio: ${pct(fracClosureWindowRunLenGte3(counters))}`);
  console.log(
    `meanLeafViableMoveCount: ${meanLeafViableMoveCount(counters).toFixed(4)}`
  );
  console.log(
    `meanLeafChildViableCount: ${meanLeafChildViableCount(counters).toFixed(4)}`
  );
  console.log(
    `meanAcceptedLeafViableMoveCount: ${meanAcceptedLeafViableMoveCount(counters).toFixed(4)}`
  );
  console.log(
    `meanAcceptedLeafChildViableCount: ${meanAcceptedLeafChildViableCount(counters).toFixed(4)}`
  );
  console.log(
    `meanRejectedLeafViableMoveCount: ${meanRejectedLeafViableMoveCount(counters).toFixed(4)}`
  );
  console.log(
    `meanRejectedLeafChildViableCount: ${meanRejectedLeafChildViableCount(counters).toFixed(4)}`
  );
  console.log(
    `meanDistinctExactCommitmentSignatureCount: ${avg(
      counters.leafDistinctViableChildCommitmentSignatureCountSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanDominantExactCommitmentSignatureShare: ${avg(
      counters.leafDominantViableChildCommitmentSignatureShareSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanDistinctFamilyCommitmentSignatureCount: ${avg(
      counters.leafDistinctViableChildCommitmentFamilyCountSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanDominantFamilyCommitmentSignatureShare: ${avg(
      counters.leafDominantViableChildCommitmentFamilyShareSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanDistinctEventual2StepTopEndClassCount: ${avg(
      counters.leafDistinctViableChildEventualTopEndClassCountSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanDominantEventual2StepTopEndClassShare: ${avg(
      counters.leafDominantViableChildEventualTopEndClassShareSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanEventualOrthAdjHitCount: ${avg(
      counters.leafEventualOrthAdjHitCountSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanEventualOrthAdjHitShare: ${avg(
      counters.leafEventualOrthAdjHitShareSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanEventualOneSlideHitCount: ${avg(
      counters.leafEventualOneSlideHitCountSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanEventualOneSlideHitShare: ${avg(
      counters.leafEventualOneSlideHitShareSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanEventualClosureReadyHitCount: ${avg(
      counters.leafEventualClosureReadyHitCountSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanEventualClosureReadyHitShare: ${avg(
      counters.leafEventualClosureReadyHitShareSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `allClosureReadyEventualHitsOrthAdj: ${counters.leavesAllClosureReadyEventualHitsOrthAdjCount}/${stableViabilityDenom} (${pct(
      avg(counters.leavesAllClosureReadyEventualHitsOrthAdjCount, stableViabilityDenom)
    )})`
  );
  console.log(
    `mixedClosureReadyEventualHits: ${counters.leavesMixedClosureReadyEventualHitsCount}/${stableViabilityDenom} (${pct(
      avg(counters.leavesMixedClosureReadyEventualHitsCount, stableViabilityDenom)
    )})`
  );
  console.log(
    `meanDominantFamilySize: ${avg(
      counters.leafDominantFamilySizeSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanDominantFamilyShare: ${avg(
      counters.leafDominantFamilyShareSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanDistinctSecondWithinDominantFamilyCount: ${avg(
      counters.leafDistinctSecondWithinDominantFamilyCountSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanDominantSecondWithinDominantFamilyShare: ${avg(
      counters.leafDominantSecondWithinDominantFamilyShareSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanDistinctPairabilityModesWithinDominantFamilyCount: ${avg(
      counters.leafDistinctPairabilityModesWithinDominantFamilyCountSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanDominantFamilyChildViableCount: ${avg(
      counters.dominantFamilyChildViableCountSum,
      counters.dominantFamilyChildCountSum
    ).toFixed(4)}`
  );
  console.log(
    `meanDominantFamilyChildMinViableCount: ${avg(
      counters.leafDominantFamilyChildMinViableCountSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `dominantFamilyChildViableCount>=2: ${counters.dominantFamilyChildViableCountGe2CountSum}/${counters.dominantFamilyChildCountSum} (${pct(
      avg(
        counters.dominantFamilyChildViableCountGe2CountSum,
        counters.dominantFamilyChildCountSum
      )
    )})`
  );
  console.log(
    `meanBestDominantFamilyChildViableCount: ${avg(
      counters.leafDominantFamilyChildBestViableCountSum,
      stableViabilityDenom
    ).toFixed(4)}`
  );
  console.log(
    `meanOffFamilyChildViableCount: ${avg(
      counters.offFamilyChildViableCountSum,
      counters.offFamilyChildCountSum
    ).toFixed(4)}`
  );
  console.log(
    `meanOffFamilyChildMinViableCount: ${avg(
      counters.leafOffFamilyChildMinViableCountSum,
      dominantLeavesWithOffFamilyDenom
    ).toFixed(4)}`
  );
  console.log(
    `offFamilyChildViableCount>=2: ${counters.offFamilyChildViableCountGe2CountSum}/${counters.offFamilyChildCountSum} (${pct(
      avg(counters.offFamilyChildViableCountGe2CountSum, counters.offFamilyChildCountSum)
    )})`
  );
  console.log(
    `meanBestOffFamilyChildViableCount: ${avg(
      counters.leafOffFamilyChildBestViableCountSum,
      dominantLeavesWithOffFamilyDenom
    ).toFixed(4)}`
  );
  console.log(
    `shareLeavesDominantFamilySize>=2: ${counters.rebuildLeavesWithDominantFamilySizeGe2Count}/${stableViabilityDenom} (${pct(
      avg(counters.rebuildLeavesWithDominantFamilySizeGe2Count, stableViabilityDenom)
    )})`
  );
  console.log(
    `subsetMeanDominantFamilyChildViableCount: ${avg(
      counters.subsetDominantFamilyChildViableCountSum,
      counters.subsetDominantFamilyChildCountSum
    ).toFixed(4)}`
  );
  console.log(
    `subsetMeanDominantFamilyChildMinViableCount: ${avg(
      counters.subsetLeafDominantFamilyChildMinViableCountSum,
      dominantFamilySizeGe2Denom
    ).toFixed(4)}`
  );
  console.log(
    `subsetDominantFamilyChildViableCount>=2: ${counters.subsetDominantFamilyChildViableCountGe2CountSum}/${counters.subsetDominantFamilyChildCountSum} (${pct(
      avg(
        counters.subsetDominantFamilyChildViableCountGe2CountSum,
        counters.subsetDominantFamilyChildCountSum
      )
    )})`
  );
  console.log(
    `subsetMeanBestDominantFamilyChildViableCount: ${avg(
      counters.subsetLeafDominantFamilyChildBestViableCountSum,
      dominantFamilySizeGe2Denom
    ).toFixed(4)}`
  );
  console.log(
    `subsetMeanOffFamilyChildViableCount: ${avg(
      counters.subsetOffFamilyChildViableCountSum,
      counters.subsetOffFamilyChildCountSum
    ).toFixed(4)}`
  );
  console.log(
    `subsetMeanOffFamilyChildMinViableCount: ${avg(
      counters.subsetLeafOffFamilyChildMinViableCountSum,
      subsetLeavesWithOffFamilyDenom
    ).toFixed(4)}`
  );
  console.log(
    `subsetOffFamilyChildViableCount>=2: ${counters.subsetOffFamilyChildViableCountGe2CountSum}/${counters.subsetOffFamilyChildCountSum} (${pct(
      avg(
        counters.subsetOffFamilyChildViableCountGe2CountSum,
        counters.subsetOffFamilyChildCountSum
      )
    )})`
  );
  console.log(
    `subsetMeanBestOffFamilyChildViableCount: ${avg(
      counters.subsetLeafOffFamilyChildBestViableCountSum,
      subsetLeavesWithOffFamilyDenom
    ).toFixed(4)}`
  );
  console.log(
    `groupA dominantFamilySize>=2: ${counters.rebuildLeafDominantFamilySizeGe2Count}/${stableViabilityDenom} (${pct(
      avg(counters.rebuildLeafDominantFamilySizeGe2Count, stableViabilityDenom)
    )})`
  );
  console.log(
    `groupA hlWithin8AfterRebuildAcceptedCount: ${counters.hlWithin8AfterRebuildAcceptedDominantFamilySizeGe2Count}`
  );
  console.log(
    `groupA meanViableMoveCount: ${avg(
      counters.rebuildLeafDominantFamilySizeGe2ViableMoveCountSum,
      groupADenom
    ).toFixed(4)}`
  );
  console.log(
    `groupA meanDistinctEventual2StepTopEndClassCount: ${avg(
      counters.rebuildLeafDominantFamilySizeGe2DistinctEventualTopEndClassCountSum,
      groupADenom
    ).toFixed(4)}`
  );
  console.log(
    `groupA meanDominantEventual2StepTopEndClassShare: ${avg(
      counters.rebuildLeafDominantFamilySizeGe2DominantEventualTopEndClassShareSum,
      groupADenom
    ).toFixed(4)}`
  );
  console.log(
    `groupA meanChildViableCount: ${avg(
      counters.rebuildLeafDominantFamilySizeGe2ChildViableCountSum,
      counters.rebuildLeafDominantFamilySizeGe2ChildCountSum
    ).toFixed(4)}`
  );
  console.log(
    `groupA meanLeafMeanChildViableCount: ${avg(
      counters.rebuildLeafDominantFamilySizeGe2MeanChildViableCountSum,
      groupADenom
    ).toFixed(4)}`
  );
  console.log(
    `groupA meanLeafMinChildViableCount: ${avg(
      counters.rebuildLeafDominantFamilySizeGe2MinChildViableCountSum,
      groupADenom
    ).toFixed(4)}`
  );
  console.log(
    `groupA childViableCount>=2: ${counters.rebuildLeafDominantFamilySizeGe2ChildViableCountGe2CountSum}/${counters.rebuildLeafDominantFamilySizeGe2ChildCountSum} (${pct(
      avg(
        counters.rebuildLeafDominantFamilySizeGe2ChildViableCountGe2CountSum,
        counters.rebuildLeafDominantFamilySizeGe2ChildCountSum
      )
    )})`
  );
  console.log(
    `groupB dominantFamilySize=1: ${counters.rebuildLeafDominantFamilySizeEq1Count}/${stableViabilityDenom} (${pct(
      avg(counters.rebuildLeafDominantFamilySizeEq1Count, stableViabilityDenom)
    )})`
  );
  console.log(
    `groupB hlWithin8AfterRebuildAcceptedCount: ${counters.hlWithin8AfterRebuildAcceptedDominantFamilySizeEq1Count}`
  );
  console.log(
    `groupB meanViableMoveCount: ${avg(
      counters.rebuildLeafDominantFamilySizeEq1ViableMoveCountSum,
      groupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `groupB meanDistinctEventual2StepTopEndClassCount: ${avg(
      counters.rebuildLeafDominantFamilySizeEq1DistinctEventualTopEndClassCountSum,
      groupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `groupB meanDominantEventual2StepTopEndClassShare: ${avg(
      counters.rebuildLeafDominantFamilySizeEq1DominantEventualTopEndClassShareSum,
      groupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `groupB meanChildViableCount: ${avg(
      counters.rebuildLeafDominantFamilySizeEq1ChildViableCountSum,
      counters.rebuildLeafDominantFamilySizeEq1ChildCountSum
    ).toFixed(4)}`
  );
  console.log(
    `groupB meanLeafMeanChildViableCount: ${avg(
      counters.rebuildLeafDominantFamilySizeEq1MeanChildViableCountSum,
      groupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `groupB meanLeafMinChildViableCount: ${avg(
      counters.rebuildLeafDominantFamilySizeEq1MinChildViableCountSum,
      groupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `groupB childViableCount>=2: ${counters.rebuildLeafDominantFamilySizeEq1ChildViableCountGe2CountSum}/${counters.rebuildLeafDominantFamilySizeEq1ChildCountSum} (${pct(
      avg(
        counters.rebuildLeafDominantFamilySizeEq1ChildViableCountGe2CountSum,
        counters.rebuildLeafDominantFamilySizeEq1ChildCountSum
      )
    )})`
  );
  console.log(
    `closureReadyGroupA eventualClosureReadyHitCount>=2: ${counters.rebuildLeafEventualClosureReadyHitsGe2Count}/${stableViabilityDenom} (${pct(
      avg(counters.rebuildLeafEventualClosureReadyHitsGe2Count, stableViabilityDenom)
    )})`
  );
  console.log(
    `closureReadyGroupA hlWithin8AfterRebuildAcceptedCount: ${counters.hlWithin8AfterRebuildAcceptedEventualClosureReadyHitsGe2Count}`
  );
  console.log(
    `closureReadyGroupA meanViableMoveCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsGe2ViableMoveCountSum,
      closureReadyGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupA meanChildViableCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsGe2ChildViableCountSum,
      counters.rebuildLeafEventualClosureReadyHitsGe2ChildCountSum
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupA meanLeafMinChildViableCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsGe2MinChildViableCountSum,
      closureReadyGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupA meanEventualOrthAdjHitCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsGe2OrthAdjHitCountSum,
      closureReadyGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupA meanEventualOneSlideHitCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsGe2OneSlideHitCountSum,
      closureReadyGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupA meanEventualClosureReadyHitCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsGe2ClosureReadyHitCountSum,
      closureReadyGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupA meanEventualClosureReadyHitShare: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsGe2ClosureReadyHitShareSum,
      closureReadyGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupB eventualClosureReadyHitCount<2: ${counters.rebuildLeafEventualClosureReadyHitsLt2Count}/${stableViabilityDenom} (${pct(
      avg(counters.rebuildLeafEventualClosureReadyHitsLt2Count, stableViabilityDenom)
    )})`
  );
  console.log(
    `closureReadyGroupB hlWithin8AfterRebuildAcceptedCount: ${counters.hlWithin8AfterRebuildAcceptedEventualClosureReadyHitsLt2Count}`
  );
  console.log(
    `closureReadyGroupB meanViableMoveCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsLt2ViableMoveCountSum,
      closureReadyGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupB meanChildViableCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsLt2ChildViableCountSum,
      counters.rebuildLeafEventualClosureReadyHitsLt2ChildCountSum
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupB meanLeafMinChildViableCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsLt2MinChildViableCountSum,
      closureReadyGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupB meanEventualOrthAdjHitCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsLt2OrthAdjHitCountSum,
      closureReadyGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupB meanEventualOneSlideHitCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsLt2OneSlideHitCountSum,
      closureReadyGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupB meanEventualClosureReadyHitCount: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsLt2ClosureReadyHitCountSum,
      closureReadyGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `closureReadyGroupB meanEventualClosureReadyHitShare: ${avg(
      counters.rebuildLeafEventualClosureReadyHitsLt2ClosureReadyHitShareSum,
      closureReadyGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupA eventualOrthAdjHitCount>=2: ${counters.rebuildLeafEventualOrthAdjHitsGe2Count}/${stableViabilityDenom} (${pct(
      avg(counters.rebuildLeafEventualOrthAdjHitsGe2Count, stableViabilityDenom)
    )})`
  );
  console.log(
    `orthAdjGroupA hlWithin8AfterRebuildAcceptedCount: ${counters.hlWithin8AfterRebuildAcceptedEventualOrthAdjHitsGe2Count}`
  );
  console.log(
    `orthAdjGroupA meanViableMoveCount: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsGe2ViableMoveCountSum,
      orthAdjGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupA meanChildViableCount: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsGe2ChildViableCountSum,
      counters.rebuildLeafEventualOrthAdjHitsGe2ChildCountSum
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupA meanLeafMinChildViableCount: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsGe2MinChildViableCountSum,
      orthAdjGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupA meanEventualOrthAdjHitCount: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsGe2OrthAdjHitCountSum,
      orthAdjGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupA meanEventualOrthAdjHitShare: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsGe2OrthAdjHitShareSum,
      orthAdjGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupA meanEventualOneSlideHitCount: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsGe2OneSlideHitCountSum,
      orthAdjGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupA meanEventualOneSlideHitShare: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsGe2OneSlideHitShareSum,
      orthAdjGroupADenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupB eventualOrthAdjHitCount<2: ${counters.rebuildLeafEventualOrthAdjHitsLt2Count}/${stableViabilityDenom} (${pct(
      avg(counters.rebuildLeafEventualOrthAdjHitsLt2Count, stableViabilityDenom)
    )})`
  );
  console.log(
    `orthAdjGroupB hlWithin8AfterRebuildAcceptedCount: ${counters.hlWithin8AfterRebuildAcceptedEventualOrthAdjHitsLt2Count}`
  );
  console.log(
    `orthAdjGroupB meanViableMoveCount: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsLt2ViableMoveCountSum,
      orthAdjGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupB meanChildViableCount: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsLt2ChildViableCountSum,
      counters.rebuildLeafEventualOrthAdjHitsLt2ChildCountSum
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupB meanLeafMinChildViableCount: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsLt2MinChildViableCountSum,
      orthAdjGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupB meanEventualOrthAdjHitCount: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsLt2OrthAdjHitCountSum,
      orthAdjGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupB meanEventualOrthAdjHitShare: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsLt2OrthAdjHitShareSum,
      orthAdjGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupB meanEventualOneSlideHitCount: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsLt2OneSlideHitCountSum,
      orthAdjGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `orthAdjGroupB meanEventualOneSlideHitShare: ${avg(
      counters.rebuildLeafEventualOrthAdjHitsLt2OneSlideHitShareSum,
      orthAdjGroupBDenom
    ).toFixed(4)}`
  );
  console.log(
    `minAcceptedLeafChildViableCount: ${counters.minAcceptedLeafChildViableCount}`
  );
  console.log(
    `minRejectedLeafChildViableCount: ${counters.minRejectedLeafChildViableCount}`
  );
  console.log(
    `mean bestTopTwoDistanceImprovement: ${meanBestTopTwoDistanceImprovement(counters).toFixed(4)}`
  );
  console.log(
    `bestTopTwoDistanceImprovement>=1 ratio: ${pct(fracBestTopTwoDistanceImprovementGe1(counters))}`
  );
  console.log(`canHlMergeNext leaf ratio: ${pct(fracClosureCanHlMergeNext(counters))}`);
  console.log(`didHlMerge path ratio: ${pct(fracClosureDidHlMergePath(counters))}`);
  console.log(`softTopOneBroken: ${counters.softTopOneBroken}`);
  console.log(`softTopTwoBroken: ${counters.softTopTwoBroken}`);
  console.log(`recoveredTopTwoInsideBlockFromBrokenRoot: ${counters.recoveredTopTwoInsideBlockFromBrokenRoot}`);
  console.log(`recoveredCanHlMergeNextFromBrokenRoot: ${counters.recoveredCanHlMergeNextFromBrokenRoot}`);
  console.log(`recoveredHlOpportunitySoonFromBrokenRoot: ${counters.recoveredHlOpportunitySoonFromBrokenRoot}`);
  console.log(`recoveredClosureProgressFromWeakRoot: ${counters.recoveredClosureProgressFromWeakRoot}`);
  const rootDenom = Math.max(1, counters.rootSamples);
  console.log(`root legal actions mean: ${(counters.rootLegalActionCount / rootDenom).toFixed(4)}`);
  console.log(`root after no-op mean: ${(counters.rootCandidateAfterNoOp / rootDenom).toFixed(4)}`);
  console.log(
    `root after hard prune mean: ${(counters.rootCandidateAfterHardPrune / rootDenom).toFixed(4)}`
  );
  console.log(`root after cap mean: ${(counters.rootCandidateAfterCap / rootDenom).toFixed(4)}`);
}

function printRootGeometrySummary(counters: ClosureDebugCounters): void {
  const denom = Math.max(1, counters.rootGeometrySamples);
  console.log("\nRoot Geometry");
  console.log(`root geometry samples: ${counters.rootGeometrySamples}`);
  console.log(
    `rootAnchorStable: ${counters.rootAnchorStable} (${pct(counters.rootAnchorStable / denom)})`
  );
  console.log(
    `rootTopTileInsideBlock: ${counters.rootTopTileInsideBlock} (${pct(counters.rootTopTileInsideBlock / denom)})`
  );
  console.log(
    `rootTopTwoInsideBlock: ${counters.rootTopTwoInsideBlock} (${pct(counters.rootTopTwoInsideBlock / denom)})`
  );
  console.log(
    `rootCornerClean: ${counters.rootCornerClean} (${pct(counters.rootCornerClean / denom)})`
  );
  console.log(
    `rootCanHlMergeNext: ${counters.rootCanHlMergeNext} (${pct(counters.rootCanHlMergeNext / denom)})`
  );
  console.log(
    `rootAllGeometryOk: ${counters.rootAllGeometryOk} (${pct(counters.rootAllGeometryOk / denom)})`
  );
  console.log(
    `rootClosureReadyStrict: ${counters.rootClosureReadyStrict} (${pct(counters.rootClosureReadyStrict / denom)})`
  );
  console.log(
    `rootClosureReadyLoose: ${counters.rootClosureReadyLoose} (${pct(counters.rootClosureReadyLoose / denom)})`
  );
}

function printInitPathSummary(counters: ClosureDebugCounters): void {
  const denom = Math.max(1, counters.initSamples);
  console.log("\nInit PathState");
  console.log(`init samples: ${counters.initSamples}`);
  console.log(
    `initAnchorStableAll: ${counters.initAnchorStableAll} (${pct(counters.initAnchorStableAll / denom)})`
  );
  console.log(
    `initTopEndInsideBlockAll: ${counters.initTopEndInsideBlockAll} (${pct(counters.initTopEndInsideBlockAll / denom)})`
  );
  console.log(
    `initCornerCleanAll: ${counters.initCornerCleanAll} (${pct(counters.initCornerCleanAll / denom)})`
  );
}

function printExplorationSummary(counters: ClosureDebugCounters): void {
  const nodeDenom = Math.max(1, counters.exploredNodeCount);
  const leafDenom = Math.max(1, counters.exploredLeafCount);
  const searchDenom = Math.max(1, counters.searchInvoked);
  console.log("\nExploration Summary");
  console.log(`exploredNodeCount: ${counters.exploredNodeCount}`);
  console.log(
    `exploredNodeCanHlMergeNextCount: ${counters.exploredNodeCanHlMergeNextCount} (${pct(counters.exploredNodeCanHlMergeNextCount / nodeDenom)})`
  );
  console.log(
    `exploredNodeCanCreateHlOpportunitySoonCount: ${counters.exploredNodeCanCreateHlOpportunitySoonCount} (${pct(counters.exploredNodeCanCreateHlOpportunitySoonCount / nodeDenom)})`
  );
  console.log(
    `exploredNodeMadeClosureProgressCount: ${counters.exploredNodeMadeClosureProgressCount} (${pct(counters.exploredNodeMadeClosureProgressCount / nodeDenom)})`
  );
  console.log(
    `exploredNodeTopTwoInsideBlockCount: ${counters.exploredNodeTopTwoInsideBlockCount} (${pct(counters.exploredNodeTopTwoInsideBlockCount / nodeDenom)})`
  );
  console.log(`exploredLeafCount: ${counters.exploredLeafCount}`);
  console.log(
    `exploredLeafCanHlMergeNextCount: ${counters.exploredLeafCanHlMergeNextCount} (${pct(counters.exploredLeafCanHlMergeNextCount / leafDenom)})`
  );
  console.log(
    `exploredLeafCanCreateHlOpportunitySoonCount: ${counters.exploredLeafCanCreateHlOpportunitySoonCount} (${pct(counters.exploredLeafCanCreateHlOpportunitySoonCount / leafDenom)})`
  );
  console.log(
    `exploredLeafMadeClosureProgressCount: ${counters.exploredLeafMadeClosureProgressCount} (${pct(counters.exploredLeafMadeClosureProgressCount / leafDenom)})`
  );
  console.log(
    `anyExploredCanHlMergeNext: ${counters.anyExploredCanHlMergeNextCount} (${pct(counters.anyExploredCanHlMergeNextCount / searchDenom)})`
  );
  console.log(
    `anyExploredCanCreateHlOpportunitySoon: ${counters.anyExploredCanCreateHlOpportunitySoonCount} (${pct(counters.anyExploredCanCreateHlOpportunitySoonCount / searchDenom)})`
  );
  console.log(
    `anyExploredMadeClosureProgress: ${counters.anyExploredMadeClosureProgressCount} (${pct(counters.anyExploredMadeClosureProgressCount / searchDenom)})`
  );
  console.log(
    `anyExploredTopTwoInsideBlock: ${counters.anyExploredTopTwoInsideBlockCount} (${pct(counters.anyExploredTopTwoInsideBlockCount / searchDenom)})`
  );
}

function printFallbackReasons(counters: ClosureDebugCounters): void {
  const denom = Math.max(1, counters.failDidHlMergeOrWindowPath);
  console.log("\nFallback Gate Failure Breakdown (non-exclusive)");
  console.log(
    `didHlMergeOrWindowPath failed: ${counters.failDidHlMergeOrWindowPath} (${pct(counters.failDidHlMergeOrWindowPath / denom)})`
  );
  console.log(`noBestDir: ${counters.noBestDir} (${pct(counters.noBestDir / denom)})`);
  console.log(
    `windowUnbrokenAll==0: ${counters.failWindowUnbrokenAll} (${pct(counters.failWindowUnbrokenAll / denom)})`
  );
  console.log(
    `windowRunLen<3: ${counters.failWindowRunLen} (${pct(counters.failWindowRunLen / denom)})`
  );
  console.log(
    `canHlMergeNext==0: ${counters.failCanHlMergeNext} (${pct(counters.failCanHlMergeNext / denom)})`
  );
  console.log(
    `anchorStableAll==0: ${counters.failAnchorStableAll} (${pct(counters.failAnchorStableAll / denom)})`
  );
  console.log(
    `topEndInsideBlockAll==0: ${counters.failTopEndInsideBlockAll} (${pct(counters.failTopEndInsideBlockAll / denom)})`
  );
  console.log(
    `cornerCleanAll==0: ${counters.failCornerCleanAll} (${pct(counters.failCornerCleanAll / denom)})`
  );
  console.log(
    `minSurvClassOnPath<1: ${counters.failMinSurvClassOnPath} (${pct(counters.failMinSurvClassOnPath / denom)})`
  );
  console.log(
    `minLegalClassOnPath<1: ${counters.failMinLegalClassOnPath} (${pct(counters.failMinLegalClassOnPath / denom)})`
  );
}

function printBestEvalSummary(counters: ClosureDebugCounters): void {
  const denom = Math.max(1, counters.bestEvalSelectedCount);
  console.log("\nBestEval Summary");
  console.log(`selected bestEval count: ${counters.bestEvalSelectedCount}`);
  console.log(`bestPathFollowThroughCount: ${counters.bestPathFollowThroughCount}`);
  console.log(`mean bestEval windowRunLen: ${meanBestEvalWindowRunLen(counters).toFixed(4)}`);
  console.log(
    `mean bestTopTwoDistanceImprovement: ${meanBestTopTwoDistanceImprovement(counters).toFixed(4)}`
  );
  console.log(
    `bestTopTwoDistanceImprovement>=1: ${counters.bestEvalTopTwoDistanceImprovementGe1Count} (${pct(fracBestTopTwoDistanceImprovementGe1(counters))})`
  );
  console.log(
    `bestEval didHlMerge==1: ${counters.bestEvalDidHlMergeCount} (${pct(counters.bestEvalDidHlMergeCount / denom)})`
  );
  console.log(
    `bestEval windowUnbrokenAll==1: ${counters.bestEvalWindowUnbrokenCount} (${pct(counters.bestEvalWindowUnbrokenCount / denom)})`
  );
  console.log(
    `bestEval windowRunLen>=1: ${counters.bestEvalWindowRunLenGe1} (${pct(counters.bestEvalWindowRunLenGe1 / denom)})`
  );
  console.log(
    `bestEval windowRunLen>=2: ${counters.bestEvalWindowRunLenGe2} (${pct(counters.bestEvalWindowRunLenGe2 / denom)})`
  );
  console.log(
    `bestEval windowRunLen>=3: ${counters.bestEvalWindowRunLenGe3} (${pct(counters.bestEvalWindowRunLenGe3 / denom)})`
  );
  console.log(
    `bestEval canHlMergeNext==1: ${counters.bestEvalCanHlMergeNextCount} (${pct(counters.bestEvalCanHlMergeNextCount / denom)})`
  );
  console.log(
    `bestEval anchorStableAll==1: ${counters.bestEvalAnchorStableAllCount} (${pct(counters.bestEvalAnchorStableAllCount / denom)})`
  );
  console.log(
    `bestEval topEndInsideBlockAll==1: ${counters.bestEvalTopEndInsideBlockAllCount} (${pct(counters.bestEvalTopEndInsideBlockAllCount / denom)})`
  );
  console.log(
    `bestEval cornerCleanAll==1: ${counters.bestEvalCornerCleanAllCount} (${pct(counters.bestEvalCornerCleanAllCount / denom)})`
  );
  console.log(
    `bestEval everTopTwoInsideBlock==1: ${counters.bestEvalEverTopTwoInsideBlockCount} (${pct(counters.bestEvalEverTopTwoInsideBlockCount / denom)})`
  );
  console.log(
    `bestEval everCanHlMergeNext==1: ${counters.bestEvalEverCanHlMergeNextCount} (${pct(counters.bestEvalEverCanHlMergeNextCount / denom)})`
  );
  console.log(
    `bestEval everCanCreateHlOpportunitySoon==1: ${counters.bestEvalEverCanCreateHlOpportunitySoonCount} (${pct(counters.bestEvalEverCanCreateHlOpportunitySoonCount / denom)})`
  );
  console.log(
    `bestEval everMadeClosureProgress==1: ${counters.bestEvalEverMadeClosureProgressCount} (${pct(counters.bestEvalEverMadeClosureProgressCount / denom)})`
  );
  console.log(
    `bestEval minSurvClassOnPath>=1: ${counters.bestEvalMinSurvClassGe1Count} (${pct(counters.bestEvalMinSurvClassGe1Count / denom)})`
  );
  console.log(
    `bestEval minLegalClassOnPath>=1: ${counters.bestEvalMinLegalClassGe1Count} (${pct(counters.bestEvalMinLegalClassGe1Count / denom)})`
  );
}

function printPruneReasons(counters: ClosureDebugCounters): void {
  const totalPrunes =
    counters.pruneTopOneEscaped +
    counters.pruneAnchorLost +
    counters.pruneContamination +
    counters.pruneTopTwoEscaped;
  const denom = Math.max(1, totalPrunes);
  console.log("\nPrune Reasons");
  console.log(
    `topOneEscaped: ${counters.pruneTopOneEscaped} (${pct(counters.pruneTopOneEscaped / denom)})`
  );
  console.log(
    `anchorLost: ${counters.pruneAnchorLost} (${pct(counters.pruneAnchorLost / denom)})`
  );
  console.log(
    `contamination: ${counters.pruneContamination} (${pct(counters.pruneContamination / denom)})`
  );
  console.log(
    `topTwoEscaped: ${counters.pruneTopTwoEscaped} (${pct(counters.pruneTopTwoEscaped / denom)})`
  );
}

console.log(`closure A/B episodes=${episodes} seedBase=${seedBase} independentEpisodeSeeds=1`);

resetMinimalPolicyExperimentDebugCounters();
const baseline = runPolicy("baseline", () => createEarlyPost7LiftMinimalPolicy()).metrics;
const minimalPolicyExperimentCounters = snapshotMinimalPolicyExperimentDebugCounters();
resetClosureDebugCounters();
const hybrid = runPolicy("hybrid", () => createHybridPolicy()).metrics;
const counters = snapshotClosureDebugCounters();

printCoreTable(baseline, hybrid);
console.log("\nTerminal Reasons");
printTerminalReasons("baseline", baseline);
printTerminalReasons("hybrid", hybrid);
printEarlyLiftExperimentSummary(baseline, minimalPolicyExperimentCounters);
printFirst8Research("baseline", baseline);
printFirst8Research("hybrid", hybrid);
printEarlyPost7RecoveryResearch("baseline", baseline);
printEarlyPost7RecoveryResearch("hybrid", hybrid);
printClosureSummary(counters);
printRootGeometrySummary(counters);
printInitPathSummary(counters);
printExplorationSummary(counters);
printBestEvalSummary(counters);
printFallbackReasons(counters);
printPruneReasons(counters);

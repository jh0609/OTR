export type {
  Board,
  Direction,
  SlideResult,
  Policy,
  TerminalMode,
  TerminalReason,
  EpisodeResult,
  MonteCarloStats,
} from "./types";
export { TERMINAL_REASONS } from "./types";

export {
  SIZE,
  LEN,
  indexToRC,
  rcToIndex,
  emptyCount,
  maxTileLevel,
  boardEquals,
  freezeBoard,
  toUint8,
} from "./board";

export { slide } from "./slide";
export { spawnAll, spawnRandom } from "./spawn";
export { legalActions } from "./legal";
export { isTerminal } from "./terminal";

export {
  extractTopRow,
  extractTriple,
  detectPatterns,
  detectPatternsFromTriple,
  detectPatternsAtIndices,
  SNAKE_HEAD3_INDICES,
} from "./patterns";

export { createRng } from "./rng";

export {
  randomPolicy,
  makeRandomPolicy,
  greedyEmptyPolicy,
  snakePolicy,
  antiRandomPolicy,
  createAntiRandomPolicy,
  type AntiRandomConfig,
} from "./policies";

export { successSpawnOnly, forbidDeadPatterns } from "./strictRules";

export {
  SNAKE_PATH_INDICES,
  DUAL_SCORE,
  DEFAULT_SCORE_WEIGHTS,
  scoreBoard,
  countMergePairs,
  monotonicityAlongSnake,
  inversionCountAlongSnake,
  countIsolatedSmallTiles,
  type ScoreBoardWeights,
  type PatternTripleSource,
} from "./scoring";

export { scoreBoardV3 } from "./scoringV3";

export {
  mergeEndgameTuning,
  baselineEndgameTuning,
  experimentAEndgameTuning,
  experimentBEndgameTuning,
  experimentCEndgameTuning,
  experimentCEndgameWith78Tuning,
  type EndgameTuning,
  type EndgameTuningConfig,
} from "./endgameTuning";

export {
  buildExpectimaxFns,
  evaluateAfterSlideSpawnExpectation,
  evaluateAction,
  evaluateAction2,
  evaluateAction3,
  evaluateActionToLeaf,
  maxQTerminalToLeaf,
  maxQ1Ply,
  expectimaxPolicy,
  expectimaxPolicySelectiveLate3,
  searchExpectedValue,
  createExpectimaxPolicy,
  createSelectiveLate3PlyPolicy,
  expectimaxPolicyDefault,
  expectimaxPolicy2Ply,
  expectimaxPolicySelectiveLate3Ply,
  expectimaxPolicySelectiveLate3PlyBaseline,
  expectimaxPolicySelectiveLate3PlyExperimentA,
  expectimaxPolicySelectiveLate3PlyExperimentB,
  expectimaxPolicySelectiveLate3PlyExperimentC,
  expectimaxPolicySelectiveLate3PlyExperimentCWith78,
  type ExpectimaxConfig,
  type ExpectimaxDepth,
  type ExpectimaxFns,
  type SelectiveLate3PlyOptions,
  type SelectiveLate3PlyPolicyConfig,
} from "./expectimax";

export {
  secondMaxTile,
  top2Gap,
  nonZeroValuesDesc,
  countTilesAtLeast,
  countTilesEqual,
  countLowLevelMergePairs,
  rebuildLaneScore,
  trappedAroundMaxTile,
  maxTileAtAnchor,
  hasSimultaneousTwo8s,
  hasSimultaneousOne8AndOne7,
  hasTwoOrMoreTilesEqual,
  topTwoTileSum,
  hasMax8AndSecond6,
  hasMax8AndSecond7,
  maxTileMovedOffAnchor,
  lateGameSlidePenalty,
  mergePotentialAtLevel,
  endgame7To8Potential,
  ultraLateSlidePreference,
  areAdjacent,
  hasAdjacentPair,
  hasAdjacentCrossPair,
  highLevelAdjacencyState,
  type HighLevelAdjState,
} from "./boardStats";

export { simulateOne, runMonteCarlo, emptyBoard, boardFrom } from "./simulate";

export {
  getHint,
  type HintSearchConfig,
  type HintResult,
  type HintDebug,
} from "./hintSearch";

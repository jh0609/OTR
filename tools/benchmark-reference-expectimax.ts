import {
  createExpectimaxPolicy,
  createRng,
  legalActions,
  maxTileLevel,
  slide,
  type Board,
  type Policy,
} from "../src/sim/index.ts";
import { hasImmediateMerge } from "../src/sim/boardStats.ts";
import { spawnRandomDetailed } from "../src/sim/spawn.ts";

type BenchPolicyDef = {
  label: string;
  create: () => Policy;
  depthUsed?: (board: Board) => number | null;
  preflightSkip?: {
    episodes: number;
    maxProjectedTotalMs: number;
  };
};

type BenchRunResult = {
  label: string;
  episodes: number;
  winCount: number;
  fusionCountTotal: number;
  fusionCountPerEpisode: string;
  firstFusionTurns: string;
  failuresBeforeFirstFusion: number;
  level8Count: number;
  avgTurns: number;
  avgDecisionMs: number;
  p95DecisionMs: number;
  p99DecisionMs: number;
  maxDecisionMs: number;
  totalRuntimeMs: number;
  invalidMoveCount: number;
  missedImmediateFusion8Count: number;
  depth8UsageCount: string;
  maxLevelDistribution: string;
  nonFiniteScoreCount: string;
  skipped: boolean;
  skipReason?: string;
};

const N = Math.max(1, Math.floor(Number(process.env.REF_BENCH_N ?? "20")));
const BASE_SEED = Math.floor(Number(process.env.REF_BENCH_SEED ?? "20260424"));
const DEPTH8_PREFLIGHT_EPISODES = Math.max(1, Math.floor(Number(process.env.REF_BENCH_D8_PREFLIGHT ?? "2")));
const DEPTH8_MAX_PROJECTED_MS = Math.max(
  1,
  Math.floor(Number(process.env.REF_BENCH_D8_MAX_PROJECTED_MS ?? "180000"))
);
const MAX_STEPS = Math.max(1, Math.floor(Number(process.env.REF_BENCH_MAX_STEPS ?? "5000")));

const EPISODE_SEEDS = Array.from({ length: N }, (_, i) => BASE_SEED + i);
const EMPTY: Board = Object.freeze(new Array(9).fill(0)) as Board;
const POLICY_FILTER = (process.env.REF_BENCH_POLICIES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const POLICY_ALIASES: Readonly<Record<string, string>> = {
  adaptive: "adaptive 6/8",
  "adaptive-wq": "adaptive 6/8 wq",
};
const NORMALIZED_POLICY_FILTER = POLICY_FILTER.map((label) => POLICY_ALIASES[label] ?? label);

type BenchEpisodeResult = {
  readonly win: boolean;
  readonly steps: number;
  readonly terminalReason: "no_legal_moves" | "policy_illegal_move" | "max_steps";
  readonly maxLevelReached: number;
  readonly fusionCount: number;
  readonly firstFusionTurn: number | null;
};

const policies: readonly BenchPolicyDef[] = [
  {
    label: "existing/default",
    create: () => createExpectimaxPolicy({}),
  },
  {
    label: "reference d6",
    create: () => createExpectimaxPolicy({ reference: true, referenceDepthLimit: 6, referenceLog: false }),
    depthUsed: () => 6,
  },
  {
    label: "adaptive 6/8",
    create: () =>
      createExpectimaxPolicy({
        reference: true,
        referenceAdaptive: true,
        referenceLog: false,
        referenceWinQualityTieBreak: false,
      }),
    depthUsed: (board) => (maxTileLevel(board) >= 8 ? 8 : 6),
    preflightSkip: {
      episodes: DEPTH8_PREFLIGHT_EPISODES,
      maxProjectedTotalMs: DEPTH8_MAX_PROJECTED_MS,
    },
  },
  {
    label: "adaptive 6/8 wq",
    create: () => createExpectimaxPolicy({ reference: true, referenceAdaptive: true, referenceLog: false }),
    depthUsed: (board) => (maxTileLevel(board) >= 8 ? 8 : 6),
    preflightSkip: {
      episodes: DEPTH8_PREFLIGHT_EPISODES,
      maxProjectedTotalMs: DEPTH8_MAX_PROJECTED_MS,
    },
  },
];

function fmtRate(count: number, total: number): string {
  return `${count}/${total} (${((count / total) * 100).toFixed(1)}%)`;
}

function fmtMs(ms: number): string {
  return `${ms.toFixed(2)}ms`;
}

function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function formatMaxLevelDistribution(results: readonly BenchEpisodeResult[]): string {
  const counts = new Map<number, number>();
  for (const result of results) {
    counts.set(result.maxLevelReached, (counts.get(result.maxLevelReached) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, count]) => `${level}:${count}`)
    .join(" ");
}

function initialBoard(rng: () => number): Board {
  let board = EMPTY;
  board = spawnRandomDetailed(board, rng).board;
  board = spawnRandomDetailed(board, rng).board;
  return board;
}

function runCappedEpisode(policy: Policy, rng: () => number): BenchEpisodeResult {
  let board = initialBoard(rng);
  let maxLevelReached = maxTileLevel(board);
  let win = false;
  let fusionCount = 0;
  let firstFusionTurn: number | null = null;

  for (let steps = 0; steps < MAX_STEPS; steps++) {
    const actions = legalActions(board);
    if (actions.length === 0) {
      return { win, steps, terminalReason: "no_legal_moves", maxLevelReached, fusionCount, firstFusionTurn };
    }
    const dir = policy(board, actions);
    if (!actions.includes(dir)) {
      return { win, steps, terminalReason: "policy_illegal_move", maxLevelReached, fusionCount, firstFusionTurn };
    }
    const result = slide(board, dir);
    if (!result.moved) {
      return {
        win,
        steps: steps + 1,
        terminalReason: "policy_illegal_move",
        maxLevelReached,
        fusionCount,
        firstFusionTurn,
      };
    }
    maxLevelReached = Math.max(maxLevelReached, maxTileLevel(result.next));
    if (result.win) {
      win = true;
      fusionCount++;
      if (firstFusionTurn === null) firstFusionTurn = steps + 1;
    }
    board = spawnRandomDetailed(result.next, rng).board;
    maxLevelReached = Math.max(maxLevelReached, maxTileLevel(board));
  }

  return { win, steps: MAX_STEPS, terminalReason: "max_steps", maxLevelReached, fusionCount, firstFusionTurn };
}

function runPolicyBenchmark(def: BenchPolicyDef): BenchRunResult {
  const policy = def.create();
  let decisionNs = 0n;
  let turnCount = 0;
  let invalidChoiceCount = 0;
  let missedImmediateFusion8Count = 0;
  let depth8UsageCount = 0;
  const decisionTimes: number[] = [];
  const episodeResults: BenchEpisodeResult[] = [];

  const wrappedPolicy: Policy = (board, actions) => {
    const startedAt = process.hrtime.bigint();
    if (def.depthUsed?.(board) === 8) {
      depth8UsageCount++;
    }
    const dir = policy(board, actions);
    const elapsedNs = process.hrtime.bigint() - startedAt;
    decisionNs += elapsedNs;
    decisionTimes.push(Number(elapsedNs) / 1_000_000);
    turnCount++;
    if (!actions.includes(dir)) {
      invalidChoiceCount++;
    } else if (hasImmediateMerge(board, 8) && !slide(board, dir).win) {
      missedImmediateFusion8Count++;
    }
    return dir;
  };

  const startedAt = process.hrtime.bigint();
  for (let i = 0; i < EPISODE_SEEDS.length; i++) {
    const result = runCappedEpisode(wrappedPolicy, createRng(EPISODE_SEEDS[i]!));
    episodeResults.push(result);

    if (def.preflightSkip !== undefined && i + 1 === def.preflightSkip.episodes) {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const projectedMs = (elapsedMs / (i + 1)) * EPISODE_SEEDS.length;
      if (projectedMs > def.preflightSkip.maxProjectedTotalMs) {
        return {
          label: def.label,
          episodes: i + 1,
          winCount: 0,
          fusionCountTotal: 0,
          fusionCountPerEpisode: "-",
          firstFusionTurns: "-",
          failuresBeforeFirstFusion: 0,
          level8Count: 0,
          avgTurns: 0,
          avgDecisionMs: 0,
          p95DecisionMs: 0,
          p99DecisionMs: 0,
          maxDecisionMs: 0,
          totalRuntimeMs: elapsedMs,
          invalidMoveCount: 0,
          missedImmediateFusion8Count: 0,
          depth8UsageCount: "-",
          maxLevelDistribution: "-",
          nonFiniteScoreCount: "n/a",
          skipped: true,
          skipReason: `projected total ${fmtSeconds(projectedMs)} exceeds ${fmtSeconds(def.preflightSkip.maxProjectedTotalMs)}`,
        };
      }
    }
  }
  const totalRuntimeMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  const winCount = episodeResults.filter((r) => r.win).length;
  const fusionCountTotal = episodeResults.reduce((sum, r) => sum + r.fusionCount, 0);
  const fusionCountPerEpisode = episodeResults.map((r) => String(r.fusionCount)).join(",");
  const firstFusionTurns = episodeResults.map((r) => (r.firstFusionTurn === null ? "-" : String(r.firstFusionTurn))).join(",");
  const failuresBeforeFirstFusion = episodeResults.filter(
    (r) => r.firstFusionTurn === null && r.terminalReason !== "max_steps"
  ).length;
  const level8Count = episodeResults.filter((r) => r.maxLevelReached >= 8).length;
  const avgTurns = episodeResults.reduce((sum, r) => sum + r.steps, 0) / episodeResults.length;
  const avgDecisionMs = turnCount > 0 ? Number(decisionNs) / 1_000_000 / turnCount : 0;
  const terminalInvalidMoves = episodeResults.filter((r) => r.terminalReason === "policy_illegal_move").length;
  const sortedDecisionTimes = decisionTimes.sort((a, b) => a - b);

  return {
    label: def.label,
    episodes: episodeResults.length,
    winCount,
    fusionCountTotal,
    fusionCountPerEpisode,
    firstFusionTurns,
    failuresBeforeFirstFusion,
    level8Count,
    avgTurns,
    avgDecisionMs,
    p95DecisionMs: percentile(sortedDecisionTimes, 95),
    p99DecisionMs: percentile(sortedDecisionTimes, 99),
    maxDecisionMs: sortedDecisionTimes[sortedDecisionTimes.length - 1] ?? 0,
    totalRuntimeMs,
    invalidMoveCount: Math.max(invalidChoiceCount, terminalInvalidMoves),
    missedImmediateFusion8Count,
    depth8UsageCount: def.depthUsed === undefined ? "n/a" : String(depth8UsageCount),
    maxLevelDistribution: formatMaxLevelDistribution(episodeResults),
    nonFiniteScoreCount: "n/a",
    skipped: false,
  };
}

function printResults(results: readonly BenchRunResult[]): void {
  console.log(`reference expectimax benchmark`);
  console.log(
    `episodes=${N} baseSeed=${BASE_SEED} seeds=${EPISODE_SEEDS[0]}..${EPISODE_SEEDS[EPISODE_SEEDS.length - 1]} maxSteps=${MAX_STEPS}`
  );
  console.log("");
  console.log(
    [
      "policy".padEnd(18),
      "fusion/win".padEnd(14),
      "fusions".padEnd(8),
      "noFirstFail".padEnd(11),
      "reach8".padEnd(14),
      "avgTurns".padEnd(10),
      "avgDecision".padEnd(13),
      "p95/p99/max".padEnd(24),
      "total".padEnd(10),
      "depth8Used".padEnd(10),
      "missImm8".padEnd(9),
      "invalid".padEnd(8),
      "maxLevelDist",
    ].join(" | ")
  );
  console.log("-".repeat(120));
  for (const result of results) {
    if (result.skipped) {
      console.log(
        [
          result.label.padEnd(18),
          "skipped".padEnd(14),
          "-".padEnd(8),
          "-".padEnd(11),
          "skipped".padEnd(14),
          "-".padEnd(10),
          "-".padEnd(13),
          "-".padEnd(24),
          fmtSeconds(result.totalRuntimeMs).padEnd(10),
          result.depth8UsageCount.padEnd(10),
          "-".padEnd(9),
          "-".padEnd(8),
          result.skipReason ?? "",
        ].join(" | ")
      );
      continue;
    }

    console.log(
      [
        result.label.padEnd(18),
        fmtRate(result.winCount, result.episodes).padEnd(14),
        String(result.fusionCountTotal).padEnd(8),
        String(result.failuresBeforeFirstFusion).padEnd(11),
        fmtRate(result.level8Count, result.episodes).padEnd(14),
        result.avgTurns.toFixed(1).padEnd(10),
        fmtMs(result.avgDecisionMs).padEnd(13),
        `${fmtMs(result.p95DecisionMs)}/${fmtMs(result.p99DecisionMs)}/${fmtMs(result.maxDecisionMs)}`.padEnd(24),
        fmtSeconds(result.totalRuntimeMs).padEnd(10),
        result.depth8UsageCount.padEnd(10),
        String(result.missedImmediateFusion8Count).padEnd(9),
        String(result.invalidMoveCount).padEnd(8),
        result.maxLevelDistribution,
      ].join(" | ")
    );
    console.log(`  fusionCountPerEpisode=${result.fusionCountPerEpisode}`);
    console.log(`  firstFusionTurn=${result.firstFusionTurns}`);
  }
}

const selectedPolicies =
  NORMALIZED_POLICY_FILTER.length === 0
    ? policies
    : policies.filter((policy) => NORMALIZED_POLICY_FILTER.includes(policy.label));
const results = selectedPolicies.map(runPolicyBenchmark);
printResults(results);

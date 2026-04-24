import {
  createExpectimaxPolicy,
  createRng,
  maxTileLevel,
  simulateOne,
  type Board,
  type EpisodeResult,
  type Policy,
} from "../src/sim/index.ts";

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
  level8Count: number;
  avgTurns: number;
  avgDecisionMs: number;
  totalRuntimeMs: number;
  invalidMoveCount: number;
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

const EPISODE_SEEDS = Array.from({ length: N }, (_, i) => BASE_SEED + i);

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

function formatMaxLevelDistribution(results: readonly EpisodeResult[]): string {
  const counts = new Map<number, number>();
  for (const result of results) {
    counts.set(result.maxLevelReached, (counts.get(result.maxLevelReached) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, count]) => `${level}:${count}`)
    .join(" ");
}

function runPolicyBenchmark(def: BenchPolicyDef): BenchRunResult {
  const policy = def.create();
  let decisionNs = 0n;
  let turnCount = 0;
  let invalidChoiceCount = 0;
  let depth8UsageCount = 0;
  const episodeResults: EpisodeResult[] = [];

  const wrappedPolicy: Policy = (board, actions) => {
    const startedAt = process.hrtime.bigint();
    if (def.depthUsed?.(board) === 8) {
      depth8UsageCount++;
    }
    const dir = policy(board, actions);
    decisionNs += process.hrtime.bigint() - startedAt;
    turnCount++;
    if (!actions.includes(dir)) {
      invalidChoiceCount++;
    }
    return dir;
  };

  const startedAt = process.hrtime.bigint();
  for (let i = 0; i < EPISODE_SEEDS.length; i++) {
    const result = simulateOne(wrappedPolicy, createRng(EPISODE_SEEDS[i]!));
    episodeResults.push(result);

    if (def.preflightSkip !== undefined && i + 1 === def.preflightSkip.episodes) {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const projectedMs = (elapsedMs / (i + 1)) * EPISODE_SEEDS.length;
      if (projectedMs > def.preflightSkip.maxProjectedTotalMs) {
        return {
          label: def.label,
          episodes: i + 1,
          winCount: 0,
          level8Count: 0,
          avgTurns: 0,
          avgDecisionMs: 0,
          totalRuntimeMs: elapsedMs,
          invalidMoveCount: 0,
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

  const winCount = episodeResults.filter((r) => r.win || r.maxLevelReached >= 9).length;
  const level8Count = episodeResults.filter((r) => r.maxLevelReached >= 8).length;
  const avgTurns = episodeResults.reduce((sum, r) => sum + r.steps, 0) / episodeResults.length;
  const avgDecisionMs = turnCount > 0 ? Number(decisionNs) / 1_000_000 / turnCount : 0;
  const terminalInvalidMoves = episodeResults.filter((r) => r.terminalReason === "policy_illegal_move").length;

  return {
    label: def.label,
    episodes: episodeResults.length,
    winCount,
    level8Count,
    avgTurns,
    avgDecisionMs,
    totalRuntimeMs,
    invalidMoveCount: Math.max(invalidChoiceCount, terminalInvalidMoves),
    depth8UsageCount: def.depthUsed === undefined ? "n/a" : String(depth8UsageCount),
    maxLevelDistribution: formatMaxLevelDistribution(episodeResults),
    nonFiniteScoreCount: "n/a",
    skipped: false,
  };
}

function printResults(results: readonly BenchRunResult[]): void {
  console.log(`reference expectimax benchmark`);
  console.log(`episodes=${N} baseSeed=${BASE_SEED} seeds=${EPISODE_SEEDS[0]}..${EPISODE_SEEDS[EPISODE_SEEDS.length - 1]}`);
  console.log("");
  console.log(
    [
      "policy".padEnd(18),
      "win/9".padEnd(14),
      "reach8".padEnd(14),
      "avgTurns".padEnd(10),
      "avgDecision".padEnd(13),
      "total".padEnd(10),
      "depth8Used".padEnd(10),
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
          "skipped".padEnd(14),
          "-".padEnd(10),
          "-".padEnd(13),
          fmtSeconds(result.totalRuntimeMs).padEnd(10),
          result.depth8UsageCount.padEnd(10),
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
        fmtRate(result.level8Count, result.episodes).padEnd(14),
        result.avgTurns.toFixed(1).padEnd(10),
        fmtMs(result.avgDecisionMs).padEnd(13),
        fmtSeconds(result.totalRuntimeMs).padEnd(10),
        result.depth8UsageCount.padEnd(10),
        String(result.invalidMoveCount).padEnd(8),
        result.maxLevelDistribution,
      ].join(" | ")
    );
  }
}

const results = policies.map(runPolicyBenchmark);
printResults(results);

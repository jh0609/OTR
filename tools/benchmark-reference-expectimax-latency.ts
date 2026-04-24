import {
  createExpectimaxPolicy,
  createRng,
  emptyCount,
  maxTileLevel,
  simulateOne,
  type Board,
  type Policy,
} from "../src/sim/index.ts";

type DecisionSample = {
  seed: number;
  turn: number;
  ms: number;
  maxTile: number;
  empty: number;
};

const N = Math.max(1, Math.floor(Number(process.env.REF_LAT_N ?? "5")));
const BASE_SEED = Math.floor(Number(process.env.REF_LAT_SEED ?? "20260424"));
const RUNTIME_BUDGET_MS = 1000;

const adaptivePolicy = createExpectimaxPolicy({
  reference: true,
  referenceAdaptive: true,
  referenceLog: false,
});

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function runEpisode(seed: number): DecisionSample[] {
  const samples: DecisionSample[] = [];
  let turn = 0;

  const wrappedPolicy: Policy = (board, actions) => {
    const startedAt = process.hrtime.bigint();
    const dir = adaptivePolicy(board, actions);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    samples.push({
      seed,
      turn,
      ms: elapsedMs,
      maxTile: maxTileLevel(board),
      empty: emptyCount(board),
    });
    turn++;
    return dir;
  };

  simulateOne(wrappedPolicy, createRng(seed));
  return samples;
}

function printSummary(samples: readonly DecisionSample[]): void {
  const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const avg = times.reduce((sum, value) => sum + value, 0) / times.length;
  const maxSample = samples.reduce((best, current) => (current.ms > best.ms ? current : best), samples[0]!);

  console.log("adaptive reference expectimax latency");
  console.log(`episodes=${N} baseSeed=${BASE_SEED} decisions=${samples.length}`);
  console.log("");
  console.log(`avgDecisionMs=${avg.toFixed(2)}`);
  console.log(`p50Ms=${percentile(times, 50).toFixed(2)}`);
  console.log(`p90Ms=${percentile(times, 90).toFixed(2)}`);
  console.log(`p95Ms=${percentile(times, 95).toFixed(2)}`);
  console.log(`p99Ms=${percentile(times, 99).toFixed(2)}`);
  console.log(`maxDecisionMs=${maxSample.ms.toFixed(2)}`);
  console.log(`maxSeed=${maxSample.seed}`);
  console.log(`maxTurn=${maxSample.turn}`);
  console.log(`maxBoardMaxTile=${maxSample.maxTile}`);
  console.log(`maxBoardEmptyCount=${maxSample.empty}`);
  console.log(
    maxSample.ms < RUNTIME_BUDGET_MS
      ? `budgetCheck=safe_under_${RUNTIME_BUDGET_MS}ms`
      : `budgetCheck=exceeds_${RUNTIME_BUDGET_MS}ms`
  );
}

const allSamples: DecisionSample[] = [];
for (let i = 0; i < N; i++) {
  const seed = BASE_SEED + i;
  allSamples.push(...runEpisode(seed));
}

printSummary(allSamples);

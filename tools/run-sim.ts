/**
 * CLI: Monte Carlo 승률·평균 스텝·레벨 분포·종료 사유·듀얼 빌드 디버그 로그.
 * 실행: npm run sim
 *
 * SIM_N 팁: 구조 지표 방향만 볼 때는 처음에 5000 정도로 돌리고,
 * 차이가 보이면 10000~20000으로 올려 확인하면 된다.
 * 미세한 승률보다 ever two 7s / 8+7 / peakSecondMax 등 구조가 우선.
 *
 * 옵션 예: SIM_SEED=7 SIM_N=5000 npm run sim
 */
import {
  runMonteCarlo,
  createRng,
  expectimaxPolicySelectiveLate3PlyExperimentC,
  expectimaxPolicySelectiveLate3PlyExperimentCWith78,
  expectimaxPolicySelectiveLate3PlyExperimentCWith78MergeTiming,
  experimentCEndgameWith78MergeTiming,
  simulateOne,
  TERMINAL_REASONS,
  getHint,
  type MonteCarloStats,
  type Policy,
  type TerminalReason,
} from "../src/sim/index.ts";

const seed = Number(process.env.SIM_SEED ?? "42");
/** 기본 5000 — 튜닝 스캔용. 긴 실행은 SIM_N=10000~20000 또는 그 이상. */
const n = Number(process.env.SIM_N ?? "5000");

const HIST_FOCUS = [4, 5, 6, 7, 8, 9] as const;

function pct(x: number, total: number): string {
  if (total <= 0) return "0.00";
  return ((x / total) * 100).toFixed(2);
}

function printHistogramRange(
  label: string,
  dist: Readonly<Record<number, number>>,
  totalEpisodes: number,
  levels: readonly number[]
): void {
  console.log(`    ${label} (L=${levels[0]}…${levels[levels.length - 1]}):`);
  const parts: string[] = [];
  for (const L of levels) {
    const c = dist[L] ?? 0;
    parts.push(`L${L}=${c}`);
  }
  console.log(`      ${parts.join("  |  ")}`);
  console.log(
    `      share%: ${levels.map((L) => pct(dist[L] ?? 0, totalEpisodes)).join(" | ")}`
  );
}

function rowDist(dist: Readonly<Record<number, number>>, keys: readonly number[]): string {
  return keys.map((k) => `${k}=${dist[k] ?? 0}`).join("  ");
}

/** peakSecondMax 분포의 에피소드당 평균(가장 높았던 secondMax의 기댓값에 가까움). */
function meanPeakSecondMax(stats: MonteCarloStats, totalEpisodes: number): string {
  if (totalEpisodes <= 0) return "n/a";
  let sum = 0;
  for (const [level, count] of Object.entries(stats.peakSecondMaxDistribution)) {
    sum += Number(level) * count;
  }
  return (sum / totalEpisodes).toFixed(3);
}

function padCell(s: string, width: number): string {
  const t = s.length >= width ? s.slice(0, width - 1) + "…" : s;
  return t.padEnd(width);
}

/**
 * baseline / A / B / C 붙여넣기용 한 블록 (승률보다 구조 지표 방향용).
 * ever two 8s가 처음으로 0을 벗어나면 승률 실험 단계로 넘어가도 됨.
 */
function printStructureSummaryBlock(
  rows: { label: string; stats: MonteCarloStats }[],
  totalEpisodes: number
): void {
  const cols = rows.map((r) => r.label);
  const metricW = 30;
  const colW = 12;

  console.log("\n  ========== 구조 지표 요약 (복사용) ==========");
  console.log(
    `  ${padCell("metric", metricW)}${cols.map((c) => padCell(c, colW)).join("")}`
  );
  const line = (metric: string, fmt: (s: MonteCarloStats) => string) => {
    console.log(
      `  ${padCell(metric, metricW)}${rows.map((r) => padCell(fmt(r.stats), colW)).join("")}`
    );
  };

  line("ever level ≥8 (count, %)", (s) => `${s.episodesWithEverGte8} (${pct(s.episodesWithEverGte8, totalEpisodes)}%)`);
  line("ever two 7s", (s) => `${s.episodesEverTwoSevens} (${pct(s.episodesEverTwoSevens, totalEpisodes)}%)`);
  line("ever one 8 + one 7", (s) => `${s.episodesEverOne8AndOne7} (${pct(s.episodesEverOne8AndOne7, totalEpisodes)}%)`);
  line("ever two 8s", (s) => `${s.episodesEverTwo8s} (${pct(s.episodesEverTwo8s, totalEpisodes)}%)`);
  line("ever adjacent 7+7", (s) => `${s.episodesEverAdjacent77} (${pct(s.episodesEverAdjacent77, totalEpisodes)}%)`);
  line("ever adjacent 8+7", (s) => `${s.episodesEverAdjacent87} (${pct(s.episodesEverAdjacent87, totalEpisodes)}%)`);
  line("ever adjacent 8+8", (s) => `${s.episodesEverAdjacent88} (${pct(s.episodesEverAdjacent88, totalEpisodes)}%)`);
  line("final adjacent 7+7", (s) => `${s.episodesFinalAdjacent77} (${pct(s.episodesFinalAdjacent77, totalEpisodes)}%)`);
  line("final adjacent 8+7", (s) => `${s.episodesFinalAdjacent87} (${pct(s.episodesFinalAdjacent87, totalEpisodes)}%)`);
  line("final adjacent 8+8", (s) => `${s.episodesFinalAdjacent88} (${pct(s.episodesFinalAdjacent88, totalEpisodes)}%)`);
  line("ever immediate merge7", (s) => `${s.episodesEverImmediateMerge7} (${pct(s.episodesEverImmediateMerge7, totalEpisodes)}%)`);
  line("ever immediate merge8", (s) => `${s.episodesEverImmediateMerge8} (${pct(s.episodesEverImmediateMerge8, totalEpisodes)}%)`);
  line("ever adj7+7 no imm7", (s) => `${s.episodesEverAdjacent77NoImmediate7} (${pct(s.episodesEverAdjacent77NoImmediate7, totalEpisodes)}%)`);
  line("ever adj8+8 no imm8", (s) => `${s.episodesEverAdjacent88NoImmediate8} (${pct(s.episodesEverAdjacent88NoImmediate8, totalEpisodes)}%)`);
  line("final canMerge7Now", (s) => `${s.episodesFinalCanMerge7Now} (${pct(s.episodesFinalCanMerge7Now, totalEpisodes)}%)`);
  line("final canMerge8Now", (s) => `${s.episodesFinalCanMerge8Now} (${pct(s.episodesFinalCanMerge8Now, totalEpisodes)}%)`);
  line("ever max8+second6", (s) => `${s.episodesEverMax8Second6} (${pct(s.episodesEverMax8Second6, totalEpisodes)}%)`);
  line("ever max8+second7", (s) => `${s.episodesEverMax8Second7} (${pct(s.episodesEverMax8Second7, totalEpisodes)}%)`);
  line("mp7>0 while max≥8 (episodes)", (s) => `${s.episodesEverMp7PositiveWhileMaxGte8} (${pct(s.episodesEverMp7PositiveWhileMaxGte8, totalEpisodes)}%)`);
  line("8+7 & mp7>0", (s) => `${s.episodesEverMax8Second7Mp7Positive} (${pct(s.episodesEverMax8Second7Mp7Positive, totalEpisodes)}%)`);
  line("8+7 & mp7==0", (s) => `${s.episodesEverMax8Second7Mp7Zero} (${pct(s.episodesEverMax8Second7Mp7Zero, totalEpisodes)}%)`);
  line("mean peak mp7", (s) => s.meanPeakMergePotential7.toFixed(3));
  line("mean final mp7", (s) => s.meanFinalMergePotential7.toFixed(3));
  line("peakSecondMaxTile (mean)", (s) => meanPeakSecondMax(s, totalEpisodes));
  line("avgSteps", (s) => s.avgSteps.toFixed(2));

  console.log("  ============================================\n");
}

function printMonteCarloStats(stats: MonteCarloStats, totalEpisodes: number): void {
  console.log(`    winRate: ${(stats.winRate * 100).toFixed(4)}%`);
  console.log(`    avgSteps: ${stats.avgSteps.toFixed(2)}`);
  console.log(`    mean final top2Gap: ${stats.meanFinalTop2Gap.toFixed(3)}`);
  console.log(`    mean peak count(≥7): ${stats.meanPeakCountGe7.toFixed(3)}`);
  console.log(`    mean peak top2 tile sum: ${stats.meanPeakTopTwoSum.toFixed(2)}`);
  console.log(
    `    episodes with ever level ≥6: ${stats.episodesWithEverGte6} (${pct(stats.episodesWithEverGte6, totalEpisodes)}%)`
  );
  console.log(
    `    episodes with ever level ≥7: ${stats.episodesWithEverGte7} (${pct(stats.episodesWithEverGte7, totalEpisodes)}%)`
  );
  console.log(
    `    episodes with ever level ≥8: ${stats.episodesWithEverGte8} (${pct(stats.episodesWithEverGte8, totalEpisodes)}%)`
  );
  console.log("    --- dual-build diagnostics ---");
  console.log(
    `    ever two 7s (simultaneous): ${stats.episodesEverTwoSevens} (${pct(stats.episodesEverTwoSevens, totalEpisodes)}%)`
  );
  console.log(
    `    ever one 8 + one 7: ${stats.episodesEverOne8AndOne7} (${pct(stats.episodesEverOne8AndOne7, totalEpisodes)}%)`
  );
  console.log(
    `    ever two 8s (simultaneous): ${stats.episodesEverTwo8s} (${pct(stats.episodesEverTwo8s, totalEpisodes)}%)`
  );
  console.log(
    `    ever adjacent 7+7: ${stats.episodesEverAdjacent77} (${pct(stats.episodesEverAdjacent77, totalEpisodes)}%)`
  );
  console.log(
    `    ever adjacent 8+7: ${stats.episodesEverAdjacent87} (${pct(stats.episodesEverAdjacent87, totalEpisodes)}%)`
  );
  console.log(
    `    ever adjacent 8+8: ${stats.episodesEverAdjacent88} (${pct(stats.episodesEverAdjacent88, totalEpisodes)}%)`
  );
  console.log(
    `    final board one8+one7: ${stats.episodesFinalOne8AndOne7} (${pct(stats.episodesFinalOne8AndOne7, totalEpisodes)}%)`
  );
  console.log(
    `    final adjacent 7+7: ${stats.episodesFinalAdjacent77} (${pct(stats.episodesFinalAdjacent77, totalEpisodes)}%)`
  );
  console.log(
    `    final adjacent 8+7: ${stats.episodesFinalAdjacent87} (${pct(stats.episodesFinalAdjacent87, totalEpisodes)}%)`
  );
  console.log(
    `    final adjacent 8+8: ${stats.episodesFinalAdjacent88} (${pct(stats.episodesFinalAdjacent88, totalEpisodes)}%)`
  );
  console.log("    --- merge timing ---");
  console.log(
    `    ever immediate merge7: ${stats.episodesEverImmediateMerge7} (${pct(stats.episodesEverImmediateMerge7, totalEpisodes)}%)`
  );
  console.log(
    `    ever immediate merge8: ${stats.episodesEverImmediateMerge8} (${pct(stats.episodesEverImmediateMerge8, totalEpisodes)}%)`
  );
  console.log(
    `    ever adj 7+7 but no imm merge7: ${stats.episodesEverAdjacent77NoImmediate7} (${pct(stats.episodesEverAdjacent77NoImmediate7, totalEpisodes)}%)`
  );
  console.log(
    `    ever adj 8+8 but no imm merge8: ${stats.episodesEverAdjacent88NoImmediate8} (${pct(stats.episodesEverAdjacent88NoImmediate8, totalEpisodes)}%)`
  );
  console.log(
    `    final canMerge7Now: ${stats.episodesFinalCanMerge7Now} (${pct(stats.episodesFinalCanMerge7Now, totalEpisodes)}%)`
  );
  console.log(
    `    final canMerge8Now: ${stats.episodesFinalCanMerge8Now} (${pct(stats.episodesFinalCanMerge8Now, totalEpisodes)}%)`
  );
  console.log(
    `    ever max8+second6 snapshot: ${stats.episodesEverMax8Second6} (${pct(stats.episodesEverMax8Second6, totalEpisodes)}%)`
  );
  console.log(
    `    ever max8+second7 snapshot: ${stats.episodesEverMax8Second7} (${pct(stats.episodesEverMax8Second7, totalEpisodes)}%)`
  );
  console.log("    --- mergePotential(7) / 살아 있는 8+7 ---");
  console.log(
    `    ever mp7>0 while max≥8: ${stats.episodesEverMp7PositiveWhileMaxGte8} (${pct(stats.episodesEverMp7PositiveWhileMaxGte8, totalEpisodes)}%)`
  );
  console.log(
    `    ever max8+second7 & mp7>0: ${stats.episodesEverMax8Second7Mp7Positive} (${pct(stats.episodesEverMax8Second7Mp7Positive, totalEpisodes)}%)`
  );
  console.log(
    `    ever max8+second7 & mp7==0: ${stats.episodesEverMax8Second7Mp7Zero} (${pct(stats.episodesEverMax8Second7Mp7Zero, totalEpisodes)}%)`
  );
  console.log(`    mean peak mergePotential(7): ${stats.meanPeakMergePotential7.toFixed(4)}`);
  console.log(`    mean final mergePotential(7): ${stats.meanFinalMergePotential7.toFixed(4)}`);
  console.log(
    `    peak count(8)≥2 at some turn: ${stats.episodesPeakCount8AtLeast2} (${pct(stats.episodesPeakCount8AtLeast2, totalEpisodes)}%)`
  );
  console.log("    peak count(≥7) distribution:");
  console.log(`      ${rowDist(stats.peakCountGe7Distribution, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])}`);
  console.log(
    "    maxLevelReached: 에피소드 중 한 번이라도 나온 타일의 최고 레벨 (피크)"
  );
  printHistogramRange("histogram", stats.maxLevelDistribution, totalEpisodes, HIST_FOCUS);
  console.log("    finalMaxLevel: 종료 시점 보드에서의 최고 레벨 (승리면 merge 직후 보드)");
  printHistogramRange("histogram", stats.finalMaxLevelDistribution, totalEpisodes, HIST_FOCUS);
  console.log("    finalSecondMaxTile (종료 시점 차선 최대 레벨):");
  console.log(`      ${rowDist(stats.finalSecondMaxDistribution, [0, 1, 2, 3, 4, 5, 6, 7, 8])}`);
  console.log("    peakSecondMaxTile (에피소드 중 secondMax의 최댓값):");
  console.log(`      ${rowDist(stats.peakSecondMaxDistribution, [0, 1, 2, 3, 4, 5, 6, 7, 8])}`);
  console.log("    final count(level==8):");
  console.log(`      ${rowDist(stats.finalCount8Distribution, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])}`);
  console.log("    final count(level>=7):");
  console.log(`      ${rowDist(stats.finalCountGe7Distribution, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])}`);
  const row = (dist: Readonly<Record<number, number>>) =>
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((L) => `L${L}=${dist[L] ?? 0}`).join("  ");
  console.log(`    full maxLevelReached: ${row(stats.maxLevelDistribution)}`);
  console.log(`    full finalMaxLevel:   ${row(stats.finalMaxLevelDistribution)}`);
  console.log("    terminalReasons:");
  for (const k of TERMINAL_REASONS) {
    const c = stats.terminalReasons[k];
    console.log(`      ${k}: ${c} (${pct(c, totalEpisodes)}%)`);
  }
}

console.log(`Monte Carlo (episodes=${n}, seed=${seed}, mode=standard)\n`);
console.log(
  "  정책: selective late 3-ply + scoreBoardV3. 비교 — (1) C  (2) C+78  (3) C+78 + merge timing\n"
);

const policies: { name: string; label: string; p: Policy }[] = [
  { name: "(1) experiment C (best 페널티·rebuild)", label: "C", p: expectimaxPolicySelectiveLate3PlyExperimentC },
  { name: "(2) C + endgame7→8 + ultra late slide", label: "C+78", p: expectimaxPolicySelectiveLate3PlyExperimentCWith78 },
  {
    name: "(3) C+78 + merge timing (즉시 머지)",
    label: "C+78+MT",
    p: expectimaxPolicySelectiveLate3PlyExperimentCWith78MergeTiming,
  },
];

const summaryRows: { label: string; stats: MonteCarloStats }[] = [];

for (const { name, label, p } of policies) {
  console.log(`  ${name}`);
  const stats = runMonteCarlo(p, n, seed, "standard");
  summaryRows.push({ label, stats });
  printMonteCarloStats(stats, n);
  console.log("");
}

type LiteStats = {
  label: string;
  winRate: number;
  avgSteps: number;
  terminalReasons: Record<TerminalReason, number>;
};

function emptyTerminalReasonsLite(): Record<TerminalReason, number> {
  const o = {} as Record<TerminalReason, number>;
  for (const k of TERMINAL_REASONS) o[k] = 0;
  return o;
}

function runMonteCarloFreshPolicy(
  makePolicy: () => Policy,
  episodes: number,
  seed0: number
): LiteStats {
  const rng = createRng(seed0);
  let wins = 0;
  let stepsSum = 0;
  const reasons = emptyTerminalReasonsLite();
  for (let i = 0; i < episodes; i++) {
    const p = makePolicy();
    const r = simulateOne(p, rng, "standard");
    if (r.win) wins++;
    stepsSum += r.steps;
    reasons[r.terminalReason]++;
  }
  return {
    label: "HINT",
    winRate: episodes > 0 ? wins / episodes : 0,
    avgSteps: episodes > 0 ? stepsSum / episodes : 0,
    terminalReasons: reasons,
  };
}

function makeHintPolicyFromGetHint(): Policy {
  // 에피소드(판) 내부에서만 캐시를 유지해 "연속 힌트" 효과를 측정한다.
  const valueCache = new Map<string, number>();
  const leafScoreCache = new Map<string, number>();
  const slidePenaltyCache = new Map<string, number>();
  return (board, actions) => {
    const hint = getHint(board, {
      tuning: experimentCEndgameWith78MergeTiming,
      lateThreshold: 7,
      depthEarly: 5,
      beamWidthEarly: 8,
      depthLate: 9,
      beamWidthLate: 14,
      valueCache,
      leafScoreCache,
      slidePenaltyCache,
    });
    // 안전장치: 혹시라도 illegal이 나오면 actions[0]로 폴백.
    return actions.includes(hint.bestDirection) ? hint.bestDirection : actions[0]!;
  };
}

console.log("  (추가) hint(getHint) 정책 — 에피소드 내부 캐시 재사용\n");
const hintLite = runMonteCarloFreshPolicy(makeHintPolicyFromGetHint, n, seed);
console.log(`  HINT (getHint, tuned like GameScene)`);
console.log(`    winRate: ${(hintLite.winRate * 100).toFixed(4)}%`);
console.log(`    avgSteps: ${hintLite.avgSteps.toFixed(2)}`);
console.log(`    terminalReasons: ${Object.entries(hintLite.terminalReasons).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log("");

printStructureSummaryBlock(summaryRows, n);
console.log(
  "  참고: ever two 8s가 0을 벗어나면, 그때부터 승률·최종 강화 실험을 별도로 진행해도 된다.\n"
);

console.log("단일 에피소드 예시 (C+78, seed=42):");
const one = simulateOne(expectimaxPolicySelectiveLate3PlyExperimentCWith78, createRng(42), "standard");
console.log(
  `  win=${one.win} steps=${one.steps} terminalReason=${one.terminalReason} maxPeak=${one.maxLevelReached} finalMax=${one.finalMaxLevel}`
);
console.log(
  `  final secondMax=${one.finalSecondMaxTile} peak2nd=${one.peakSecondMaxTile} top2Gap=${one.finalTop2Gap} final#8=${one.finalCountTilesEq8} final#≥7=${one.finalCountTilesGe7} peak#8max=${one.peakCount8}`
);
console.log(
  `  ever: two7s=${one.everHadTwoSevensSimultaneous} one8+one7=${one.everHadOne8AndOne7Simultaneous} two8s=${one.everHadTwo8sSimultaneous} max8+sec6=${one.everHadMax8Second6} max8+sec7=${one.everHadMax8Second7}`
);
console.log(
  `  peak count≥7=${one.peakCountGe7} peak top2sum=${one.peakTopTwoSum} final one8+one7=${one.finalHasOne8AndOne7}`
);
console.log(
  `  mp7: peak=${one.peakMergePotential7.toFixed(3)} final=${one.finalMergePotential7.toFixed(3)} mp7+|max≥8=${one.everHadMp7PositiveWhileMaxGte8} 8+7&mp7+=${one.everHadMax8Second7WithMp7Positive} 8+7&mp7=0=${one.everHadMax8Second7WithMp7Zero}`
);

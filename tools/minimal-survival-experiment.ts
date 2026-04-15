/**
 * 최소 생존 목표함수(minimalPolicy) Monte Carlo 실험.
 * 실행: npm run sim:minimal
 */
import { TERMINAL_REASONS } from "../src/sim/types.ts";
import { runMinimalSurvivalMonteCarlo } from "../src/sim/minimalSurvivalMonteCarlo.ts";

const episodes = Number(process.env.MIN_SURV_N ?? "5000");
const seed = Number(process.env.MIN_SURV_SEED ?? "42");

function pct(x: number, total: number): string {
  if (total <= 0) return "0.00";
  return ((x / total) * 100).toFixed(2);
}

function rowDist(dist: Readonly<Record<number, number>>, keys: readonly number[]): string {
  return keys.map((k) => `${k}=${dist[k] ?? 0}`).join("  ");
}

const a = runMinimalSurvivalMonteCarlo(episodes, seed);

console.log("=== 최소 생존 목표 실험 (minimalPolicy + scoreBoardMinimal) ===\n");
console.log(`episodes=${a.episodes}  seed=${a.seed}  mode=standard\n`);

console.log("--- 1) scoreBoardMinimal 구성요소 (코드는 src/sim/minimalSurvival.ts 참고) ---");
console.log("  legal*1000 + empty*300 + mergePairs*400 + survivalNext*500");
console.log("  - 1_000_000 * terminal - 10_000 * nearDead\n");

console.log("--- 2) Monte Carlo 결과 ---\n");
console.log("기본:");
console.log(`  winRate: ${(a.winRate * 100).toFixed(4)}%`);
console.log(`  avgSteps: ${a.avgSteps.toFixed(4)}`);
console.log(`  p50 steps: ${a.p50Steps}`);
console.log(`  p95 steps: ${a.p95Steps}`);
console.log(
  `  terminalReasons: ${TERMINAL_REASONS.map((k) => `${k}=${a.terminalReasons[k]}`).join("  ")}`
);

console.log("\n타일 성장 (에피소드 피크 maxLevel):");
console.log(`  ever max≥6: ${a.episodesEverMaxGe6} (${pct(a.episodesEverMaxGe6, episodes)}%)`);
console.log(`  ever max≥7: ${a.episodesEverMaxGe7} (${pct(a.episodesEverMaxGe7, episodes)}%)`);
console.log(`  ever max≥8: ${a.episodesEverMaxGe8} (${pct(a.episodesEverMaxGe8, episodes)}%)`);
console.log(`  maxLevelReached histogram: ${rowDist(a.maxLevelHistogram, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])}`);
console.log(`  finalMaxLevel histogram:     ${rowDist(a.finalMaxLevelHistogram, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])}`);

console.log("\n생존 지표 (턴 시작 보드 기준, 전 에피소드·전 턴 평균):");
console.log(`  avg legalActionCount: ${a.avgLegal.toFixed(4)}`);
console.log(`  avg emptyCount: ${a.avgEmpty.toFixed(4)}`);
console.log(`  avg immediateMergePairs: ${a.avgMergePairs.toFixed(4)}`);
console.log(`  avg oneStepSurvivalCount: ${a.avgSurvivalNext.toFixed(4)}`);

console.log("\nnear-dead:");
console.log(
  `  episodes with near-dead: ${a.episodesWithNearDead} (${pct(a.episodesWithNearDead, episodes)}%)`
);
console.log(
  `  avg turns after first near-dead until death (no_legal_moves만, 표본=${a.episodesNearDeadDeathSample}): ${a.avgTurnsAfterNearDeadUntilDeath.toFixed(4)}`
);
console.log(
  `  recovery rate (near-dead 경험 후 한 번이라도 안정 보드 복귀 / near-dead 경험 에피소드): ${(a.recoveryRateAmongNearDead * 100).toFixed(2)}%`
);

console.log("\n마지막 10턴 (각 에피소드 마지막 최대 10스냅샷, 전체 평균):");
console.log(`  avg legal: ${a.last10AvgLegal.toFixed(4)}`);
console.log(`  avg empty: ${a.last10AvgEmpty.toFixed(4)}`);
console.log(`  avg merge pairs: ${a.last10AvgMergePairs.toFixed(4)}`);

console.log("\n--- 3) 결과 해석 가이드 (정량 요약) ---\n");

const p95OverP50 = a.p50Steps > 0 ? a.p95Steps / a.p50Steps : 0;
console.log("A. 생존력");
console.log(
  `  - 평균 스텝 ${a.avgSteps.toFixed(1)} / p50=${a.p50Steps} / p95=${a.p95Steps} (p95/p50≈${p95OverP50.toFixed(2)}: 꼬리 두께)`
);
console.log(`  - 승률 ${(a.winRate * 100).toFixed(4)}% (최소 목표만으로 9달성 가능성)`);

console.log("\nB. 타일 성장");
console.log(
  `  - 레벨 6+ 피크 도달 ${pct(a.episodesEverMaxGe6, episodes)}%, 7+ ${pct(a.episodesEverMaxGe7, episodes)}%, 8+ ${pct(a.episodesEverMaxGe8, episodes)}%`
);

console.log("\nC. 죽는 패턴");
console.log(
  `  - near-dead 이후 패망까지 평균 ${a.avgTurnsAfterNearDeadUntilDeath.toFixed(2)}턴(표본 ${a.episodesNearDeadDeathSample}): 한번 위기면 짧게 끝나는지 확인`
);
console.log(
  `  - 마지막 10턴: legal ${a.last10AvgLegal.toFixed(2)}, empty ${a.last10AvgEmpty.toFixed(2)}, merge ${a.last10AvgMergePairs.toFixed(2)} → 말기에 합법 수·빈칸·머지가 동시에 바닥인지`
);

console.log("\nD. 핵심 결론 (이 실험이 말해주는 것)");
console.log(
  "  - 단순 생존 점수만으로도 일정 스텝·일부 고레벨까지는 갈 수 있으나, 승률·8+ 안정성은 기대를 낮게 잡는 편이 안전하다."
);
console.log(
  "  - 추가로 넣을 '최소 정보' 후보: (1) 타일 레벨/최댓값 가중 (2) 머지 후 장기 생존(2~3플라이) (3) near-dead를 넘어선 dead 판별 — 단, 각각은 별도 가설·ablation으로 검증하는 것이 좋다."
);

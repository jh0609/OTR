import type { TerminalReason } from "./types";
import { TERMINAL_REASONS } from "./types";
import { createRng } from "./rng";
import { simulateOneMinimalSurvival } from "./minimalSurvival";

export type MinimalSurvivalAggregate = {
  readonly episodes: number;
  readonly seed: number;
  readonly winRate: number;
  readonly avgSteps: number;
  readonly p50Steps: number;
  readonly p95Steps: number;
  readonly terminalReasons: Readonly<Record<TerminalReason, number>>;
  readonly maxLevelHistogram: Readonly<Record<number, number>>;
  readonly finalMaxLevelHistogram: Readonly<Record<number, number>>;
  readonly avgLegal: number;
  readonly avgEmpty: number;
  readonly avgMergePairs: number;
  readonly avgSurvivalNext: number;
  readonly episodesWithNearDead: number;
  readonly avgTurnsAfterNearDeadUntilDeath: number;
  readonly episodesNearDeadDeathSample: number;
  readonly recoveryRateAmongNearDead: number;
  readonly last10AvgLegal: number;
  readonly last10AvgEmpty: number;
  readonly last10AvgMergePairs: number;
  readonly episodesEverMaxGe6: number;
  readonly episodesEverMaxGe7: number;
  readonly episodesEverMaxGe8: number;
  readonly allStepCounts: readonly number[];
};

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const n = sorted.length;
  const idx = Math.floor((n - 1) * p);
  return sorted[Math.min(n - 1, Math.max(0, idx))]!;
}

function emptyTerminalReasons(): Record<TerminalReason, number> {
  const o = {} as Record<TerminalReason, number>;
  for (const k of TERMINAL_REASONS) o[k] = 0;
  return o;
}

export function runMinimalSurvivalMonteCarlo(episodes: number, seed: number): MinimalSurvivalAggregate {
  const rng = createRng(seed);
  const terminalReasons = emptyTerminalReasons();
  const maxLevelHistogram: Record<number, number> = {};
  const finalMaxLevelHistogram: Record<number, number> = {};

  let wins = 0;
  let sumSteps = 0;
  let sumLegal = 0;
  let sumEmpty = 0;
  let sumMerge = 0;
  let sumSurv = 0;
  let snapshotRows = 0;

  let episodesWithNearDead = 0;
  let sumTurnsAfterNearDead = 0;
  let countNearDeadDeath = 0;
  let nearDeadRecovered = 0;

  let last10SumLegal = 0;
  let last10SumEmpty = 0;
  let last10SumMerge = 0;
  let last10Samples = 0;

  let ever6 = 0;
  let ever7 = 0;
  let ever8 = 0;

  const stepCounts: number[] = [];

  for (let i = 0; i < episodes; i++) {
    const r = simulateOneMinimalSurvival(rng);
    stepCounts.push(r.steps);
    if (r.win) wins++;
    sumSteps += r.steps;
    terminalReasons[r.terminalReason]++;

    maxLevelHistogram[r.maxLevelReached] = (maxLevelHistogram[r.maxLevelReached] ?? 0) + 1;
    finalMaxLevelHistogram[r.finalMaxLevel] = (finalMaxLevelHistogram[r.finalMaxLevel] ?? 0) + 1;

    if (r.maxLevelReached >= 6) ever6++;
    if (r.maxLevelReached >= 7) ever7++;
    if (r.maxLevelReached >= 8) ever8++;

    for (const s of r.snapshots) {
      sumLegal += s.legal;
      sumEmpty += s.empty;
      sumMerge += s.mergePairs;
      sumSurv += s.survivalNext;
      snapshotRows++;
    }

    if (r.hadNearDead) {
      episodesWithNearDead++;
      if (r.recoveredFromNearDead) nearDeadRecovered++;
      if (
        !r.win &&
        r.terminalReason === "no_legal_moves" &&
        r.firstNearDeadTurn !== null &&
        r.turnsAfterNearDeadUntilDeath !== null
      ) {
        sumTurnsAfterNearDead += r.turnsAfterNearDeadUntilDeath;
        countNearDeadDeath++;
      }
    }

    const sn = r.snapshots;
    const n = Math.min(10, sn.length);
    for (let k = sn.length - n; k < sn.length; k++) {
      const t = sn[k]!;
      last10SumLegal += t.legal;
      last10SumEmpty += t.empty;
      last10SumMerge += t.mergePairs;
      last10Samples++;
    }
  }

  const sortedSteps = [...stepCounts].sort((a, b) => a - b);
  const n = episodes;
  const recoveryRateAmongNearDead = episodesWithNearDead > 0 ? nearDeadRecovered / episodesWithNearDead : 0;

  return {
    episodes,
    seed,
    winRate: n > 0 ? wins / n : 0,
    avgSteps: n > 0 ? sumSteps / n : 0,
    p50Steps: percentile(sortedSteps, 0.5),
    p95Steps: percentile(sortedSteps, 0.95),
    terminalReasons,
    maxLevelHistogram,
    finalMaxLevelHistogram,
    avgLegal: snapshotRows > 0 ? sumLegal / snapshotRows : 0,
    avgEmpty: snapshotRows > 0 ? sumEmpty / snapshotRows : 0,
    avgMergePairs: snapshotRows > 0 ? sumMerge / snapshotRows : 0,
    avgSurvivalNext: snapshotRows > 0 ? sumSurv / snapshotRows : 0,
    episodesWithNearDead,
    avgTurnsAfterNearDeadUntilDeath: countNearDeadDeath > 0 ? sumTurnsAfterNearDead / countNearDeadDeath : 0,
    episodesNearDeadDeathSample: countNearDeadDeath,
    recoveryRateAmongNearDead,
    last10AvgLegal: last10Samples > 0 ? last10SumLegal / last10Samples : 0,
    last10AvgEmpty: last10Samples > 0 ? last10SumEmpty / last10Samples : 0,
    last10AvgMergePairs: last10Samples > 0 ? last10SumMerge / last10Samples : 0,
    episodesEverMaxGe6: ever6,
    episodesEverMaxGe7: ever7,
    episodesEverMaxGe8: ever8,
    allStepCounts: sortedSteps,
  };
}

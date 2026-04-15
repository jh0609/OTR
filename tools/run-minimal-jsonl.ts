/**
 * 최소 생존 계측 NDJSON: 에피소드당 1줄 (SIM_MINIMAL_JSONL).
 *
 * P0 random legal, P1 greedyEmpty, P2 minimalPolicy
 *
 * checkpoint A/B: snapshotKind "pre_move" — 턴 시작(슬라이드 직전).
 * checkpoint C/D: snapshotKind "post_turn" — 그 턴 slide+spawn 직후 마지막 max/second 증가 관측.
 *
 * SIM_MINIMAL_N=5000 SIM_MINIMAL_SEED=42 SIM_MINIMAL_JSONL=out/minimal-episodes.jsonl npm run minimal:jsonl
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Policy } from "../src/sim/types.ts";
import { createRng } from "../src/sim/rng.ts";
import { simulateOne } from "../src/sim/simulate.ts";
import { makeRandomPolicy, greedyEmptyPolicy } from "../src/sim/policies.ts";
import { minimalPolicy } from "../src/sim/minimalSurvival.ts";
import { SurvivalEpisodeRecorder } from "../src/sim/survivalEpisodeRecorder.ts";

const n = Math.max(1, Number(process.env.SIM_MINIMAL_N ?? process.env.MIN_SURV_N ?? "500"));
const seed = Number(process.env.SIM_MINIMAL_SEED ?? process.env.MIN_SURV_SEED ?? "42");
const outRaw = process.env.SIM_MINIMAL_JSONL ?? "out/minimal-episodes.jsonl";
const append = process.env.SIM_MINIMAL_APPEND === "1";

const outPath = path.resolve(outRaw);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const fd = fs.openSync(outPath, append ? "a" : "w");

function salt(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return Math.abs(h) % 10000;
}

const policies: readonly { label: string; create: (rng: () => number) => Policy }[] = [
  { label: "P0-random", create: makeRandomPolicy },
  { label: "P1-greedyEmpty", create: () => greedyEmptyPolicy },
  { label: "P2-minimal", create: () => minimalPolicy },
];

console.log(`SIM_MINIMAL_N=${n} SIM_MINIMAL_SEED=${seed}`);
console.log(`SIM_MINIMAL_JSONL=${outPath} append=${append ? 1 : 0}`);

for (const { label, create } of policies) {
  const s = salt(label);
  console.log(`  run ${label}...`);
  for (let episode = 0; episode < n; episode++) {
    const rng = createRng(seed + episode * 100_003 + s);
    const policy = create(rng);
    const survival = new SurvivalEpisodeRecorder();
    const result = simulateOne(policy, rng, "standard", undefined, survival);
    const row = survival.buildRow(label, episode, result);
    fs.writeSync(fd, `${JSON.stringify(row)}\n`);
  }
}

fs.closeSync(fd);
console.log("done.");

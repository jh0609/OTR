/**
 * hasAdjacentPairAtOrAbove6/7 vs firstNoAdj6Turn 교차검증 + C/D 집계 + 재시뮬 트레이스.
 * npx tsx tools/verify-adj-checkpoint.ts
 */
import * as fs from "node:fs";
import type { Board, Direction } from "../src/sim/types.ts";
import { emptyBoard } from "../src/sim/simulate.ts";
import { spawnRandom } from "../src/sim/spawn.ts";
import { slide } from "../src/sim/slide.ts";
import { legalActions } from "../src/sim/legal.ts";
import { minimalPolicy } from "../src/sim/minimalSurvival.ts";
import { createRng } from "../src/sim/rng.ts";
import { extractSurvivalFeatures } from "../src/sim/survivalFeatures.ts";
import { hasAdjacentPair } from "../src/sim/boardStats.ts";
import { maxTileLevel } from "../src/sim/board.ts";

type Cp = {
  maxTile: number;
  hasAdjacentPairAtOrAbove6: boolean;
  hasAdjacentPairAtOrAbove7: boolean;
  boardCells: number[];
  snapshotKind?: string;
};

type Row = {
  policy: string;
  episode: number;
  firstNoAdj6Turn: number | null;
  checkpointA: Cp | null;
  checkpointB: Cp | null;
  checkpointC: Cp | null;
  checkpointD: Cp | null;
};

function salt(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return Math.abs(h) % 10000;
}

function render3x3(c: readonly number[]): string {
  const lines: string[] = [];
  for (let r = 0; r < 3; r++) {
    lines.push(c.slice(r * 3, r * 3 + 3).join(" "));
  }
  return lines.join("\n");
}

function replayMinimal(seed: number, episode: number): {
  steps: number;
  traces: { step: number; adj6plus: boolean; h6: boolean; h7: boolean; h8: boolean; maxT: number; cells: number[] }[];
  firstNoAdj6: number | null;
} {
  const s = salt("P2-minimal");
  const rng = createRng(seed + episode * 100_003 + s);
  let board: Board = emptyBoard();
  board = spawnRandom(board, rng);
  board = spawnRandom(board, rng);
  let prevTurnStart: Board | null = null;
  let steps = 0;
  const traces: { step: number; adj6plus: boolean; h6: boolean; h7: boolean; h8: boolean; maxT: number; cells: number[] }[] =
    [];
  let everHad6 = false;
  let firstNoAdj6: number | null = null;

  while (steps < 500_000) {
    const actions = legalActions(board);
    if (actions.length === 0) break;
    const dir = minimalPolicy(board, actions);
    const f = extractSurvivalFeatures(board, prevTurnStart);
    traces.push({
      step: steps,
      adj6plus: f.hasAdjacentPairAtOrAbove6,
      h6: hasAdjacentPair(board, 6),
      h7: hasAdjacentPair(board, 7),
      h8: hasAdjacentPair(board, 8),
      maxT: maxTileLevel(board),
      cells: [...board],
    });

    if (f.hasAdjacentPairAtOrAbove6) everHad6 = true;
    else if (everHad6 && firstNoAdj6 === null) firstNoAdj6 = steps;

    const boardBeforeSlide = board;
    const { next, moved, win } = slide(board, dir);
    steps++;
    if (win) break;
    if (!moved) break;
    board = spawnRandom(next, rng);
    prevTurnStart = boardBeforeSlide;
  }

  return { steps, traces, firstNoAdj6 };
}

const files = [
  "out/minimal-episodes-seed42.jsonl",
  "out/minimal-episodes-seed43.jsonl",
  "out/minimal-episodes-seed44.jsonl",
  "out/minimal-episodes-seed45.jsonl",
];

const rows: Row[] = [];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").trim().split("\n")) {
    if (!line) continue;
    rows.push(JSON.parse(line) as Row);
  }
}

function rate(pred: (r: Row) => Cp | null | undefined): { n: number; t: number } {
  let n = 0;
  let t = 0;
  for (const r of rows) {
    const c = pred(r);
    if (!c) continue;
    n++;
    if (c.hasAdjacentPairAtOrAbove6) t++;
  }
  return { n, t };
}

console.log("=== checkpoint hasAdjacentPairAtOrAbove6 true 비율 (전체 파일 합산) ===");
for (const label of ["checkpointA", "checkpointB", "checkpointC", "checkpointD"] as const) {
  const { n, t } = rate((r) => r[label]);
  console.log(
    `${label}: n=${n} true=${t} (${n ? ((100 * t) / n).toFixed(4) : "n/a"}%)`
  );
}
const policies = ["P0-random", "P1-greedyEmpty", "P2-minimal"] as const;
console.log("\n--- 정책별 adj6 true (A/B/C/D) ---");
for (const pol of policies) {
  const sub = rows.filter((r) => r.policy === pol);
  const line: string[] = [pol];
  for (const ck of ["checkpointA", "checkpointB", "checkpointC", "checkpointD"] as const) {
    let n = 0;
    let tr = 0;
    for (const r of sub) {
      const c = r[ck];
      if (!c) continue;
      n++;
      if (c.hasAdjacentPairAtOrAbove6) tr++;
    }
    line.push(`${ck}:${n ? tr + "/" + n : "0/0"}`);
  }
  console.log(line.join(" | "));
}
const { n: n7a, t: t7a } = {
  n: rows.filter((r) => r.checkpointA).length,
  t: rows.filter((r) => r.checkpointA?.hasAdjacentPairAtOrAbove7).length,
};
console.log(
  "checkpointA hasAdjacentPairAtOrAbove7:",
  t7a,
  "/",
  n7a,
  "(",
  n7a ? ((100 * t7a) / n7a).toFixed(4) : "n/a",
  "%)"
);

console.log("\n=== 샘플 타입2: checkpointB maxTile>=6 이고 hasAdjacentPairAtOrAbove6==false (최대 5) ===");
let t2 = 0;
for (const r of rows) {
  const b = r.checkpointB;
  if (!b || b.maxTile < 6 || b.hasAdjacentPairAtOrAbove6) continue;
  t2++;
  console.log(
    `\n#${t2} policy=${r.policy} ep=${r.episode} maxTile=${b.maxTile} adj6=${b.hasAdjacentPairAtOrAbove6}`
  );
  console.log(render3x3(b.boardCells));
  if (t2 >= 5) break;
}

console.log("\n=== 샘플 타입3: 아무 checkpoint나 hasAdjacentPairAtOrAbove6==true (최대 5) ===");
let t3 = 0;
for (const r of rows) {
  for (const key of ["checkpointA", "checkpointB", "checkpointC", "checkpointD"] as const) {
    const c = r[key];
    if (!c?.hasAdjacentPairAtOrAbove6) continue;
    t3++;
    console.log(`\n#${t3} ${key} policy=${r.policy} ep=${r.episode} maxTile=${c.maxTile}`);
    console.log(render3x3(c.boardCells));
    if (t3 >= 5) break;
  }
  if (t3 >= 5) break;
}
if (t3 === 0) console.log("(없음)");

console.log("\n=== 샘플 타입1: P2 + firstNoAdj6Turn non-null, seed42에서 5개 재시뮬 트레이스 ===");
const seed42rows = fs
  .readFileSync("out/minimal-episodes-seed42.jsonl", "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Row)
  .filter((r) => r.policy === "P2-minimal" && r.firstNoAdj6Turn !== null)
  .slice(0, 5);

for (const r of seed42rows) {
  const ep = r.episode;
  const want = r.firstNoAdj6Turn;
  const rep = replayMinimal(42, ep);
  console.log(
    `\nepisode=${ep} JSON firstNoAdj6=${want} replay firstNoAdj6=${rep.firstNoAdj6} steps=${rep.steps}`
  );
  const lo = Math.max(0, (want ?? 0) - 1);
  const hi = Math.min(rep.traces.length - 1, (want ?? 0) + 1);
  for (let i = lo; i <= hi; i++) {
    const tr = rep.traces[i]!;
    console.log(
      `  step=${tr.step} max=${tr.maxT} adj6+=${tr.adj6plus} | pair(6)=${tr.h6} pair(7)=${tr.h7} pair(8)=${tr.h8}`
    );
    console.log(render3x3(tr.cells));
  }
}

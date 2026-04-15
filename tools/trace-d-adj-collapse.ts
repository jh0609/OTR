/**
 * checkpointD(adj6/7) 직후 한 턴 전이: simulateOne과 동일 루프, RNG 동기화 위해 2-pass.
 * npx tsx tools/trace-d-adj-collapse.ts
 */
import * as fs from "node:fs";
import type { Board, Policy } from "../src/sim/types.ts";
import { spawnRandom } from "../src/sim/spawn.ts";
import { slide } from "../src/sim/slide.ts";
import { legalActions } from "../src/sim/legal.ts";
import { createRng } from "../src/sim/rng.ts";
import { makeRandomPolicy, greedyEmptyPolicy } from "../src/sim/policies.ts";
import { minimalPolicy } from "../src/sim/minimalSurvival.ts";
import { extractSurvivalFeatures } from "../src/sim/survivalFeatures.ts";
import { secondMaxTile } from "../src/sim/boardStats.ts";
import { maxTileLevel } from "../src/sim/board.ts";
import { emptyBoard } from "../src/sim/simulate.ts";

type Cp = {
  turn: number;
  boardCells: number[];
  chosenAction: string;
  emptyCount: number;
  immediateMergeCount: number;
  oneStepSurvivalCount: number;
  maxTileGap: number;
  hasAdjacentPairAtOrAbove6: boolean;
  hasAdjacentPairAtOrAbove7: boolean;
};

type Row = {
  policy: string;
  episode: number;
  checkpointD: Cp | null;
};

function salt(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return Math.abs(h) % 10000;
}

function policyFor(label: string, rng: () => number): Policy {
  if (label === "P0-random") return makeRandomPolicy(rng);
  if (label === "P1-greedyEmpty") return greedyEmptyPolicy;
  return minimalPolicy;
}

function initialBoard(rng: () => number): Board {
  let b = emptyBoard();
  b = spawnRandom(b, rng);
  b = spawnRandom(b, rng);
  return b;
}

function sameCells(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < 9; i++) if (a[i] !== b[i]) return false;
  return true;
}

function adj6(board: Board): boolean {
  return extractSurvivalFeatures(board, null).hasAdjacentPairAtOrAbove6;
}

function adj7(board: Board): boolean {
  return extractSurvivalFeatures(board, null).hasAdjacentPairAtOrAbove7;
}

type CollapseKind =
  | "A_merge_slide"
  | "B_separate_slide"
  | "C_spawn_only"
  | "D_persist_one_turn"
  | "E_other";

function classifyFromAdj6(
  bD: Board,
  afterSlide: Board,
  afterSpawn: Board
): CollapseKind {
  const had = adj6(bD);
  if (!had) return "E_other";
  const a6s = adj6(afterSlide);
  const a6p = adj6(afterSpawn);
  if (!a6s) {
    if (maxTileLevel(afterSlide) > maxTileLevel(bD)) return "A_merge_slide";
    return "B_separate_slide";
  }
  if (!a6p) return "C_spawn_only";
  return "D_persist_one_turn";
}

type Stats = { empty: number[]; imm: number[]; oss: number[]; gap: number[] };

function push(s: Stats, d: Cp) {
  s.empty.push(d.emptyCount);
  s.imm.push(d.immediateMergeCount);
  s.oss.push(d.oneStepSurvivalCount);
  s.gap.push(d.maxTileGap);
}

function mean(a: number[]): string {
  if (!a.length) return "n/a";
  return (a.reduce((x, y) => x + y, 0) / a.length).toFixed(3);
}

function render(b: Board): string {
  const o: string[] = [];
  for (let r = 0; r < 3; r++) o.push([b[r * 3], b[r * 3 + 1], b[r * 3 + 2]].join(" "));
  return o.join("\n");
}

type LastSm = { turn: number; board: Board };

function replayFinalSecondMaxSnap(
  seed: number,
  episode: number,
  policyLabel: string
): LastSm | null {
  const rng = createRng(seed + episode * 100_003 + salt(policyLabel));
  const policy = policyFor(policyLabel, rng);
  let board: Board = initialBoard(rng);
  let steps = 0;
  let lastSm: LastSm | null = null;

  while (steps < 500_000) {
    const actions = legalActions(board);
    if (actions.length === 0) break;
    const boardBeforeSlide = board;
    const dir = policy(board, actions);
    const { next, moved, win } = slide(board, dir);
    if (win) break;
    if (!moved) break;
    steps++;
    board = spawnRandom(next, rng);
    const sm0 = secondMaxTile(boardBeforeSlide);
    const sm1 = secondMaxTile(board);
    if (sm1 > sm0) lastSm = { turn: steps, board: board.slice() as Board };
  }
  return lastSm;
}

function replayUntilTurnBoardThenOneTurn(
  seed: number,
  episode: number,
  policyLabel: string,
  targetTurn: number,
  targetBoard: readonly number[]
): { bD: Board; dir: string; afterSlide: Board; afterSpawn: Board } | null {
  const rng = createRng(seed + episode * 100_003 + salt(policyLabel));
  const policy = policyFor(policyLabel, rng);
  let board: Board = initialBoard(rng);
  let steps = 0;

  while (steps < 500_000) {
    const actions = legalActions(board);
    if (actions.length === 0) return null;
    const boardBeforeSlide = board;
    const dir = policy(board, actions);
    const { next, moved, win } = slide(board, dir);
    if (win) return null;
    if (!moved) return null;
    steps++;
    board = spawnRandom(next, rng);
    const sm0 = secondMaxTile(boardBeforeSlide);
    const sm1 = secondMaxTile(board);
    if (sm1 > sm0 && steps === targetTurn && sameCells(board, targetBoard)) {
      const bD = board.slice() as Board;
      const actions2 = legalActions(bD);
      const dir2 = policy(bD, actions2);
      const { next: ns, moved: mv2 } = slide(bD, dir2);
      if (!mv2) return null;
      const afterSlide = ns;
      const afterSpawn = spawnRandom(ns, rng);
      return { bD, dir: dir2, afterSlide, afterSpawn };
    }
  }
  return null;
}

const files: { path: string; seed: number }[] = [
  { path: "out/minimal-episodes-seed42.jsonl", seed: 42 },
  { path: "out/minimal-episodes-seed43.jsonl", seed: 43 },
  { path: "out/minimal-episodes-seed44.jsonl", seed: 44 },
  { path: "out/minimal-episodes-seed45.jsonl", seed: 45 },
];

const targets: { row: Row; seed: number }[] = [];
for (const { path: fp, seed } of files) {
  if (!fs.existsSync(fp)) continue;
  for (const line of fs.readFileSync(fp, "utf8").trim().split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line) as Row;
    const d = r.checkpointD;
    if (!d?.hasAdjacentPairAtOrAbove6 && !d?.hasAdjacentPairAtOrAbove7) continue;
    targets.push({ row: r, seed });
  }
}

const counts: Record<CollapseKind, number> = {
  A_merge_slide: 0,
  B_separate_slide: 0,
  C_spawn_only: 0,
  D_persist_one_turn: 0,
  E_other: 0,
};

const byKind: Record<CollapseKind, Stats> = {
  A_merge_slide: { empty: [], imm: [], oss: [], gap: [] },
  B_separate_slide: { empty: [], imm: [], oss: [], gap: [] },
  C_spawn_only: { empty: [], imm: [], oss: [], gap: [] },
  D_persist_one_turn: { empty: [], imm: [], oss: [], gap: [] },
  E_other: { empty: [], imm: [], oss: [], gap: [] },
};

const anchorByKind: Record<CollapseKind, { n: number; slideTrue: number; spawnTrue: number }> = {
  A_merge_slide: { n: 0, slideTrue: 0, spawnTrue: 0 },
  B_separate_slide: { n: 0, slideTrue: 0, spawnTrue: 0 },
  C_spawn_only: { n: 0, slideTrue: 0, spawnTrue: 0 },
  D_persist_one_turn: { n: 0, slideTrue: 0, spawnTrue: 0 },
  E_other: { n: 0, slideTrue: 0, spawnTrue: 0 },
};

const samples: string[] = [];
let matched = 0;
let mismatch = 0;

console.log(
  "[정의] hasAdjacentPairAtOrAbove6/7는 extractSurvivalFeatures의 board만 사용 → D의 boardCells와 **바로 다음 recordPreSlide의 board**는 동일해야 한다.\n"
);

for (const { row: r, seed } of targets) {
  const d = r.checkpointD!;
  const fin = replayFinalSecondMaxSnap(seed, r.episode, r.policy);
  if (!fin || fin.turn !== d.turn || !sameCells(fin.board, d.boardCells)) {
    mismatch++;
    continue;
  }
  matched++;
  const one = replayUntilTurnBoardThenOneTurn(seed, r.episode, r.policy, d.turn, d.boardCells);
  if (!one) {
    counts.E_other++;
    push(byKind.E_other, d);
    continue;
  }
  const kind = classifyFromAdj6(one.bD, one.afterSlide, one.afterSpawn);
  counts[kind]++;
  push(byKind[kind], d);

  const anchorSlide = extractSurvivalFeatures(one.afterSlide, one.bD).maxTileAnchorShifted;
  const anchorSpawn = extractSurvivalFeatures(one.afterSpawn, one.bD).maxTileAnchorShifted;
  anchorByKind[kind].slideTrue += anchorSlide ? 1 : 0;
  anchorByKind[kind].spawnTrue += anchorSpawn ? 1 : 0;
  anchorByKind[kind].n += 1;

  if (samples.length < 20) {
    const a6D = adj6(one.bD);
    const a6s = adj6(one.afterSlide);
    const a6p = adj6(one.afterSpawn);
    samples.push(
      [
        `--- #${samples.length + 1} ${r.policy} ep=${r.episode} kind=${kind} ---`,
        `D.turn=${d.turn} nextDir=${one.dir}`,
        `anchorShift D→slide=${anchorSlide} D→spawn=${anchorSpawn}`,
        `adj6: D=${a6D} afterSlide=${a6s} afterSpawn=${a6p} | max D/slide/spawn=${maxTileLevel(one.bD)}/${maxTileLevel(one.afterSlide)}/${maxTileLevel(one.afterSpawn)}`,
        `D:\n${render(one.bD)}`,
        `afterSlide:\n${render(one.afterSlide)}`,
        `afterSpawn:\n${render(one.afterSpawn)}`,
        `D metrics: empty=${d.emptyCount} imm=${d.immediateMergeCount} oss=${d.oneStepSurvivalCount} gap=${d.maxTileGap}`,
      ].join("\n")
    );
  }
}

console.log(`JSON에서 D.adj6||adj7 true인 행: ${targets.length}`);
console.log(`최종 second-max 증가 스냅 == JSON D (turn+cells): ${matched}, 불일치: ${mismatch}`);
console.log(`(다음 턴 시작 보드 == D 보드는 시뮬 루프상 동일, 별도 RNG 없이 셀 비교만으로 성립)\n`);

const total = matched || 1;
console.log("=== D 직후 **한 턴**(slide→spawn) 뒤 adj6 붕괴 유형 ===");
for (const k of Object.keys(counts) as CollapseKind[]) {
  console.log(`${k}: ${counts[k]} (${((100 * counts[k]) / total).toFixed(2)}%)`);
}

console.log("\n=== 유형별 D 시점 평균 (checkpointD 필드) ===");
for (const k of Object.keys(byKind) as CollapseKind[]) {
  const s = byKind[k];
  if (!s.empty.length) {
    console.log(`${k}: (표본 없음)`);
    continue;
  }
  console.log(
    `${k} (n=${s.empty.length}): empty=${mean(s.empty)} imm=${mean(s.imm)} oss=${mean(s.oss)} gap=${mean(s.gap)}`
  );
}

console.log(
  "\n=== 유형별 maxTileAnchorShifted (D→afterSlide / D→afterSpawn, 동일 max 레벨일 때 max 칸 집합 변화) ==="
);
for (const k of Object.keys(anchorByKind) as CollapseKind[]) {
  const a = anchorByKind[k];
  if (!a.n) {
    console.log(`${k}: (표본 없음)`);
    continue;
  }
  console.log(
    `${k}: slide에서 anchorShift=${a.slideTrue}/${a.n} (${((100 * a.slideTrue) / a.n).toFixed(1)}%), spawn 후=${a.spawnTrue}/${a.n} (${((100 * a.spawnTrue) / a.n).toFixed(1)}%)`
  );
}

console.log("\n=== 보드 전이 샘플 (최대 20) ===\n" + samples.join("\n\n"));

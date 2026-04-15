/**
 * tail NDJSON(SIM_TAIL_JSONL) 전체 오프라인 분석.
 *
 * 사용: npx tsx tools/analyze-tail-jsonl.ts [path.jsonl] [--out report.txt]
 * 기본 입력: out/tail-moves-full.jsonl
 * --out 지정 시 UTF-8로만 저장(콘솔 인코딩과 무관).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

import { countMergePairs } from "../src/sim/scoring.ts";
import type { Board } from "../src/sim/types.ts";

type TailRow = {
  policy: string;
  seed: number;
  episode: number;
  episodeSteps?: number;
  win?: boolean;
  terminalReason?: string;
  movesFromEnd: number;
  legalCount?: number;
  emptyCount: number;
  maxLevel: number;
  secondMax: number;
  mergePairs: number;
  mp7?: number;
  maxAtAnyCorner?: number;
  chosenDirection?: string;
  boardCells: number[];
};

const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [3, 4],
  [4, 5],
  [6, 7],
  [7, 8],
  [0, 3],
  [1, 4],
  [2, 5],
  [3, 6],
  [4, 7],
  [5, 8],
];

const MFE_DIM = 10;

function adjSameLevel(board: readonly number[], level: number): boolean {
  for (const [a, b] of EDGES) {
    if (board[a] === level && board[b] === level) return true;
  }
  return false;
}

function pos(i: number): readonly [number, number] {
  return [Math.floor(i / 3), i % 3] as const;
}

function minManhattanSameMax(board: readonly number[], maxLevel: number): number | null {
  const idx: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] === maxLevel) idx.push(i);
  }
  if (idx.length < 2) return null;
  let best = 99;
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const [r1, c1] = pos(idx[a]!);
      const [r2, c2] = pos(idx[b]!);
      best = Math.min(best, Math.abs(r1 - r2) + Math.abs(c1 - c2));
    }
  }
  return best;
}

function adjacentEqualMergeEdges(board: readonly number[]): { level: number; a: number; b: number }[] {
  const out: { level: number; a: number; b: number }[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const v = board[i]!;
      if (v === 0) continue;
      if (c < 2) {
        const j = i + 1;
        if (board[j] === v) out.push({ level: v, a: i, b: j });
      }
      if (r < 2) {
        const j = i + 3;
        if (board[j] === v) out.push({ level: v, a: i, b: j });
      }
    }
  }
  return out;
}

type Bucket = {
  n: number;
  empty0: number;
  adjMax: number;
  adjSecond: number;
  twoPlusMax: number;
  dist1: number;
  dist2: number;
  dist3p: number;
  deadish: number;
  mp1: number;
  mp1High: number;
};

function freshBucket(): Bucket {
  return {
    n: 0,
    empty0: 0,
    adjMax: 0,
    adjSecond: 0,
    twoPlusMax: 0,
    dist1: 0,
    dist2: 0,
    dist3p: 0,
    deadish: 0,
    mp1: 0,
    mp1High: 0,
  };
}

type MfeSums = {
  n: number[];
  legal: number[];
  empty: number[];
  merge: number[];
  mp7: number[];
  corner: number[];
};

function freshMfeSums(): MfeSums {
  return {
    n: Array(MFE_DIM).fill(0),
    legal: Array(MFE_DIM).fill(0),
    empty: Array(MFE_DIM).fill(0),
    merge: Array(MFE_DIM).fill(0),
    mp7: Array(MFE_DIM).fill(0),
    corner: Array(MFE_DIM).fill(0),
  };
}

function addMfeSums(s: MfeSums, mfe: number, row: TailRow): void {
  const i = mfe - 1;
  s.n[i]!++;
  s.legal[i]! += row.legalCount ?? 0;
  s.empty[i]! += row.emptyCount;
  s.merge[i]! += row.mergePairs;
  s.mp7[i]! += row.mp7 ?? 0;
  s.corner[i]! += row.maxAtAnyCorner ?? 0;
}

function addToBucket(b: Bucket, row: TailRow): void {
  const board = row.boardCells;
  b.n++;
  if (row.emptyCount === 0) b.empty0++;
  if (adjSameLevel(board, row.maxLevel)) b.adjMax++;
  if (adjSameLevel(board, row.secondMax)) b.adjSecond++;
  const d = minManhattanSameMax(board, row.maxLevel);
  if (d !== null) {
    b.twoPlusMax++;
    if (d === 1) b.dist1++;
    else if (d === 2) b.dist2++;
    else b.dist3p++;
  }
  if (row.emptyCount === 0 && row.mergePairs <= 1 && !adjSameLevel(board, row.maxLevel)) {
    b.deadish++;
  }
  if (row.mergePairs === 1) {
    b.mp1++;
    const edges = adjacentEqualMergeEdges(board);
    const recomputed = countMergePairs(board as Board);
    if (edges.length === 1 && recomputed === 1) {
      if (edges[0]!.level >= 6) b.mp1High++;
    }
  }
}

function pct(num: number, den: number): string {
  if (den === 0) return "n/a";
  return ((100 * num) / den).toFixed(1);
}

function inc(m: Map<string, number>, k: string, d = 1): void {
  m.set(k, (m.get(k) ?? 0) + d);
}

type LogFn = (s: string) => void;

function printMfeTable(log: LogFn, title: string, buckets: Bucket[]): void {
  log(`\n=== ${title} (connectivity / deadish) ===`);
  log(
    "mfe | n    | e0%  | adj(max)% | adj(2nd)% | max:dist1% | dist2% | dist>=3% | deadish% | mp=1: high6+%"
  );
  for (let mfe = MFE_DIM; mfe >= 1; mfe--) {
    const x = buckets[mfe - 1]!;
    if (x.n === 0) continue;
    const sub = x.twoPlusMax;
    const mp1d = x.mp1 > 0 ? pct(x.mp1High, x.mp1) : "n/a";
    log(
      `${String(mfe).padStart(2)}  | ${String(x.n).padStart(4)} | ${pct(x.empty0, x.n).padStart(4)} | ${pct(x.adjMax, x.n).padStart(9)} | ${pct(x.adjSecond, x.n).padStart(9)} | ${pct(x.dist1, sub).padStart(10)} | ${pct(x.dist2, sub).padStart(6)} | ${pct(x.dist3p, sub).padStart(8)} | ${pct(x.deadish, x.n).padStart(8)} | ${mp1d.padStart(14)}`
    );
  }
}

function printMfeAverages(log: LogFn, title: string, s: MfeSums): void {
  log(`\n=== ${title} (평균 지표) ===`);
  log("mfe | n    | avgLegal | avgEmpty | avgMergePairs | avgMp7 | maxCorner%");
  for (let mfe = MFE_DIM; mfe >= 1; mfe--) {
    const i = mfe - 1;
    const n = s.n[i]!;
    if (n === 0) continue;
    const al = (s.legal[i]! / n).toFixed(2);
    const ae = (s.empty[i]! / n).toFixed(2);
    const am = (s.merge[i]! / n).toFixed(2);
    const amp = (s.mp7[i]! / n).toFixed(3);
    const ac = pct(s.corner[i]!, n);
    log(
      `${String(mfe).padStart(2)}  | ${String(n).padStart(4)} | ${al.padStart(8)} | ${ae.padStart(8)} | ${am.padStart(13)} | ${amp.padStart(6)} | ${ac.padStart(10)}`
    );
  }
}

function printHist(
  log: LogFn,
  title: string,
  m: Map<string, number>,
  total: number,
  sort: "key" | "count" = "key",
  maxRows = 9999
): void {
  log(`\n=== ${title} ===`);
  if (total === 0) {
    log("  (표본 없음)");
    return;
  }
  const entries = [...m.entries()];
  if (sort === "count") entries.sort((a, b) => b[1] - a[1]);
  else entries.sort((a, b) => a[0].localeCompare(b[0]));
  let shown = 0;
  for (const [k, c] of entries) {
    if (shown++ >= maxRows) {
      log(`  ... 외 ${entries.length - maxRows}개 키 생략`);
      break;
    }
    log(`  ${k}: ${c} (${pct(c, total)}%)`);
  }
}

function parseArgs(argv: string[]): { inputPath: string; outPath: string | undefined } {
  let rest = argv.slice(2).filter((a) => a !== "--");
  if (rest[0]?.endsWith(".ts")) rest = rest.slice(1);
  let outPath: string | undefined;
  const filtered: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out" && rest[i + 1]) {
      outPath = rest[i + 1];
      i++;
      continue;
    }
    filtered.push(rest[i]!);
  }
  const inputPath = filtered[0] ?? "out/tail-moves-full.jsonl";
  return { inputPath, outPath };
}

async function main(): Promise<void> {
  const { inputPath, outPath } = parseArgs(process.argv);
  if (!fs.existsSync(inputPath)) {
    console.error(`파일 없음: ${inputPath}`);
    process.exit(1);
  }

  const chunks: string[] = [];
  const log: LogFn = (s: string) => {
    chunks.push(s, "\n");
    if (!outPath) console.log(s);
  };

  const globalBuckets: Bucket[] = Array.from({ length: MFE_DIM }, () => freshBucket());
  const byPolicyBuckets = new Map<string, Bucket[]>();
  const globalSums = freshMfeSums();
  const byPolicySums = new Map<string, MfeSums>();

  const histMp1Level = new Map<number, number>();
  const histMp1LevelEmpty0 = new Map<number, number>();
  let mp1Mismatch = 0;
  let lines = 0;

  type Ep = { win: boolean; terminal: string; steps: number };
  const epFirst = new Map<string, Ep>();

  const mfe1Legal = new Map<string, number>();
  const mfe1Merge = new Map<string, number>();
  const mfe1Dir = new Map<string, number>();
  const mfe1Mp7b = new Map<string, number>();
  const mfe1MaxSecond = new Map<string, number>();
  const mfe1EmptyMerge = new Map<string, number>();
  const mfe1ByPolicy = new Map<
    string,
    {
      legal: Map<string, number>;
      merge: Map<string, number>;
      dir: Map<string, number>;
      mp7b: Map<string, number>;
      maxSecond: Map<string, number>;
      emptyMerge: Map<string, number>;
    }
  >();

  function policyMfe1Maps(p: string) {
    let o = mfe1ByPolicy.get(p);
    if (!o) {
      o = {
        legal: new Map(),
        merge: new Map(),
        dir: new Map(),
        mp7b: new Map(),
        maxSecond: new Map(),
        emptyMerge: new Map(),
      };
      mfe1ByPolicy.set(p, o);
    }
    return o;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    lines++;
    let row: TailRow;
    try {
      row = JSON.parse(t) as TailRow;
    } catch {
      console.error(`JSON 파싱 실패 near line ${lines}`);
      continue;
    }
    const mfe = row.movesFromEnd;
    if (mfe < 1 || mfe > MFE_DIM) continue;

    addToBucket(globalBuckets[mfe - 1]!, row);
    addMfeSums(globalSums, mfe, row);

    let polBuckets = byPolicyBuckets.get(row.policy);
    if (!polBuckets) {
      polBuckets = Array.from({ length: MFE_DIM }, () => freshBucket());
      byPolicyBuckets.set(row.policy, polBuckets);
    }
    addToBucket(polBuckets[mfe - 1]!, row);

    let polSums = byPolicySums.get(row.policy);
    if (!polSums) {
      polSums = freshMfeSums();
      byPolicySums.set(row.policy, polSums);
    }
    addMfeSums(polSums, mfe, row);

    const ek = `${row.policy}\t${row.episode}`;
    if (!epFirst.has(ek)) {
      epFirst.set(ek, {
        win: row.win ?? false,
        terminal: row.terminalReason ?? "?",
        steps: row.episodeSteps ?? 0,
      });
    }

    if (mfe === 1) {
      const lc = String(row.legalCount ?? -1);
      const mc = String(Math.min(row.mergePairs, 5));
      const dr = row.chosenDirection ?? "?";
      const mp = row.mp7 ?? 0;
      const mpB =
        mp < 0.5 ? "<0.5" : mp < 1 ? "0.5-1" : mp < 2 ? "1-2" : ">=2";
      const ms = `${row.maxLevel},${row.secondMax}`;
      const em = `e${row.emptyCount}_mp${row.mergePairs}`;

      inc(mfe1Legal, lc);
      inc(mfe1Merge, mc);
      inc(mfe1Dir, dr);
      inc(mfe1Mp7b, mpB);
      inc(mfe1MaxSecond, ms);
      inc(mfe1EmptyMerge, em);

      const pm = policyMfe1Maps(row.policy);
      inc(pm.legal, lc);
      inc(pm.merge, mc);
      inc(pm.dir, dr);
      inc(pm.mp7b, mpB);
      inc(pm.maxSecond, ms);
      inc(pm.emptyMerge, em);
    }

    if (row.mergePairs === 1) {
      const edges = adjacentEqualMergeEdges(row.boardCells);
      const rc = countMergePairs(row.boardCells as Board);
      if (edges.length !== 1 || rc !== 1) {
        mp1Mismatch++;
      } else {
        const lv = edges[0]!.level;
        histMp1Level.set(lv, (histMp1Level.get(lv) ?? 0) + 1);
        if (row.emptyCount === 0) {
          histMp1LevelEmpty0.set(lv, (histMp1LevelEmpty0.get(lv) ?? 0) + 1);
        }
      }
    }
  }

  const policies = [...byPolicyBuckets.keys()].sort();
  const nEpisodesPerPolicy = policies.length > 0 ? lines / policies.length / MFE_DIM : 0;

  log("========== tail NDJSON full report ==========");
  log(`파일: ${inputPath}`);
  log(`총 스냅샷 줄: ${lines}`);
  log(`정책: ${policies.join(", ")}`);
  log(
    `(참고) 에피소드당 tail 최대 ${MFE_DIM}스냅이면 정책당 약 ${nEpisodesPerPolicy.toFixed(0)} 에피소드 상당`
  );
  if (mp1Mismatch > 0) {
    log(`(참고) mergePairs==1 인데 유일 인접쌍 재검증 불일치 행: ${mp1Mismatch}`);
  }

  log("\n=== 에피소드 단위 요약 (각 policy×episode 첫 등장 기준) ===");
  for (const pol of policies) {
    let n = 0;
    let wins = 0;
    const term = new Map<string, number>();
    let sumSteps = 0;
    for (const [k, v] of epFirst) {
      if (!k.startsWith(`${pol}\t`)) continue;
      n++;
      if (v.win) wins++;
      inc(term, v.terminal);
      sumSteps += v.steps;
    }
    log(
      `  [${pol}] 에피소드 ${n}, 승률 ${pct(wins, n)}%, 평균 길이(steps) ${n ? (sumSteps / n).toFixed(2) : "n/a"}`
    );
    const tentries = [...term.entries()].sort((a, b) => b[1] - a[1]);
    for (const [tr, c] of tentries) {
      log(`      terminal ${tr}: ${c} (${pct(c, n)}%)`);
    }
  }

  printMfeAverages(log, "전체", globalSums);
  printMfeTable(log, "전체", globalBuckets);

  for (const pol of policies) {
    printMfeAverages(log, `정책 ${pol}`, byPolicySums.get(pol)!);
    printMfeTable(log, `정책 ${pol}`, byPolicyBuckets.get(pol)!);
  }

  const mfe1Total = globalSums.n[0] ?? 0;
  printHist(log, "movesFromEnd=1: legalCount 분포 (전체)", mfe1Legal, mfe1Total, "key");
  printHist(log, "movesFromEnd=1: mergePairs (5+=버킷 '5')", mfe1Merge, mfe1Total, "key");
  printHist(log, "movesFromEnd=1: chosenDirection (전체)", mfe1Dir, mfe1Total, "count");
  printHist(log, "movesFromEnd=1: mp7 구간 (전체)", mfe1Mp7b, mfe1Total, "key");
  printHist(log, "movesFromEnd=1: (maxLevel,secondMax) 상위 20", mfe1MaxSecond, mfe1Total, "count", 20);
  printHist(log, "movesFromEnd=1: empty_mergePairs 상위 24", mfe1EmptyMerge, mfe1Total, "count", 24);

  for (const pol of policies) {
    const pm = mfe1ByPolicy.get(pol);
    if (!pm) continue;
    const subN = byPolicySums.get(pol)?.n[0] ?? 0;
    printHist(log, `mfe=1 legalCount [${pol}]`, pm.legal, subN, "key");
    printHist(log, `mfe=1 mergePairs [${pol}]`, pm.merge, subN, "key");
    printHist(log, `mfe=1 chosenDirection [${pol}]`, pm.dir, subN, "count");
  }

  log("\n=== mergePairs==1 일 때 유일 인접 동일값 쌍의 레벨 (전체) ===");
  const levels = [...histMp1Level.keys()].sort((a, b) => a - b);
  let sum = 0;
  for (const lv of levels) sum += histMp1Level.get(lv)!;
  for (const lv of levels) {
    const c = histMp1Level.get(lv)!;
    log(`  level ${lv}: ${c} (${pct(c, sum)}%)`);
  }

  log("\n=== mergePairs==1 & emptyCount==0 레벨 분포 ===");
  const levels0 = [...histMp1LevelEmpty0.keys()].sort((a, b) => a - b);
  let sum0 = 0;
  for (const lv of levels0) sum0 += histMp1LevelEmpty0.get(lv)!;
  if (sum0 === 0) log("  (표본 없음)");
  else {
    for (const lv of levels0) {
      const c = histMp1LevelEmpty0.get(lv)!;
      log(`  level ${lv}: ${c} (${pct(c, sum0)}%)`);
    }
  }

  log("\n=== 종합 해석 (자동 요약) ===");
  const m1 = globalSums.n[0] ?? 0;
  const e0m1 = globalBuckets[0]!.empty0;
  const deadm1 = globalBuckets[0]!.deadish;
  log(
    `  마지막 수 직전(mfe=1) ${m1}건 중 빈칸 0: ${pct(e0m1, m1)}%, deadish 프록시: ${pct(deadm1, m1)}%.`
  );
  const twoPlus = globalBuckets[0]!.twoPlusMax;
  const d1 = globalBuckets[0]!.dist1;
  log(
    `  같은 턴에 max 타일 2개 이상인 경우 ${twoPlus}건 중 맨해튼 거리 1(즉 인접 가능): ${pct(d1, twoPlus)}%.`
  );
  const low12 = (histMp1Level.get(1) ?? 0) + (histMp1Level.get(2) ?? 0);
  log(`  mergePairs==1인 모든 tail에서 저레벨(1·2) 인접쌍 비중: ${pct(low12, sum)}%.`);
  if (policies.length > 1) {
    const idxMfe1 = 0;
    const cmp = policies
      .map((p) => {
        const s = byPolicySums.get(p)!;
        const n = s.n[idxMfe1]!;
        const avgM = n ? s.merge[idxMfe1]! / n : 0;
        const avgE = n ? s.empty[idxMfe1]! / n : 0;
        return { p, avgM, avgE };
      })
      .sort((a, b) => b.avgM - a.avgM);
    log(`  mfe=1 평균 mergePairs 정책 순: ${cmp.map((x) => `${x.p}=${x.avgM.toFixed(2)}`).join(", ")}.`);
    log(`  mfe=1 평균 emptyCount 정책 순: ${[...cmp].sort((a, b) => b.avgE - a.avgE).map((x) => `${x.p}=${x.avgE.toFixed(2)}`).join(", ")}.`);
  }
  log("\n deadish = empty=0 & mergePairs<=1 & max레벨 인접쌍 없음.\n");

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, chunks.join(""), "utf8");
    console.error(`UTF-8 보고서 저장: ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

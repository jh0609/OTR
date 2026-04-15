/**
 * 여러 minimal NDJSON 파일을 합쳐 정책별 평균·분위수 요약.
 * 사용: npx tsx tools/aggregate-minimal-jsonl.ts out/a.jsonl out/b.jsonl ...
 */
import * as fs from "node:fs";
import * as readline from "node:readline";

type Row = {
  policy: string;
  turns: number;
  firstNearDeadTurn: number | null;
  survivalAfterNearDead: number | null;
  firstDeadishTurn: number | null;
  lastSecondMaxIncreaseTurn: number | null;
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2).filter((p) => p.endsWith(".jsonl"));
  if (paths.length === 0) {
    console.error("사용: npx tsx tools/aggregate-minimal-jsonl.ts <a.jsonl> [b.jsonl] ...");
    process.exit(1);
  }

  const byPolicy = new Map<string, Row[]>();
  for (const p of paths) {
    const rl = readline.createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity });
    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      const r = JSON.parse(t) as Row;
      const arr = byPolicy.get(r.policy) ?? [];
      arr.push(r);
      byPolicy.set(r.policy, arr);
    }
  }

  for (const pol of [...byPolicy.keys()].sort()) {
    const rows = byPolicy.get(pol)!;
    const n = rows.length;
    const fn = rows.map((r) => r.firstNearDeadTurn).filter((x): x is number => x !== null);
    const fd = rows.map((r) => r.firstDeadishTurn).filter((x): x is number => x !== null);
    const surv = rows.map((r) => r.survivalAfterNearDead).filter((x): x is number => x !== null);
    const gap2 = rows
      .map((r) =>
        r.lastSecondMaxIncreaseTurn !== null ? r.turns - r.lastSecondMaxIncreaseTurn : NaN
      )
      .filter((x) => !Number.isNaN(x));

    const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
    const sort = (a: number[]) => [...a].sort((x, y) => x - y);

    console.log(`\n=== ${pol}  n=${n} ===`);
    console.log(`  firstNearDeadTurn: mean=${mean(fn).toFixed(2)}  p50=${quantile(sort(fn), 0.5)}  (null ${n - fn.length})`);
    console.log(`  survivalAfterNearDead: mean=${mean(surv).toFixed(2)}  p50=${quantile(sort(surv), 0.5)}  (null ${n - surv.length})`);
    console.log(`  firstDeadishTurn: mean=${mean(fd).toFixed(2)}  p50=${quantile(sort(fd), 0.5)}  (null ${n - fd.length})`);
    console.log(`  turns-lastSecondMaxInc: mean=${mean(gap2).toFixed(2)}  p50=${quantile(sort(gap2), 0.5)}`);
    console.log(`  turns: mean=${mean(rows.map((r) => r.turns)).toFixed(2)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * minimal NDJSON checkpoint A/B 비교·연결성 타이밍 (정책별).
 * 사용: npx tsx tools/analyze-minimal-checkpoints.ts out/a.jsonl [out/b.jsonl ...]
 */
import * as fs from "node:fs";

type Cp = {
  emptyCount: number;
  oneStepSurvivalCount: number;
  immediateMergeCount: number;
  maxTileGap: number;
  hasAdjacentPairAtOrAbove6: boolean;
  hasAdjacentPairAtOrAbove7: boolean;
  deadish?: boolean;
  secondMaxTile: number;
  maxTile: number;
};

type Row = {
  policy: string;
  turns: number;
  firstNearDeadTurn: number | null;
  firstDeadishTurn: number | null;
  firstNoAdj6Turn: number | null;
  firstNoAdj7Turn: number | null;
  lastSecondMaxIncreaseTurn: number | null;
  checkpointA: Cp | null;
  checkpointB: Cp | null;
};

function mean(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx]!;
}

function byPolicy(rows: Row[]): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const a = m.get(r.policy) ?? [];
    a.push(r);
    m.set(r.policy, a);
  }
  return m;
}

const paths = process.argv.slice(2).filter((x) => x.endsWith(".jsonl"));
if (paths.length === 0) {
  console.error("사용: npx tsx tools/analyze-minimal-checkpoints.ts <files.jsonl>");
  process.exit(1);
}

const rows: Row[] = [];
for (const p of paths) {
  for (const line of fs.readFileSync(p, "utf8").trim().split("\n")) {
    if (line) rows.push(JSON.parse(line) as Row);
  }
}

const policies = ["P0-random", "P1-greedyEmpty", "P2-minimal"];
const grouped = byPolicy(rows);

console.log("nTotal=", rows.length);

const cnt = (pred: (n: number) => boolean, arr: number[]) => arr.filter(pred).length;

for (const pol of policies) {
  const pr = grouped.get(pol) ?? [];
  const n = pr.length;
  const withB = pr.filter((r) => r.checkpointB !== null);
  const withA = pr.filter((r) => r.checkpointA !== null);
  const withAB = pr.filter((r) => r.checkpointA && r.checkpointB);

  const bEmpty = withB.map((r) => r.checkpointB!.emptyCount);
  const bOss = withB.map((r) => r.checkpointB!.oneStepSurvivalCount);
  const bImm = withB.map((r) => r.checkpointB!.immediateMergeCount);
  const bGap = withB.map((r) => r.checkpointB!.maxTileGap);
  const bAdj6 = withB.filter((r) => r.checkpointB!.hasAdjacentPairAtOrAbove6).length;
  const bAdj7 = withB.filter((r) => r.checkpointB!.hasAdjacentPairAtOrAbove7).length;
  const nb = withB.length;

  const aEmpty = withA.map((r) => r.checkpointA!.emptyCount);
  const aOss = withA.map((r) => r.checkpointA!.oneStepSurvivalCount);
  const aImm = withA.map((r) => r.checkpointA!.immediateMergeCount);
  const aAdj6 = withA.filter((r) => r.checkpointA!.hasAdjacentPairAtOrAbove6).length;
  const aAdj7 = withA.filter((r) => r.checkpointA!.hasAdjacentPairAtOrAbove7).length;
  const aDeadish = withA.filter((r) => r.checkpointA!.deadish).length;
  const na = withA.length;

  const dEmpty = withAB.map((r) => r.checkpointA!.emptyCount - r.checkpointB!.emptyCount);
  const dImm = withAB.map((r) => r.checkpointA!.immediateMergeCount - r.checkpointB!.immediateMergeCount);
  const dGap = withAB.map((r) => r.checkpointA!.maxTileGap - r.checkpointB!.maxTileGap);
  const dSecond = withAB.map((r) => r.checkpointA!.secondMaxTile - r.checkpointB!.secondMaxTile);
  const adj6Lost = withAB.filter(
    (r) => r.checkpointB!.hasAdjacentPairAtOrAbove6 && !r.checkpointA!.hasAdjacentPairAtOrAbove6
  ).length;
  const adj6HadB = withAB.filter((r) => r.checkpointB!.hasAdjacentPairAtOrAbove6).length;
  const adj7Lost = withAB.filter(
    (r) => r.checkpointB!.hasAdjacentPairAtOrAbove7 && !r.checkpointA!.hasAdjacentPairAtOrAbove7
  ).length;
  const adj7HadB = withAB.filter((r) => r.checkpointB!.hasAdjacentPairAtOrAbove7).length;

  const gap2nd = pr
    .map((r) =>
      r.lastSecondMaxIncreaseTurn !== null ? r.turns - r.lastSecondMaxIncreaseTurn : NaN
    )
    .filter((x) => !Number.isNaN(x));

  const both6Near = pr.filter((r) => r.firstNoAdj6Turn !== null && r.firstNearDeadTurn !== null);
  const d6MinusNear = both6Near.map((r) => r.firstNoAdj6Turn! - r.firstNearDeadTurn!);
  const both7Near = pr.filter((r) => r.firstNoAdj7Turn !== null && r.firstNearDeadTurn !== null);
  const d7MinusNear = both7Near.map((r) => r.firstNoAdj7Turn! - r.firstNearDeadTurn!);

  const both6Dead = pr.filter((r) => r.firstNoAdj6Turn !== null && r.firstDeadishTurn !== null);
  const d6MinusDead = both6Dead.map((r) => r.firstNoAdj6Turn! - r.firstDeadishTurn!);

  console.log("\n---", pol, "n=", n, "---");
  console.log("checkpointB (n=", nb, ")");
  console.log(
    "  empty mean/p50:",
    mean(bEmpty).toFixed(3),
    quantile([...bEmpty].sort((a, b) => a - b), 0.5)
  );
  console.log("  oneStepSurvival mean:", mean(bOss).toFixed(3));
  console.log("  immediateMerge mean:", mean(bImm).toFixed(3));
  console.log("  maxTileGap mean:", mean(bGap).toFixed(3));
  console.log("  hasAdj>=6%:", ((100 * bAdj6) / nb).toFixed(2), "hasAdj>=7%:", ((100 * bAdj7) / nb).toFixed(2));

  console.log("checkpointA (n=", na, ")");
  console.log(
    "  empty mean/p50:",
    mean(aEmpty).toFixed(3),
    quantile([...aEmpty].sort((a, b) => a - b), 0.5)
  );
  console.log("  oneStepSurvival mean:", mean(aOss).toFixed(3));
  console.log("  immediateMerge mean:", mean(aImm).toFixed(3));
  console.log("  hasAdj>=6%:", ((100 * aAdj6) / na).toFixed(2), "hasAdj>=7%:", ((100 * aAdj7) / na).toFixed(2));
  console.log("  deadish%:", ((100 * aDeadish) / na).toFixed(2));

  console.log("A-B (n=", withAB.length, ")");
  console.log("  dEmpty mean:", mean(dEmpty).toFixed(3));
  console.log("  dImm mean:", mean(dImm).toFixed(3));
  console.log("  dMaxTileGap mean:", mean(dGap).toFixed(3));
  console.log("  dSecondMax mean:", mean(dSecond).toFixed(3));
  console.log(
    "  adj6 lost (B had & A not) / B had adj6:",
    adj6Lost,
    "/",
    adj6HadB,
    "=",
    adj6HadB ? ((100 * adj6Lost) / adj6HadB).toFixed(1) : "n/a",
    "%"
  );
  console.log(
    "  adj7 lost / B had adj7:",
    adj7Lost,
    "/",
    adj7HadB,
    "=",
    adj7HadB ? ((100 * adj7Lost) / adj7HadB).toFixed(1) : "n/a",
    "%"
  );

  console.log(
    "turns-lastSecondMaxInc mean/p50:",
    mean(gap2nd).toFixed(3),
    quantile([...gap2nd].sort((a, b) => a - b), 0.5)
  );

  console.log("firstNoAdj6 - firstNearDead (n=", d6MinusNear.length, ")");
  if (d6MinusNear.length) {
    console.log(
      "  mean:",
      mean(d6MinusNear).toFixed(3),
      "<0 before near:",
      cnt((x) => x < 0, d6MinusNear),
      "==0:",
      cnt((x) => x === 0, d6MinusNear),
      ">0 after:",
      cnt((x) => x > 0, d6MinusNear)
    );
  }
  console.log("firstNoAdj7 - firstNearDead (n=", d7MinusNear.length, ")");
  if (d7MinusNear.length) {
    console.log(
      "  mean:",
      mean(d7MinusNear).toFixed(3),
      "<0:",
      cnt((x) => x < 0, d7MinusNear),
      ">0:",
      cnt((x) => x > 0, d7MinusNear)
    );
  }
  console.log("firstNoAdj6 - firstDeadish (n=", d6MinusDead.length, ")");
  if (d6MinusDead.length) {
    console.log(
      "  mean:",
      mean(d6MinusDead).toFixed(3),
      "<0 (adj6 gone before deadish):",
      cnt((x) => x < 0, d6MinusDead)
    );
  }
}

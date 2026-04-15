import { describe, expect, it } from "vitest";
import { slide } from "./slide";
import { spawnAll } from "./spawn";
import { legalActions } from "./legal";
import { detectPatterns } from "./patterns";
import { boardFrom, emptyBoard, runMonteCarlo, simulateOne } from "./simulate";
import { createRng } from "./rng";
import { greedyEmptyPolicy, makeRandomPolicy } from "./policies";
import { boardEquals, maxTileLevel } from "./board";
import { TERMINAL_REASONS } from "./types";

describe("slide merge (2048-style)", () => {
  it("merges k+k → k+1 once per pair", () => {
    const b = boardFrom([2, 2, 0, 0, 0, 0, 0, 0, 0]);
    const { next, moved, win } = slide(b, "LEFT");
    expect(moved).toBe(true);
    expect(win).toBe(false);
    expect([...next]).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("does not double-merge the same tile in one turn (2,2,2 → 3,2,0)", () => {
    const b = boardFrom([2, 2, 2, 0, 0, 0, 0, 0, 0]);
    const { next } = slide(b, "LEFT");
    expect([...next]).toEqual([3, 2, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("detects win when 8+8 → 9", () => {
    const b = boardFrom([8, 8, 0, 0, 0, 0, 0, 0, 0]);
    const r = slide(b, "LEFT");
    expect(r.win).toBe(true);
    expect(r.next[0]).toBe(9);
    expect(maxTileLevel(r.next)).toBe(9);
  });

  it("[1,1,1] row LEFT → [2,1,0]", () => {
    const b = boardFrom([1, 1, 1, 0, 0, 0, 0, 0, 0]);
    expect([...slide(b, "LEFT").next.slice(0, 3)]).toEqual([2, 1, 0]);
  });

  it("[1,1,0] LEFT → [2,0,0]", () => {
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect([...slide(b, "LEFT").next.slice(0, 3)]).toEqual([2, 0, 0]);
  });

  it("[1,0,1] LEFT → [2,0,0]", () => {
    const b = boardFrom([1, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect([...slide(b, "LEFT").next.slice(0, 3)]).toEqual([2, 0, 0]);
  });

  it("column [1,1,1] UP matches row merge toward top", () => {
    const b = boardFrom([1, 0, 0, 1, 0, 0, 1, 0, 0]);
    const n = slide(b, "UP").next;
    expect(n[0]).toBe(2);
    expect(n[3]).toBe(1);
    expect(n[6]).toBe(0);
  });

  it("column [1,1,1] DOWN packs to bottom like 2048", () => {
    const b = boardFrom([1, 0, 0, 1, 0, 0, 1, 0, 0]);
    const n = slide(b, "DOWN").next;
    expect(n[0]).toBe(0);
    expect(n[3]).toBe(1);
    expect(n[6]).toBe(2);
  });

  it("7+7 → 8 without win", () => {
    const b = boardFrom([7, 7, 0, 0, 0, 0, 0, 0, 0]);
    const r = slide(b, "LEFT");
    expect(r.win).toBe(false);
    expect(r.next[0]).toBe(8);
  });

  it("two 8s on board but not mergeable in one line → no win", () => {
    const b = boardFrom([8, 0, 0, 0, 8, 0, 0, 0, 0]);
    expect(slide(b, "LEFT").win).toBe(false);
    expect(slide(b, "UP").win).toBe(false);
  });
});

describe("legalActions (any board change ⇒ legal)", () => {
  it("counts pure slide/compression without merge", () => {
    const b = boardFrom([0, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(slide(b, "LEFT").moved).toBe(true);
    expect(legalActions(b).length).toBeGreaterThan(0);
  });

  it("[2,0,1] LEFT compresses and merges 2+1 is false — [2,1,0]", () => {
    const b = boardFrom([2, 0, 1, 0, 0, 0, 0, 0, 0]);
    const r = slide(b, "LEFT");
    expect(r.moved).toBe(true);
    expect([...r.next.slice(0, 3)]).toEqual([2, 1, 0]);
  });
});

describe("spawnAll", () => {
  it("returns one board per empty cell with a new 1", () => {
    const e = emptyBoard();
    const all = spawnAll(e);
    expect(all).toHaveLength(9);
    let sum = 0;
    for (const g of all) {
      expect(g.reduce((a, v) => a + (v === 1 ? 1 : 0), 0)).toBe(1);
      sum += g.reduce((a, v) => a + v, 0);
    }
    expect(sum).toBe(9);
  });
});

describe("no legal moves", () => {
  it("returns empty legal actions when no slide changes the board", () => {
    const b = boardFrom([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(legalActions(b)).toEqual([]);
  });
});

describe("pattern detection", () => {
  it("flags top-row triples", () => {
    const p1 = detectPatterns(boardFrom([0, 1, 2, 0, 0, 0, 0, 0, 0]));
    expect(p1.has012).toBe(true);
    expect(p1.has002).toBe(false);
    expect(p1.has020).toBe(false);
    const p2 = detectPatterns(boardFrom([0, 2, 0, 0, 0, 0, 0, 0, 0]));
    expect(p2.has020).toBe(true);
    const p3 = detectPatterns(boardFrom([0, 0, 2, 0, 0, 0, 0, 0, 0]));
    expect(p3.has002).toBe(true);
  });
});

describe("simulateOne", () => {
  it("terminates on seeded run", () => {
    const rng = createRng(42);
    const r = simulateOne(greedyEmptyPolicy, rng, "standard");
    expect(r.steps).toBeGreaterThan(0);
    expect(r.steps).toBeLessThan(600_000);
    expect(r.finalMaxLevel).toBeLessThanOrEqual(r.maxLevelReached);
    expect(r.tailMoves.length).toBeGreaterThan(0);
    expect(r.tailMoves.length).toBeLessThanOrEqual(Math.min(10, r.steps));
    expect(r.tailMoves[r.tailMoves.length - 1]!.movesFromEnd).toBe(1);
    expect(r.tailMoves[0]!.boardCells.length).toBe(9);
  });

  it("initial strict rule can fail before first move", () => {
    const rng = createRng(1);
    const r = simulateOne(greedyEmptyPolicy, rng, "strict", () => false);
    expect(r.win).toBe(false);
    expect(r.steps).toBe(0);
    expect(r.terminalReason).toBe("strict_rule_failed");
    expect(r.tailMoves.length).toBe(0);
  });
});

describe("runMonteCarlo", () => {
  it("returns bounded stats for small n", () => {
    const rng = createRng(0);
    const p = makeRandomPolicy(rng);
    const mc = runMonteCarlo(p, 20, 12345, "standard");
    expect(mc.winRate).toBeGreaterThanOrEqual(0);
    expect(mc.winRate).toBeLessThanOrEqual(1);
    expect(mc.avgSteps).toBeGreaterThan(0);
    let sumReasons = 0;
    for (const k of TERMINAL_REASONS) sumReasons += mc.terminalReasons[k];
    expect(sumReasons).toBe(20);
    let sumDist = 0;
    for (let L = 0; L <= 9; L++) sumDist += mc.maxLevelDistribution[L] ?? 0;
    expect(sumDist).toBe(20);
    let sumFinal = 0;
    for (let L = 0; L <= 9; L++) sumFinal += mc.finalMaxLevelDistribution[L] ?? 0;
    expect(sumFinal).toBe(20);
    let sfs = 0;
    for (let k = 0; k <= 8; k++) sfs += mc.finalSecondMaxDistribution[k] ?? 0;
    expect(sfs).toBe(20);
    let spk = 0;
    for (let k = 0; k <= 8; k++) spk += mc.peakSecondMaxDistribution[k] ?? 0;
    expect(spk).toBe(20);
    expect(mc.lateTailSampleCount.length).toBe(10);
    expect(mc.lateLastMoveSampleCount).toBeGreaterThan(0);
    let sc8 = 0;
    for (let k = 0; k <= 9; k++) sc8 += mc.finalCount8Distribution[k] ?? 0;
    expect(sc8).toBe(20);
    let sc7 = 0;
    for (let k = 0; k <= 9; k++) sc7 += mc.finalCountGe7Distribution[k] ?? 0;
    expect(sc7).toBe(20);
    let sp7 = 0;
    for (let k = 0; k <= 9; k++) sp7 += mc.peakCountGe7Distribution[k] ?? 0;
    expect(sp7).toBe(20);
  });
});

describe("board helpers", () => {
  it("boardEquals", () => {
    expect(boardEquals(boardFrom([1, 0, 0, 0, 0, 0, 0, 0, 0]), boardFrom([1, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
  });
});

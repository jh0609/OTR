import { describe, expect, it, vi } from "vitest";
import { boardFrom } from "./simulate";
import { slide } from "./slide";
import {
  evaluateAction,
  evaluateAction2,
  evaluateAction3,
  evaluateAfterSlideSpawnExpectation,
  createExpectimaxPolicy,
  maxQ1Ply,
  referenceMoveCausesRainbowFusion,
  score_toplevel_move,
  searchExpectedValue,
  expectimaxPolicySelectiveLate3,
} from "./expectimax";
import { scoreBoardV3 } from "./scoringV3";
import { countMergePairs, DEFAULT_SCORE_WEIGHTS } from "./scoring";
import { legalActions } from "./legal";
import { maxTileLevel } from "./board";
import { spawnAll } from "./spawn";

const WIN_SCORE = 1_000_000_000;
const WIN_DEPTH_BONUS = 10_000;
const ROOT_IMMEDIATE_WIN_BONUS = 1_000_000;

function countImmediateFusionChildrenAfterRootMove(board: ReturnType<typeof boardFrom>, dir: "UP" | "DOWN" | "LEFT" | "RIGHT"): number {
  const result = slide(board, dir);
  expect(result.moved).toBe(true);
  expect(result.win).toBe(false);
  return spawnAll(result.next).filter((child) =>
    legalActions(child).some((childDir) => slide(child, childDir).win)
  ).length;
}

function parseReferenceLog(line: string): { movesEvaled: number; maxdepth: number } {
  const movesMatch = /eval'd (\d+) moves/.exec(line);
  const depthMatch = /maxdepth=(\d+)/.exec(line);
  expect(movesMatch).not.toBeNull();
  expect(depthMatch).not.toBeNull();
  return {
    movesEvaled: Number(movesMatch![1]),
    maxdepth: Number(depthMatch![1]),
  };
}

describe("scoreBoardV3", () => {
  it("is finite for typical boards", () => {
    const b = boardFrom([1, 0, 0, 0, 2, 0, 0, 0, 1]);
    expect(Number.isFinite(scoreBoardV3(b))).toBe(true);
  });

  it("counts merge pairs on a row", () => {
    expect(countMergePairs(boardFrom([2, 2, 0, 0, 0, 0, 0, 0, 0]))).toBe(1);
  });
});

describe("expectimax evaluateAction", () => {
  it("uses spawn expectation after slide (not winning)", () => {
    const b = boardFrom([0, 2, 0, 0, 0, 0, 0, 0, 0]);
    const qLeft = evaluateAction(b, "LEFT", DEFAULT_SCORE_WEIGHTS, "topRow");
    expect(Number.isFinite(qLeft)).toBe(true);
    expect(qLeft).toBeGreaterThan(-1e9);
  });

  it("does not average spawns when slide wins by 8+8 fusion", () => {
    const b = boardFrom([8, 8, 0, 0, 0, 0, 0, 0, 0]);
    const r = slide(b, "LEFT");
    expect(r.win).toBe(true);
    expect(r.next).not.toContain(9);
    const q = evaluateAction(b, "LEFT", DEFAULT_SCORE_WEIGHTS, "topRow");
    expect(Number.isFinite(q)).toBe(true);
  });

  it("full-board after slide: no spawn outcomes → single board score", () => {
    const full = boardFrom([1, 2, 3, 4, 5, 6, 7, 8, 1]);
    const q = evaluateAfterSlideSpawnExpectation(full);
    expect(q).toBe(scoreBoardV3(full));
  });
});

describe("createExpectimaxPolicy", () => {
  it("returns a legal direction", () => {
    const pol = createExpectimaxPolicy({});
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const acts = legalActions(b);
    const d = pol(b, acts);
    expect(acts).toContain(d);
  });

  it("depth 2 returns a legal direction", () => {
    const pol = createExpectimaxPolicy({ depth: 2 });
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const acts = legalActions(b);
    const d = pol(b, acts);
    expect(acts).toContain(d);
  });
});

describe("2-ply expectimax", () => {
  it("evaluateAction2 is finite when slide moves", () => {
    const b = boardFrom([0, 2, 0, 0, 0, 0, 0, 0, 0]);
    const q = evaluateAction2(b, "LEFT", DEFAULT_SCORE_WEIGHTS, "topRow");
    expect(Number.isFinite(q)).toBe(true);
  });

  it("maxQ1Ply is at least leaf score on dead board", () => {
    const b = boardFrom([1, 2, 3, 4, 5, 6, 7, 8, 1]);
    expect(maxQ1Ply(b, DEFAULT_SCORE_WEIGHTS, "topRow")).toBe(scoreBoardV3(b));
  });

  it("searchExpectedValue depth 2 matches max over evaluateAction2", () => {
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const v2 = searchExpectedValue(b, 2, DEFAULT_SCORE_WEIGHTS, "topRow");
    const acts = legalActions(b);
    let m = -Infinity;
    for (const d of acts) {
      const q = evaluateAction2(b, d, DEFAULT_SCORE_WEIGHTS, "topRow");
      if (q > m) m = q;
    }
    expect(v2).toBe(m);
  });
});

describe("evaluateAction3 (me→spawn→me→spawn→me→leaf)", () => {
  it("is finite when slide moves", () => {
    const b = boardFrom([0, 2, 0, 0, 0, 0, 0, 0, 0]);
    const q = evaluateAction3(b, "LEFT", DEFAULT_SCORE_WEIGHTS, "topRow");
    expect(Number.isFinite(q)).toBe(true);
  });
});

describe("expectimaxPolicySelectiveLate3", () => {
  it("returns a legal direction", () => {
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const acts = legalActions(b);
    const d = expectimaxPolicySelectiveLate3(
      b,
      acts,
      { lateGameDepthThreshold: 7, rerankTopK: 2 }
    );
    expect(acts).toContain(d);
  });

  it("uses same as 2-ply when maxTile < threshold", () => {
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(maxTileLevel(b)).toBeLessThan(7);
    const acts = legalActions(b);
    const d2 = createExpectimaxPolicy({ depth: 2 })(b, acts);
    const dSel = expectimaxPolicySelectiveLate3(b, acts, {
      lateGameDepthThreshold: 7,
      rerankTopK: 2,
    });
    expect(dSel).toBe(d2);
  });
});

describe("reference expectimax sanity", () => {
  it("returns 0 for invalid top-level moves", () => {
    const b = boardFrom([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(score_toplevel_move(b, 0, { depthLimit: 2 })).toBe(0);
  });

  it("scores immediate winning merges above delayed win-quality scores at top level", () => {
    const b = boardFrom([8, 8, 0, 0, 0, 0, 0, 0, 0]);
    expect(score_toplevel_move(b, 2, { depthLimit: 2 })).toBe(WIN_SCORE + ROOT_IMMEDIATE_WIN_BONUS);
    expect(score_toplevel_move(b, 2, { depthLimit: 2 })).toBeGreaterThan(
      score_toplevel_move(b, 1, { depthLimit: 2 })
    );
  });

  it("chooses an immediate rainbow fusion when adjacent 8s are available", () => {
    const b = boardFrom([1, 8, 8, 3, 2, 1, 0, 1, 0]);
    const acts = legalActions(b);
    const d = createExpectimaxPolicy({ reference: true, referenceDepthLimit: 8 })(b, acts);
    expect(d).toBe("LEFT");
  });

  it("prefers immediate rainbow fusion over a delayed forced win tie", () => {
    const b = boardFrom([1, 8, 8, 3, 2, 1, 0, 1, 0]);
    expect(score_toplevel_move(b, 1, { depthLimit: 8 })).toBeGreaterThan(WIN_SCORE);
    expect(score_toplevel_move(b, 2, { depthLimit: 8 })).toBe(WIN_SCORE + ROOT_IMMEDIATE_WIN_BONUS);
    expect(score_toplevel_move(b, 2, { depthLimit: 8 })).toBeGreaterThan(
      score_toplevel_move(b, 1, { depthLimit: 8 })
    );
  });

  it("prefers faster delayed rainbow fusion over slower delayed rainbow fusion", () => {
    const b = boardFrom([0, 2, 2, 4, 3, 0, 4, 8, 8]);
    const fast = score_toplevel_move(b, 1, { depthLimit: 8 });
    const slow = score_toplevel_move(b, 0, { depthLimit: 8 });
    expect(fast).toBeGreaterThan(WIN_SCORE + 6 * WIN_DEPTH_BONUS);
    expect(slow).toBeGreaterThan(WIN_SCORE);
    expect(fast).toBeGreaterThan(slow);
  });

  it("preserves expectimax averaging so all-spawn fusion beats partial-spawn fusion", () => {
    const b = boardFrom([4, 8, 3, 3, 0, 3, 8, 0, 4]);
    expect(countImmediateFusionChildrenAfterRootMove(b, "DOWN")).toBe(3);
    expect(countImmediateFusionChildrenAfterRootMove(b, "RIGHT")).toBe(2);
    expect(score_toplevel_move(b, 1, { depthLimit: 8 })).toBeGreaterThan(
      score_toplevel_move(b, 3, { depthLimit: 8 })
    );
  });

  it("leaves non-fusion reference heuristic behavior effectively unchanged", () => {
    const b = boardFrom([1, 2, 3, 4, 5, 6, 7, 1, 2]);
    const refined = score_toplevel_move(b, 0, { depthLimit: 4 });
    const legacy = score_toplevel_move(b, 0, { depthLimit: 4, winQualityTieBreak: false });
    expect(refined).toBeLessThan(WIN_SCORE);
    expect(Math.abs(refined - legacy)).toBeLessThan(1e-3);
  });

  it("detects terminal rainbow fusion from the move without requiring a level-9 board", () => {
    const b = boardFrom([8, 8, 0, 0, 0, 0, 0, 0, 0]);
    expect(maxTileLevel(b)).toBe(8);
    expect(referenceMoveCausesRainbowFusion(b, 2)).toBe(true);
    expect(score_toplevel_move(b, 2, { depthLimit: 1 })).toBeGreaterThanOrEqual(WIN_SCORE);
  });

  it("evaluates exactly one level-1 spawn child per empty cell", () => {
    const b = boardFrom([0, 1, 0, 0, 0, 0, 0, 0, 0]);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      score_toplevel_move(b, 2, { depthLimit: 1, log: true });
      expect(spy).toHaveBeenCalledTimes(1);
      const { movesEvaled } = parseReferenceLog(String(spy.mock.calls[0]?.[0] ?? ""));
      expect(movesEvaled).toBe(8 * 4);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not recurse on immediate winning moves inside score_move_node", () => {
    const b = boardFrom([8, 8, 0, 1, 2, 3, 4, 5, 6]);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const score = score_toplevel_move(b, 0, { depthLimit: 4, log: true });
      expect(score).toBe(WIN_SCORE + 3 * WIN_DEPTH_BONUS);
      expect(spy).toHaveBeenCalledTimes(1);
      const { movesEvaled } = parseReferenceLog(String(spy.mock.calls[0]?.[0] ?? ""));
      expect(movesEvaled).toBe(4);
    } finally {
      spy.mockRestore();
    }
  });

  it("updates maxdepth when depthLimit >= 1", () => {
    const b = boardFrom([0, 1, 0, 0, 0, 0, 0, 0, 0]);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      score_toplevel_move(b, 2, { depthLimit: 1, log: true });
      expect(spy).toHaveBeenCalledTimes(1);
      const { maxdepth } = parseReferenceLog(String(spy.mock.calls[0]?.[0] ?? ""));
      expect(maxdepth).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });
});

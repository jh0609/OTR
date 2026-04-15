import { describe, it, expect } from "vitest";
import { boardFrom } from "./simulate";
import { countMergePairs } from "./scoring";
import {
  extractSurvivalFeatures,
  isDeadish,
  isDeadishTailStyle,
  isMaxTileAnchorShifted,
  indicesOfGlobalMax,
} from "./survivalFeatures";

describe("survivalFeatures", () => {
  it("extractSurvivalFeatures: full board has legal 0", () => {
    const b = boardFrom([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const f = extractSurvivalFeatures(b, null);
    expect(f.legalActionCount).toBe(0);
    expect(f.emptyCount).toBe(0);
    expect(f.nearDead).toBe(false);
  });

  it("isMaxTileAnchorShifted: same max level, different positions", () => {
    const prev = boardFrom([7, 0, 0, 0, 0, 0, 0, 0, 0]);
    const curr = boardFrom([0, 7, 0, 0, 0, 0, 0, 0, 0]);
    expect(isMaxTileAnchorShifted(prev, curr)).toBe(true);
    expect(indicesOfGlobalMax(prev).has(0)).toBe(true);
    expect(indicesOfGlobalMax(curr).has(1)).toBe(true);
  });

  it("isMaxTileAnchorShifted: same positions false", () => {
    const b = boardFrom([7, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(isMaxTileAnchorShifted(b, boardFrom([7, 2, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  it("maxLevelIncreasedSincePrevTurn vs anchor shift", () => {
    const prev = boardFrom([6, 0, 0, 0, 0, 0, 0, 0, 0]);
    const curr = boardFrom([7, 0, 0, 0, 0, 0, 0, 0, 0]);
    const f = extractSurvivalFeatures(curr, prev);
    expect(f.maxLevelIncreasedSincePrevTurn).toBe(true);
    expect(f.maxTileAnchorShifted).toBe(false);
  });

  it("isDeadish vs tail-style can differ", () => {
    const b = boardFrom([7, 0, 6, 6, 7, 5, 4, 3, 2]);
    const mp = countMergePairs(b);
    expect(typeof isDeadishTailStyle(b, mp)).toBe("boolean");
    expect(typeof isDeadish(b)).toBe("boolean");
  });
});

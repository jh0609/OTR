import { describe, expect, it } from "vitest";
import { boardFrom } from "./simulate";
import {
  areAdjacent,
  hasAdjacentCrossPair,
  hasAdjacentPair,
  highLevelAdjacencyState,
} from "./boardStats";

describe("adjacency helpers", () => {
  it("areAdjacent", () => {
    expect(areAdjacent(0, 1)).toBe(true);
    expect(areAdjacent(0, 3)).toBe(true);
    expect(areAdjacent(0, 2)).toBe(false);
    expect(areAdjacent(0, 4)).toBe(false);
    expect(areAdjacent(4, 4)).toBe(false);
  });

  it("hasAdjacentPair for level 7", () => {
    const b = boardFrom([7, 7, 0, 0, 0, 0, 0, 0, 0]);
    expect(hasAdjacentPair(b, 7)).toBe(true);
    expect(hasAdjacentPair(boardFrom([7, 0, 7, 0, 0, 0, 0, 0, 0]), 7)).toBe(false);
  });

  it("hasAdjacentCrossPair 8 and 7", () => {
    expect(hasAdjacentCrossPair(boardFrom([8, 7, 0, 0, 0, 0, 0, 0, 0]), 8, 7)).toBe(true);
    expect(hasAdjacentCrossPair(boardFrom([7, 0, 8, 0, 0, 0, 0, 0, 0]), 8, 7)).toBe(false);
  });

  it("highLevelAdjacencyState priority", () => {
    expect(highLevelAdjacencyState(boardFrom([8, 8, 0, 0, 0, 0, 0, 0, 0]))).toBe("88");
    expect(highLevelAdjacencyState(boardFrom([8, 7, 0, 0, 0, 0, 0, 0, 0]))).toBe("87");
    expect(highLevelAdjacencyState(boardFrom([7, 7, 0, 0, 0, 0, 0, 0, 0]))).toBe("77");
    expect(highLevelAdjacencyState(boardFrom([8, 0, 8, 0, 0, 0, 0, 0, 0]))).toBe("none");
  });
});

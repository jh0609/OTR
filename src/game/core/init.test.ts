import { describe, it, expect } from "vitest";
import { initGame } from "./init";

describe("initGame", () => {
  it("returns board with exactly 2 tiles (level 1)", () => {
    const board = initGame(0, 0);
    const count = board.flat().filter((c) => c !== 0).length;
    expect(count).toBe(2);
    expect(board.flat().every((c) => c === 0 || c === 1)).toBe(true);
  });

  it("places first tile at first empty, second at first remaining empty", () => {
    const board = initGame(0, 0);
    expect(board[0][0]).toBe(1);
    expect(board[0][1]).toBe(1);
  });
});

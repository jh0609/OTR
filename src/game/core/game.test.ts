import { describe, it, expect } from "vitest";
import type { Board } from "./types";
import { hasWon, isGameOver, step } from "./game";

describe("game", () => {
  describe("hasWon", () => {
    it("returns false when no 8", () => {
      const board: Board = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 0, 0],
      ];
      expect(hasWon(board)).toBe(false);
    });

    it("returns true when any cell is 8", () => {
      const board: Board = [
        [1, 2, 3],
        [4, 8, 6],
        [7, 0, 0],
      ];
      expect(hasWon(board)).toBe(true);
    });
  });

  describe("isGameOver", () => {
    it("returns false when empty cells exist", () => {
      const board: Board = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 0],
      ];
      expect(isGameOver(board)).toBe(false);
    });

    it("returns false when merge possible", () => {
      const board: Board = [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ];
      expect(isGameOver(board)).toBe(false);
    });

    it("returns true when full and no merge possible", () => {
      const board: Board = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 1],
      ];
      expect(isGameOver(board)).toBe(true);
    });
  });

  describe("step", () => {
    it("unchanged when move does nothing", () => {
      const board: Board = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 1],
      ];
      const result = step(board, "left", 0);
      expect(result.changed).toBe(false);
      expect(result.board).toEqual(board);
      expect(result.spawnedAt).toBeNull();
      expect(result.scoreDelta).toBe(0);
    });

    it("moves then spawns one tile when move changes board", () => {
      const board: Board = [
        [1, 1, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      const result = step(board, "left", 0);
      expect(result.changed).toBe(true);
      expect(result.board[0]).toEqual([2, 1, 0]); // merged to 2, then spawn at (0,1)
      expect(result.scoreDelta).toBe(2);
      expect(result.spawnedAt).not.toBeNull();
      const emptyCount = result.board.flat().filter((c) => c === 0).length;
      expect(emptyCount).toBe(7); // 1 tile after merge + 1 spawn = 2 filled, 7 empty
    });

    it("spawnedAt depends on randomIndex", () => {
      const board: Board = [
        [1, 1, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      const r0 = step(board, "left", 0);
      const r1 = step(board, "left", 1);
      expect(r0.changed).toBe(true);
      expect(r1.changed).toBe(true);
      expect(r0.spawnedAt).not.toBeNull();
      expect(r1.spawnedAt).not.toBeNull();
      expect(r0.spawnedAt).not.toEqual(r1.spawnedAt);
    });
  });
});

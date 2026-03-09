import { describe, it, expect } from "vitest";
import type { Board } from "./types";
import { applyMove } from "./move";

describe("move", () => {
  it("all tiles left: [1,1,1] row becomes [2,1,0]", () => {
    const board: Board = [
      [1, 1, 1],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const result = applyMove(board, "left");
    expect(result.changed).toBe(true);
    expect(result.board[0]).toEqual([2, 1, 0]);
    expect(result.scoreDelta).toBe(2);
  });

  it("[1,1,2] left becomes [2,2,0]", () => {
    const board: Board = [
      [1, 1, 2],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const result = applyMove(board, "left");
    expect(result.board[0]).toEqual([2, 2, 0]);
  });

  it("[2,2,2] left becomes [3,2,0]", () => {
    const board: Board = [
      [2, 2, 2],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const result = applyMove(board, "left");
    expect(result.board[0]).toEqual([3, 2, 0]);
  });

  it("[8,8,0] left stays [8,8,0]", () => {
    const board: Board = [
      [8, 8, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const result = applyMove(board, "left");
    expect(result.board[0]).toEqual([8, 8, 0]);
    expect(result.changed).toBe(false);
  });

  it("right: [1,1,1] becomes [0,1,2]", () => {
    const board: Board = [
      [1, 1, 1],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const result = applyMove(board, "right");
    expect(result.board[0]).toEqual([0, 1, 2]);
  });

  it("up: column [1,1,1] becomes [2,1,0]", () => {
    const board: Board = [
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ];
    const result = applyMove(board, "up");
    expect(result.board[0][0]).toBe(2);
    expect(result.board[1][0]).toBe(1);
    expect(result.board[2][0]).toBe(0);
  });

  it("down: column [1,1,1] becomes [0,1,2]", () => {
    const board: Board = [
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ];
    const result = applyMove(board, "down");
    expect(result.board[0][0]).toBe(0);
    expect(result.board[1][0]).toBe(1);
    expect(result.board[2][0]).toBe(2);
  });

  it("no move possible leaves board unchanged", () => {
    const board: Board = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 1],
    ];
    const result = applyMove(board, "left");
    expect(result.changed).toBe(false);
    expect(result.board).toEqual(board);
  });
});

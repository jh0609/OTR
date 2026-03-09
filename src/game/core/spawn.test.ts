import { describe, it, expect } from "vitest";
import type { Board } from "./types";
import { pickEmptyPosition, spawnAt, spawnOne } from "./spawn";

describe("spawn", () => {
  it("pickEmptyPosition returns null for full board", () => {
    const board: Board = [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ];
    expect(pickEmptyPosition(board, 0)).toBeNull();
  });

  it("pickEmptyPosition returns only empty cell", () => {
    const board: Board = [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ];
    const pos = pickEmptyPosition(board, 0);
    expect(pos).toEqual({ row: 1, col: 1 });
  });

  it("pickEmptyPosition with randomIndex selects correct cell", () => {
    const board: Board = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const pos0 = pickEmptyPosition(board, 0);
    const pos4 = pickEmptyPosition(board, 4);
    expect(pos0).toEqual({ row: 0, col: 0 });
    expect(pos4).toEqual({ row: 1, col: 1 });
  });

  it("spawnAt places tile and returns new board", () => {
    const board: Board = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const next = spawnAt(board, 1, 1, 1);
    expect(next).not.toBeNull();
    expect(next![1][1]).toBe(1);
    expect(board[1][1]).toBe(0);
  });

  it("spawnAt returns null if cell not empty", () => {
    const board: Board = [
      [1, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    expect(spawnAt(board, 0, 0, 1)).toBeNull();
  });

  it("spawnOne on empty board spawns at chosen index", () => {
    const board: Board = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const r = spawnOne(board, 0);
    expect(r.spawnedAt).toEqual({ row: 0, col: 0 });
    expect(r.board[0][0]).toBe(1);
  });

  it("spawnOne with no empty returns same board", () => {
    const board: Board = [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ];
    const r = spawnOne(board, 0);
    expect(r.board).toEqual(board);
    expect(r.spawnedAt).toBeNull();
  });
});

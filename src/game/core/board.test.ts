import { describe, it, expect } from "vitest";
import type { Board } from "./types";
import {
  createEmptyBoard,
  copyBoard,
  getEmptyCellPositions,
  getEmptyCount,
  boardEquals,
  getRow,
  getColumn,
  setRow,
  setColumn,
} from "./board";

describe("board", () => {
  it("createEmptyBoard returns 3x3 zeros", () => {
    const b = createEmptyBoard();
    expect(b.length).toBe(3);
    expect(b[0]).toEqual([0, 0, 0]);
    expect(b[1]).toEqual([0, 0, 0]);
    expect(b[2]).toEqual([0, 0, 0]);
  });

  it("getEmptyCellPositions returns all 9 for empty board", () => {
    const b = createEmptyBoard();
    const empty = getEmptyCellPositions(b);
    expect(empty.length).toBe(9);
  });

  it("getEmptyCellPositions returns correct positions when some filled", () => {
    const b: Board = [
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 0],
    ];
    const empty = getEmptyCellPositions(b);
    expect(empty.length).toBe(7);
    expect(empty).toContainEqual({ row: 0, col: 1 });
    expect(empty).toContainEqual({ row: 1, col: 0 });
  });

  it("getEmptyCount matches getEmptyCellPositions length", () => {
    const b: Board = [
      [1, 1, 0],
      [0, 0, 0],
      [0, 0, 8],
    ];
    expect(getEmptyCount(b)).toBe(getEmptyCellPositions(b).length);
    expect(getEmptyCount(b)).toBe(6);
  });

  it("boardEquals is true for same board", () => {
    const b = createEmptyBoard();
    expect(boardEquals(b, b)).toBe(true);
    const c = copyBoard(b);
    expect(boardEquals(b, c)).toBe(true);
  });

  it("boardEquals is false when different", () => {
    const a = createEmptyBoard();
    const b = copyBoard(a);
    b[0][0] = 1;
    expect(boardEquals(a, b as Board)).toBe(false);
  });

  it("getRow returns copy of row", () => {
    const b: Board = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 0],
    ];
    expect(getRow(b, 0)).toEqual([1, 2, 3]);
    expect(getRow(b, 1)).toEqual([4, 5, 6]);
  });

  it("getColumn returns correct column", () => {
    const b: Board = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 0],
    ];
    expect(getColumn(b, 0)).toEqual([1, 4, 7]);
    expect(getColumn(b, 2)).toEqual([3, 6, 0]);
  });

  it("setRow and setColumn produce new board", () => {
    const b = createEmptyBoard();
    const withRow = setRow(b, 0, [1, 1, 1]);
    expect(withRow[0]).toEqual([1, 1, 1]);
    expect(b[0]).toEqual([0, 0, 0]);

    const withCol = setColumn(withRow as Board, 1, [2, 2, 2]);
    expect(getColumn(withCol as Board, 1)).toEqual([2, 2, 2]);
  });
});

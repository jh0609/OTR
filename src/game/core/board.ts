/**
 * Board creation and read-only helpers.
 * Deterministic and testable.
 */

import type { Board, Cell } from "./types";
import { BOARD_SIZE } from "./types";

export function createEmptyBoard(): Board {
  return [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
}

/** Returns a mutable copy of the board. */
export function copyBoard(board: Board): Cell[][] {
  return board.map((row) => [...row]);
}

/** Returns positions of all empty cells, row-major order. */
export function getEmptyCellPositions(board: Board): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) out.push({ row: r, col: c });
    }
  }
  return out;
}

export function getEmptyCount(board: Board): number {
  return getEmptyCellPositions(board).length;
}

/** Deep equality of two boards. */
export function boardEquals(a: Board, b: Board): boolean {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

/** Get a single row (copy). */
export function getRow(board: Board, rowIndex: number): Cell[] {
  return [...board[rowIndex]];
}

/** Get a single column (copy). */
export function getColumn(board: Board, colIndex: number): Cell[] {
  return [board[0][colIndex], board[1][colIndex], board[2][colIndex]];
}

/** Set a row from a buffer of length BOARD_SIZE. Returns new board (copy). */
export function setRow(board: Board, rowIndex: number, row: readonly Cell[]): Cell[][] {
  const next = copyBoard(board);
  for (let c = 0; c < BOARD_SIZE; c++) next[rowIndex][c] = row[c];
  return next;
}

/** Set a column from a buffer. Returns new board (copy). */
export function setColumn(board: Board, colIndex: number, col: readonly Cell[]): Cell[][] {
  const next = copyBoard(board);
  for (let r = 0; r < BOARD_SIZE; r++) next[r][colIndex] = col[r];
  return next;
}

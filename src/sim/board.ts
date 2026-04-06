import type { Board } from "./types";

export const SIZE = 3;
export const LEN = 9;

/** Row-major index → (row, col). */
export function indexToRC(i: number): { r: number; c: number } {
  return { r: Math.floor(i / 3), c: i % 3 };
}

export function rcToIndex(r: number, c: number): number {
  return r * 3 + c;
}

export function emptyCount(board: Board): number {
  let n = 0;
  for (let i = 0; i < LEN; i++) if (board[i] === 0) n++;
  return n;
}

/** 보드 위 타일 레벨 최댓값 (빈 칸만이면 0). */
export function maxTileLevel(board: Board): number {
  let m = 0;
  for (let i = 0; i < LEN; i++) if (board[i] > m) m = board[i];
  return m;
}

export function boardEquals(a: Board, b: Board): boolean {
  for (let i = 0; i < LEN; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Immutable copy as readonly number[] */
export function freezeBoard(u: Uint8Array): Board {
  return Object.freeze(Array.from(u)) as Board;
}

export function toUint8(b: Board): Uint8Array {
  const u = new Uint8Array(LEN);
  for (let i = 0; i < LEN; i++) u[i] = b[i];
  return u;
}

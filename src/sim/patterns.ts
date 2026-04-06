import type { Board } from "./types";

export function extractTopRow(board: Board): [number, number, number] {
  return [board[0], board[1], board[2]];
}

/** 스네이크 경로(우하단 앵커 기준)에서 앞 3칸: 인덱스 8→7→6. */
export const SNAKE_HEAD3_INDICES: readonly [number, number, number] = [8, 7, 6];

export function extractTriple(
  board: Board,
  indices: readonly [number, number, number]
): [number, number, number] {
  return [board[indices[0]], board[indices[1]], board[indices[2]]];
}

function triMatch(a: number, b: number, c: number, x: number, y: number, z: number): boolean {
  return a === x && b === y && c === z;
}

/** 세 칸 값으로 6종 패턴 플래그 (top row 또는 snake head3 등에 재사용). */
export function detectPatternsFromTriple(a: number, b: number, c: number): {
  has012: boolean;
  has102: boolean;
  has120: boolean;
  has021: boolean;
  has020: boolean;
  has002: boolean;
} {
  return {
    has012: triMatch(a, b, c, 0, 1, 2),
    has102: triMatch(a, b, c, 1, 0, 2),
    has120: triMatch(a, b, c, 1, 2, 0),
    has021: triMatch(a, b, c, 0, 2, 1),
    has020: triMatch(a, b, c, 0, 2, 0),
    has002: triMatch(a, b, c, 0, 0, 2),
  };
}

export function detectPatterns(board: Board): {
  has012: boolean;
  has102: boolean;
  has120: boolean;
  has021: boolean;
  has020: boolean;
  has002: boolean;
} {
  const [a, b, c] = extractTopRow(board);
  return detectPatternsFromTriple(a, b, c);
}

/** `indices` 세 칸에 대해 패턴 감지 (스네이크 앞 3칸 등). */
export function detectPatternsAtIndices(
  board: Board,
  indices: readonly [number, number, number]
): ReturnType<typeof detectPatternsFromTriple> {
  const [a, b, c] = extractTriple(board, indices);
  return detectPatternsFromTriple(a, b, c);
}

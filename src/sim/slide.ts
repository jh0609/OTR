import type { Board, Direction, SlideResult } from "./types";
import { LEN, freezeBoard, toUint8 } from "./board";

/**
 * Slide one row to the left (2048 rules): merge equal adjacent once per pair, k+k → k+1.
 * 승리(win): **같은 라인에서** 8+8이 한 번 머지되어 9가 만들어질 때만 true (인접 8만으로는 불충분).
 */
function slideLineLeft(line: Uint8Array): { line: Uint8Array; win: boolean } {
  const nz: number[] = [];
  for (let i = 0; i < 3; i++) {
    if (line[i] !== 0) nz.push(line[i]);
  }
  const out = new Uint8Array(3);
  let win = false;
  let w = 0;
  let i = 0;
  while (i < nz.length) {
    const a = nz[i];
    const b = nz[i + 1];
    if (b !== undefined && a === b) {
      const merged = a + 1;
      if (a === 8 && b === 8) win = true;
      out[w++] = merged;
      i += 2;
    } else {
      out[w++] = a;
      i += 1;
    }
  }
  return { line: out, win };
}

function slideOnceWithWin(src: Uint8Array, dir: Direction): { dst: Uint8Array; moved: boolean; win: boolean } {
  const dst = new Uint8Array(LEN);
  let win = false;

  if (dir === "LEFT") {
    for (let r = 0; r < 3; r++) {
      const row = new Uint8Array([src[r * 3], src[r * 3 + 1], src[r * 3 + 2]]);
      const { line, win: w } = slideLineLeft(row);
      if (w) win = true;
      for (let c = 0; c < 3; c++) dst[r * 3 + c] = line[c];
    }
    let moved = false;
    for (let i = 0; i < LEN; i++) if (src[i] !== dst[i]) moved = true;
    return { dst, moved, win };
  }
  if (dir === "RIGHT") {
    for (let r = 0; r < 3; r++) {
      const row = new Uint8Array([src[r * 3 + 2], src[r * 3 + 1], src[r * 3]]);
      const { line, win: w } = slideLineLeft(row);
      if (w) win = true;
      for (let c = 0; c < 3; c++) dst[r * 3 + c] = line[2 - c];
    }
    let moved = false;
    for (let i = 0; i < LEN; i++) if (src[i] !== dst[i]) moved = true;
    return { dst, moved, win };
  }
  if (dir === "UP") {
    for (let c = 0; c < 3; c++) {
      const col = new Uint8Array([src[c], src[c + 3], src[c + 6]]);
      const { line, win: w } = slideLineLeft(col);
      if (w) win = true;
      for (let r = 0; r < 3; r++) dst[r * 3 + c] = line[r];
    }
    let moved = false;
    for (let i = 0; i < LEN; i++) if (src[i] !== dst[i]) moved = true;
    return { dst, moved, win };
  }
  // DOWN
  for (let c = 0; c < 3; c++) {
    const col = new Uint8Array([src[c + 6], src[c + 3], src[c]]);
    const { line, win: w } = slideLineLeft(col);
    if (w) win = true;
    for (let r = 0; r < 3; r++) dst[r * 3 + c] = line[2 - r];
  }
  let moved = false;
  for (let i = 0; i < LEN; i++) if (src[i] !== dst[i]) moved = true;
  return { dst, moved, win };
}

export function slide(board: Board, dir: Direction): SlideResult {
  const src = toUint8(board);
  const { dst, moved, win } = slideOnceWithWin(src, dir);
  return {
    next: freezeBoard(dst),
    moved,
    win,
  };
}

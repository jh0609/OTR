import type { Board, Direction, Policy } from "./types";
import { slide } from "./slide";
import { emptyCount, maxTileLevel } from "./board";
import { detectPatterns } from "./patterns";

const ORDER_LR: Direction[] = ["LEFT", "RIGHT"];
const ORDER_TIE: Direction[] = ["DOWN", "UP", "LEFT", "RIGHT"];

/** Snake path priority: high index = anchor corner (bottom-right). */
const SNAKE_WEIGHT: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function snakeScore(b: Board): number {
  let s = 0;
  for (let i = 0; i < 9; i++) s += b[i] * SNAKE_WEIGHT[i];
  return s;
}

function pickMaxScore(
  board: Board,
  actions: Direction[],
  score: (next: Board, dir: Direction) => number
): Direction {
  let best = actions[0];
  let bestV = -Infinity;
  for (const d of ORDER_TIE) {
    if (!actions.includes(d)) continue;
    const { next } = slide(board, d);
    const v = score(next, d);
    if (v > bestV) {
      bestV = v;
      best = d;
    }
  }
  return best;
}

export function makeRandomPolicy(rng: () => number): Policy {
  return (_board, actions) => actions[Math.floor(rng() * actions.length)];
}

/** Uses `Math.random` (not seeded). For Monte Carlo seeding, use `makeRandomPolicy(rng)`. */
export const randomPolicy: Policy = makeRandomPolicy(Math.random);

export const greedyEmptyPolicy: Policy = (board, actions) =>
  pickMaxScore(board, actions, (next) => emptyCount(next));

export const snakePolicy: Policy = (board, actions) =>
  pickMaxScore(board, actions, (next) => snakeScore(next));

export type AntiRandomConfig = {
  /** Preferred vertical when scores tie (default `'DOWN'`). */
  primaryVertical?: "DOWN" | "UP";
};

/**
 * Corner-anchored snake score, late-game empty pressure, `020` top-row bonus,
 * slight penalty for horizontal slides to reduce spawn entropy from left/right chaos.
 */
export function createAntiRandomPolicy(cfg?: AntiRandomConfig): Policy {
  const pv = cfg?.primaryVertical ?? "DOWN";
  return (board, actions) => {
    const mx = maxTileLevel(board);
    return pickMaxScore(board, actions, (next, dir) => {
      let s = snakeScore(next);
      const ec = emptyCount(next);
      if (mx >= 5) s -= ec * 0.4;
      if (detectPatterns(next).has020 && mx >= 4) s += 24;
      if (ORDER_LR.includes(dir)) s -= 2.5;
      if (dir === pv) s += 0.15;
      return s;
    });
  };
}

export const antiRandomPolicy: Policy = createAntiRandomPolicy();

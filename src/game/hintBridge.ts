/**
 * Phaser 게임 보드 ↔ sim `Board`(길이 9) 및 방향 매핑.
 */
import type { Board as GameBoard, Direction as GameDirection } from "./core/types";
import type { Board as SimBoard, Direction as SimDirection } from "../sim/types";

export function gameBoardToSim(board: GameBoard): SimBoard {
  const out: number[] = new Array(9);
  let i = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[i++] = board[r][c];
    }
  }
  return Object.freeze(out) as SimBoard;
}

const SIM_TO_GAME: Record<SimDirection, GameDirection> = {
  UP: "up",
  DOWN: "down",
  LEFT: "left",
  RIGHT: "right",
};

export function simDirectionToGame(d: SimDirection): GameDirection {
  return SIM_TO_GAME[d];
}

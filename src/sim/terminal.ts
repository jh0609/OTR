import type { Board, TerminalMode } from "./types";
import { legalActions } from "./legal";

/**
 * standard: no legal slide → terminal (lose).
 * strict: same, OR extraRule(board) === false → terminal (lose) when extraRule is provided.
 */
export function isTerminal(
  board: Board,
  mode: TerminalMode,
  extraRule?: (board: Board) => boolean
): boolean {
  if (legalActions(board).length === 0) return true;
  if (mode === "strict" && extraRule !== undefined && !extraRule(board)) return true;
  return false;
}

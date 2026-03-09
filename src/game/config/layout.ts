import { GAME_WIDTH, GAME_HEIGHT } from "./index";

export const HEADER_HEIGHT = 52;
export const SCORE_PANEL_TOP = 64;
export const SCORE_PANEL_HEIGHT = 72;
export const HERO_TOP = 148;
export const HERO_HEIGHT = 100;
export const BOARD_TOP = 268;
export const BOARD_MARGIN = 24;
export const BOARD_CELL_GAP = 8;

const boardWidth = GAME_WIDTH - BOARD_MARGIN * 2;
export const BOARD_SIZE_PX = boardWidth;
export const CELL_SIZE = (boardWidth - BOARD_CELL_GAP * 2) / 3;

export const COLORS = {
  headerBg: "#ffffff",
  headerText: "#333333",
  scorePanelBg: "#ffffff",
  scorePanelShadow: "rgba(0,0,0,0.08)",
  scoreText: "#2d2d2d",
  bestText: "#666666",
  cellBg: "#e8dcc8",
  cellShadow: "rgba(0,0,0,0.06)",
  overlayBg: "rgba(0,0,0,0.5)",
  overlayCard: "#ffffff",
  overlayText: "#2d2d2d",
  buttonBg: "#7bb8d4",
  buttonText: "#ffffff",
  skyTop: "#a8d4f0",
  skyBottom: "#e8f4f8",
} as const;

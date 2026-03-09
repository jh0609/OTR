/**
 * Pure game logic for Over the Rainbow.
 * No Phaser or DOM dependencies.
 */

export {
  BOARD_SIZE,
  TILE_LEVELS,
  DIRECTIONS,
  type Board,
  type Cell,
  type CellPosition,
  type Direction,
  type MoveResult,
  type SpawnLevel,
  type StepResult,
  type TileLevel,
} from "./types";

export {
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

export { getMergeScore } from "./score";

export {
  slideRowLeft,
  slideRowRight,
  slideColumnUp,
  slideColumnDown,
  type SlideRowResult,
  type SlideColumnResult,
} from "./merge";

export { applyMove } from "./move";

export {
  pickEmptyPosition,
  spawnAt,
  spawnOne,
} from "./spawn";

export { hasWon, isGameOver, step } from "./game";
export { initGame } from "./init";

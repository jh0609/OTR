/**
 * Game constants and shared config values.
 */

export const GAME_TITLE = "Over the Rainbow";

export const SCENE_KEYS = {
  BOOT: "Boot",
  GAME: "Game",
  UI: "UI",
} as const;

export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];

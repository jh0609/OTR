import Phaser from "phaser";
import type { Types } from "phaser";
import { BootScene } from "../scenes/BootScene";
import { GameScene } from "../scenes/GameScene";
import { UIScene } from "../scenes/UIScene";

/** Mobile portrait design size. */
export const GAME_WIDTH = 390;
export const GAME_HEIGHT = 844;

export function getPhaserConfig(container: HTMLElement): Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: container,
    backgroundColor: "#e8f4f8",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, GameScene, UIScene],
  };
}

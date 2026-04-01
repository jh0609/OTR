import Phaser from "phaser";
import type { Types } from "phaser";
import { BootScene } from "../scenes/BootScene";
import { GameScene } from "../scenes/GameScene";
import { UIScene } from "../scenes/UIScene";
import { GAME_WIDTH, GAME_HEIGHT } from "./dimensions";

export { GAME_WIDTH, GAME_HEIGHT };

export function getPhaserConfig(container: HTMLElement): Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: container,
    backgroundColor: "#e8f4f8",
    render: {
      antialias: true,
      antialiasGL: true,
      roundPixels: true,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, GameScene, UIScene],
  };
}

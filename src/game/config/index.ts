import Phaser from "phaser";
import type { Types } from "phaser";
import { BootScene } from "../scenes/BootScene";
import { GameScene } from "../scenes/GameScene";
import { UIScene } from "../scenes/UIScene";
import { GAME_WIDTH, GAME_HEIGHT } from "./dimensions";

export { GAME_WIDTH, GAME_HEIGHT };

export function getPhaserConfig(container: HTMLElement): Types.Core.GameConfig {
  const dpr =
    typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
  // HiDPI supersampling: improve sprite edge quality while capping GPU cost.
  const renderResolution = Math.min(Math.max(dpr, 1), 3);

  const config = {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: container,
    backgroundColor: "#e8f4f8",
    resolution: renderResolution,
    render: {
      antialias: true,
      antialiasGL: true,
      roundPixels: false,
      pixelArt: false,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, GameScene, UIScene],
  };

  return config as unknown as Types.Core.GameConfig;
}

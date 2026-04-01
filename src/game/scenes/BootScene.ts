import Phaser from "phaser";
import { SCENE_KEYS } from "../constants";
import { initGame } from "../core";
import { getBestScore } from "../storage";
import { TILE_TEXTURE_SOURCES } from "../assets";
import {
  REG_BOARD,
  REG_SCORE,
  REG_BEST,
  REG_GAMEOVER,
  REG_HASWON,
  REG_WIN_DISMISSED,
} from "../registry";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.BOOT });
  }

  preload(): void {
    TILE_TEXTURE_SOURCES.forEach(({ key, path }) => {
      this.load.image(key, path);
    });
  }

  create(): void {
    // Keep smooth filtering for downscaled tile sprites.
    TILE_TEXTURE_SOURCES.forEach(({ key }) => {
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    });

    const i1 = Math.floor(Math.random() * 9);
    let i2 = Math.floor(Math.random() * 8);
    const board = initGame(i1, i2);

    this.registry.set(REG_BOARD, board);
    this.registry.set(REG_SCORE, 0);
    this.registry.set(REG_BEST, getBestScore());
    this.registry.set(REG_GAMEOVER, false);
    this.registry.set(REG_HASWON, false);
    this.registry.set(REG_WIN_DISMISSED, false);

    this.scene.start(SCENE_KEYS.GAME);
    this.scene.launch(SCENE_KEYS.UI);
  }
}

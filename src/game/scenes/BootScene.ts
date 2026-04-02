import Phaser from "phaser";
import { SCENE_KEYS } from "../constants";
import { initGame } from "../core";
import { getBestScore, getAnimationSpeedPercent, getTextBaseSize, getQuickResetEnabled, getSwipeThreshold } from "../storage";
import { TILE_TEXTURE_SOURCES } from "../assets";
import {
  REG_BOARD,
  REG_SCORE,
  REG_BEST,
  REG_GAMEOVER,
  REG_HASWON,
  REG_WIN_DISMISSED,
  REG_ANIM_SPEED_PERCENT,
  REG_TEXT_BASE_SIZE,
  REG_UI_MODAL_OPEN,
  REG_QUICK_RESET_ENABLED,
  REG_SWIPE_THRESHOLD,
  REG_WIN_EFFECT_DONE,
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

    const board = initGame(
      Math.floor(Math.random() * 9),
      Math.floor(Math.random() * 8)
    );

    this.registry.set(REG_BOARD, board);
    this.registry.set(REG_SCORE, 0);
    this.registry.set(REG_BEST, getBestScore());
    this.registry.set(REG_GAMEOVER, false);
    this.registry.set(REG_HASWON, false);
    this.registry.set(REG_WIN_DISMISSED, false);
    this.registry.set(REG_ANIM_SPEED_PERCENT, getAnimationSpeedPercent());
    this.registry.set(REG_TEXT_BASE_SIZE, getTextBaseSize());
    this.registry.set(REG_UI_MODAL_OPEN, false);
    this.registry.set(REG_QUICK_RESET_ENABLED, getQuickResetEnabled());
    this.registry.set(REG_SWIPE_THRESHOLD, getSwipeThreshold());
    this.registry.set(REG_WIN_EFFECT_DONE, true);

    this.scene.start(SCENE_KEYS.GAME);
    this.scene.launch(SCENE_KEYS.UI);
  }
}

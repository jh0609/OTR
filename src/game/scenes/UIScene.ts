import Phaser from "phaser";
import { SCENE_KEYS } from "../constants";
import { GAME_TITLE } from "../constants";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";
import {
  HEADER_HEIGHT,
  SCORE_PANEL_TOP,
  SCORE_PANEL_HEIGHT,
  HERO_TOP,
  HERO_HEIGHT,
  COLORS,
} from "../config/layout";
import {
  REG_SCORE,
  REG_BEST,
  REG_BOARD,
  REG_GAMEOVER,
  REG_HASWON,
  REG_WIN_DISMISSED,
} from "../registry";

const CLOSE_BTN_SIZE = 44;

export class UIScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private progressText!: Phaser.GameObjects.Text;
  private winOverlay!: Phaser.GameObjects.Container;
  private gameOverOverlay!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: SCENE_KEYS.UI });
  }

  create(): void {
    this.drawHeader();
    this.drawScorePanel();
    this.drawHero();
    this.drawOverlays();
    this.refreshFromRegistry();
    // Listen to global game events so GameScene can notify us.
    this.game.events.on("stateChanged", this.refreshFromRegistry, this);
  }

  private drawHeader(): void {
    const g = this.add.graphics();
    g.fillStyle(parseInt(COLORS.headerBg.slice(1), 16), 1);
    g.fillRect(0, 0, GAME_WIDTH, HEADER_HEIGHT);

    const title = this.add.text(20, HEADER_HEIGHT / 2, GAME_TITLE, {
      fontSize: "18px",
      color: COLORS.headerText,
    }).setOrigin(0, 0.5);

    const closeX = GAME_WIDTH - 16;
    const closeBtn = this.add.text(closeX, HEADER_HEIGHT / 2, "Home", {
      fontSize: "14px",
      color: COLORS.headerText,
      backgroundColor: "#f2f4f7",
    }).setOrigin(1, 0.5).setPadding(10, 6).setInteractive(
      { useHandCursor: true, hitArea: new Phaser.Geom.Rectangle(-CLOSE_BTN_SIZE / 2, -CLOSE_BTN_SIZE / 2, CLOSE_BTN_SIZE, CLOSE_BTN_SIZE), hitAreaCallback: Phaser.Geom.Rectangle.Contains }
    );
    closeBtn.on("pointerdown", () => {
      this.scene.start(SCENE_KEYS.BOOT);
    });
  }

  private drawScorePanel(): void {
    const panelWidth = GAME_WIDTH - 48;
    const panelX = 24;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.08);
    g.fillRoundedRect(panelX + 2, SCORE_PANEL_TOP + 2, panelWidth, SCORE_PANEL_HEIGHT, 16);
    g.fillStyle(parseInt(COLORS.scorePanelBg.slice(1), 16), 1);
    g.fillRoundedRect(panelX, SCORE_PANEL_TOP, panelWidth, SCORE_PANEL_HEIGHT, 16);

    this.scoreText = this.add.text(GAME_WIDTH / 2, SCORE_PANEL_TOP + 33, "0", {
      fontSize: "40px",
      color: COLORS.scoreText,
      fontStyle: "700",
    }).setOrigin(0.5);

    this.bestText = this.add.text(GAME_WIDTH / 2, SCORE_PANEL_TOP + 67, "Best: 0", {
      fontSize: "14px",
      color: COLORS.bestText,
    }).setOrigin(0.5);

    this.hintText = this.add.text(GAME_WIDTH / 2, SCORE_PANEL_TOP + SCORE_PANEL_HEIGHT + 14, "Swipe to move", {
      fontSize: "14px",
      color: "#667085",
    }).setOrigin(0.5);
  }

  private drawHero(): void {
    const g = this.add.graphics();
    const top = parseInt(COLORS.skyTop.slice(1), 16);
    const bottom = parseInt(COLORS.skyBottom.slice(1), 16);
    g.fillGradientStyle(top, top, bottom, bottom, 1, 1, 1, 1);
    g.fillRect(0, HERO_TOP, GAME_WIDTH, HERO_HEIGHT);

    const cy = HERO_TOP + HERO_HEIGHT / 2;
    const arcRadius = Math.min(GAME_WIDTH * 0.45, 160);
    const arcY = cy + 15;
    for (let i = 0; i < 5; i++) {
      const colors = [0xe8a0a0, 0xe8c090, 0xf0e890, 0xa8d8a0, 0x90d8d8];
      g.lineStyle(10, colors[i], 0.5);
      g.beginPath();
      g.arc(GAME_WIDTH / 2, arcY, arcRadius - i * 12, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340), false);
      g.strokePath();
    }

    const cloudY = HERO_TOP + 25;
    g.fillStyle(0xffffff, 0.9);
    g.fillEllipse(80, cloudY, 40, 22);
    g.fillEllipse(105, cloudY - 5, 35, 20);
    g.fillEllipse(95, cloudY + 5, 38, 18);
    g.fillEllipse(130, cloudY, 35, 20);
    g.fillEllipse(300, cloudY + 10, 45, 24);
    g.fillEllipse(325, cloudY + 5, 38, 20);
    g.fillEllipse(315, cloudY + 12, 40, 18);

    this.progressText = this.add.text(GAME_WIDTH / 2, HERO_TOP + HERO_HEIGHT - 14, "Rainbow progress: 1/8", {
      fontSize: "12px",
      color: "#4b5563",
    }).setOrigin(0.5);
  }

  private drawOverlays(): void {
    const cardW = GAME_WIDTH - 48;
    const cardH = 160;
    const cardX = 24;
    const cardY = (GAME_HEIGHT - cardH) / 2;
    const overlayBtnH = 44;

    const makeGameOverOverlay = () => {
      const bg = this.add.graphics();
      bg.fillStyle(0x000000, 0.5);
      bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      const card = this.add.graphics();
      card.fillStyle(parseInt(COLORS.overlayCard.slice(1), 16), 1);
      card.fillRoundedRect(cardX, cardY, cardW, cardH, 16);
      const titleText = this.add.text(GAME_WIDTH / 2, cardY + 44, "No more moves", {
        fontSize: "18px",
        color: COLORS.overlayText,
      }).setOrigin(0.5);
      const btnY = cardY + 79 + overlayBtnH / 2;
      const restartBtn = this.add.text(GAME_WIDTH / 2, btnY, "Play again", {
        fontSize: "16px",
        color: COLORS.buttonText,
      }).setOrigin(0.5).setPadding(24, 14).setInteractive({ useHandCursor: true });
      const btnBg = this.add.graphics();
      btnBg.fillStyle(parseInt(COLORS.buttonBg.slice(1), 16), 1);
      btnBg.fillRoundedRect(cardX + cardW / 2 - 60, cardY + 79, 120, overlayBtnH, 12);
      restartBtn.on("pointerdown", () => this.scene.start(SCENE_KEYS.BOOT));
      return this.add.container(0, 0, [bg, card, titleText, btnBg, restartBtn]);
    };

    const winCardH = cardH + 28;
    const winCardY = (GAME_HEIGHT - winCardH) / 2;
    const makeWinOverlay = () => {
      const bg = this.add.graphics();
      bg.fillStyle(0x000000, 0.5);
      bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      const card = this.add.graphics();
      card.fillStyle(parseInt(COLORS.overlayCard.slice(1), 16), 1);
      card.fillRoundedRect(cardX, winCardY, cardW, winCardH, 16);
      const titleText = this.add.text(GAME_WIDTH / 2, winCardY + 40, "You reached\nthe rainbow!", {
        fontSize: "18px",
        color: COLORS.overlayText,
        align: "center",
      }).setOrigin(0.5);
      const winBtnY = winCardY + 114;
      const continueBtn = this.add.text(GAME_WIDTH / 2 - 55, winBtnY, "Continue", {
        fontSize: "15px",
        color: COLORS.buttonText,
      }).setOrigin(0.5).setPadding(16, 12).setInteractive({ useHandCursor: true });
      const restartBtn = this.add.text(GAME_WIDTH / 2 + 55, winBtnY, "Play again", {
        fontSize: "15px",
        color: COLORS.buttonText,
      }).setOrigin(0.5).setPadding(16, 12).setInteractive({ useHandCursor: true });
      const g = this.add.graphics();
      g.fillStyle(parseInt(COLORS.buttonBg.slice(1), 16), 1);
      g.fillRoundedRect(cardX + 24, winCardY + 92, 100, overlayBtnH, 10);
      g.fillRoundedRect(cardX + cardW - 124, winCardY + 92, 100, overlayBtnH, 10);
      continueBtn.on("pointerdown", () => {
        this.registry.set(REG_WIN_DISMISSED, true);
        this.winOverlay.setVisible(false);
      });
      restartBtn.on("pointerdown", () => this.scene.start(SCENE_KEYS.BOOT));
      return this.add.container(0, 0, [bg, card, titleText, g, continueBtn, restartBtn]);
    };

    this.winOverlay = makeWinOverlay();
    this.winOverlay.setVisible(false);
    this.gameOverOverlay = makeGameOverOverlay();
    this.gameOverOverlay.setVisible(false);
  }

  private refreshFromRegistry(): void {
    const score = this.registry.get(REG_SCORE) as number;
    const best = this.registry.get(REG_BEST) as number;
    const board = this.registry.get(REG_BOARD) as number[][] | undefined;
    const gameOver = this.registry.get(REG_GAMEOVER) as boolean;
    const hasWon = this.registry.get(REG_HASWON) as boolean;

    this.scoreText.setText(String(score));
    this.bestText.setText("Best: " + best);
    const maxLevel = board ? Math.max(...board.flat()) : 1;
    if (this.progressText) this.progressText.setText("Rainbow progress: " + maxLevel + "/8");
    if (this.hintText) this.hintText.setVisible(score === 0);

    const winDismissed = this.registry.get(REG_WIN_DISMISSED) as boolean;
    this.winOverlay.setVisible(hasWon && !gameOver && !winDismissed);
    this.gameOverOverlay.setVisible(gameOver);
  }
}

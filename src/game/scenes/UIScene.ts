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
    const cardW = GAME_WIDTH - 44;
    const cardX = 22;
    const cardH = 228;
    const cardY = (GAME_HEIGHT - cardH) / 2;

    const drawButton = (
      x: number,
      y: number,
      width: number,
      height: number,
      label: string,
      isPrimary: boolean
    ): Phaser.GameObjects.Container => {
      const g = this.add.graphics();
      const radius = 12;
      if (isPrimary) {
        g.fillStyle(0x000000, 0.16);
        g.fillRoundedRect(x, y + 3, width, height, radius);
        g.fillStyle(0xff6f61, 1);
        g.fillRoundedRect(x, y, width, height, radius);
      } else {
        g.fillStyle(0x000000, 0.08);
        g.fillRoundedRect(x, y + 2, width, height, radius);
        g.fillStyle(0xffffff, 0.95);
        g.fillRoundedRect(x, y, width, height, radius);
        g.lineStyle(2, 0xe5e7eb, 1);
        g.strokeRoundedRect(x + 1, y + 1, width - 2, height - 2, radius - 1);
      }
      const txt = this.add.text(x + width / 2, y + height / 2, label, {
        fontSize: "16px",
        color: isPrimary ? "#ffffff" : "#374151",
        fontStyle: "700",
      }).setOrigin(0.5);
      return this.add.container(0, 0, [g, txt]);
    };

    const drawOverlayCard = (accentColor: number): Phaser.GameObjects.Graphics => {
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.2);
      g.fillRoundedRect(cardX, cardY + 6, cardW, cardH, 20);
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(cardX, cardY, cardW, cardH, 20);
      g.lineStyle(2, 0xe5e7eb, 1);
      g.strokeRoundedRect(cardX + 1, cardY + 1, cardW - 2, cardH - 2, 19);
      g.fillStyle(accentColor, 0.95);
      g.fillRoundedRect(cardX + 18, cardY + 18, cardW - 36, 34, 10);
      return g;
    };

    const makeGameOverOverlay = () => {
      const bg = this.add.graphics();
      bg.fillStyle(0x0b1020, 0.58);
      bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      const card = drawOverlayCard(0xf97316);
      const ribbon = this.add.text(GAME_WIDTH / 2, cardY + 35, "●", {
        fontSize: "18px",
        color: "#ffffff",
        fontStyle: "700",
      }).setOrigin(0.5);
      const title = this.add.text(GAME_WIDTH / 2, cardY + 90, "!", {
        fontSize: "56px",
        color: "#1f2937",
        fontStyle: "700",
      }).setOrigin(0.5);
      const subtitle = this.add.text(GAME_WIDTH / 2, cardY + 132, " ", {
        fontSize: "1px",
        color: "#6b7280",
      }).setOrigin(0.5);

      const restartBtn = drawButton(cardX + 34, cardY + cardH - 62, cardW - 68, 46, "↻", true);
      restartBtn.setInteractive(
        new Phaser.Geom.Rectangle(cardX + 34, cardY + cardH - 62, cardW - 68, 46),
        Phaser.Geom.Rectangle.Contains
      );
      restartBtn.on("pointerdown", () => this.scene.start(SCENE_KEYS.BOOT));

      return this.add.container(0, 0, [bg, card, ribbon, title, subtitle, restartBtn]);
    };

    const makeWinOverlay = () => {
      const bg = this.add.graphics();
      bg.fillStyle(0x0b1020, 0.52);
      bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      const card = drawOverlayCard(0x22c55e);
      const ribbon = this.add.text(GAME_WIDTH / 2, cardY + 35, "●", {
        fontSize: "18px",
        color: "#ffffff",
        fontStyle: "700",
      }).setOrigin(0.5);
      const title = this.add.text(GAME_WIDTH / 2, cardY + 90, "★", {
        fontSize: "52px",
        color: "#1f2937",
        fontStyle: "700",
      }).setOrigin(0.5);
      const subtitle = this.add.text(GAME_WIDTH / 2, cardY + 132, " ", {
        fontSize: "1px",
        color: "#6b7280",
      }).setOrigin(0.5);

      const continueBtn = drawButton(cardX + 18, cardY + cardH - 62, 154, 46, "▶", false);
      const restartBtn = drawButton(cardX + cardW - 172, cardY + cardH - 62, 154, 46, "↻", true);

      continueBtn.setInteractive(
        new Phaser.Geom.Rectangle(cardX + 18, cardY + cardH - 62, 154, 46),
        Phaser.Geom.Rectangle.Contains
      );
      restartBtn.setInteractive(
        new Phaser.Geom.Rectangle(cardX + cardW - 172, cardY + cardH - 62, 154, 46),
        Phaser.Geom.Rectangle.Contains
      );

      continueBtn.on("pointerdown", () => {
        this.registry.set(REG_WIN_DISMISSED, true);
        this.winOverlay.setVisible(false);
      });
      restartBtn.on("pointerdown", () => this.scene.start(SCENE_KEYS.BOOT));

      return this.add.container(0, 0, [bg, card, ribbon, title, subtitle, continueBtn, restartBtn]);
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

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
  REG_GAMEOVER,
  REG_ANIM_SPEED_PERCENT,
  REG_TEXT_BASE_SIZE,
  REG_UI_MODAL_OPEN,
  REG_QUICK_RESET_ENABLED,
  REG_SWIPE_THRESHOLD,
  REG_UNDO_AVAILABLE,
  REG_HINT_BUSY,
  REG_SHOW_DRAG_TRACE,
} from "../registry";
import {
  setAnimationSpeedPercent,
  setTextBaseSize,
  setQuickResetEnabled,
  setSwipeThreshold,
  setShowDragTrace,
} from "../storage";

const CLOSE_BTN_SIZE = 44;

export class UIScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private winOverlay!: Phaser.GameObjects.Container;
  private gameOverOverlay!: Phaser.GameObjects.Container;
  private optionsOverlay!: Phaser.GameObjects.Container;
  private resetConfirmOverlay!: Phaser.GameObjects.Container;
  private animSpeedValueText!: Phaser.GameObjects.Text;
  private animSliderFill!: Phaser.GameObjects.Graphics;
  private animSliderKnob!: Phaser.GameObjects.Arc;
  private animSliderX = 0;
  private animSliderY = 0;
  private animSliderW = 0;
  private animSliderH = 0;
  private textSizeOffsetValueText!: Phaser.GameObjects.Text;
  private textBaseSize = 15;
  private static readonly DEFAULT_TEXT_BASE_SIZE = 15;
  private quickResetEnabled = false;
  private quickResetValueText!: Phaser.GameObjects.Text;
  private heroPulseOverlay!: Phaser.GameObjects.Rectangle;
  private heroAbsorbShimmer!: Phaser.GameObjects.Arc;
  private rainbowTravelOrb: Phaser.GameObjects.Container | null = null;
  private rainbowTravelTrail: Phaser.GameObjects.Graphics | null = null;
  private rainbowTravelPoints: Array<{ x: number; y: number }> = [];
  private swipeThresholdValueText!: Phaser.GameObjects.Text;
  private swipeSliderFill!: Phaser.GameObjects.Graphics;
  private swipeSliderKnob!: Phaser.GameObjects.Arc;
  private swipeSliderX = 0;
  private swipeSliderY = 0;
  private swipeSliderW = 0;
  private swipeSliderH = 0;
  private hintBtn!: Phaser.GameObjects.Text;
  private undoBtn!: Phaser.GameObjects.Text;
  private inputTraceEnabled = false;
  private inputTraceValueText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: SCENE_KEYS.UI });
  }

  create(): void {
    this.drawHeader();
    this.drawScorePanel();
    this.drawHero();
    this.drawOverlays();
    this.drawOptionsOverlay();
    this.drawResetConfirmOverlay();
    this.initTextResizeState();
    this.refreshFromRegistry();
    // Listen to global game events so GameScene can notify us.
    this.game.events.on("stateChanged", this.refreshFromRegistry, this);
    this.game.events.on("rainbowClimax", this.playRainbowHeroPulse, this);
    this.game.events.on("rainbowAbsorb", this.playRainbowAbsorbReaction, this);
    this.game.events.on("rainbowTravelStart", this.onRainbowTravelStart, this);
    this.game.events.on("rainbowTravelUpdate", this.onRainbowTravelUpdate, this);
    this.game.events.on("rainbowTravelComplete", this.onRainbowTravelComplete, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off("stateChanged", this.refreshFromRegistry, this);
      this.game.events.off("rainbowClimax", this.playRainbowHeroPulse, this);
      this.game.events.off("rainbowAbsorb", this.playRainbowAbsorbReaction, this);
      this.game.events.off("rainbowTravelStart", this.onRainbowTravelStart, this);
      this.game.events.off("rainbowTravelUpdate", this.onRainbowTravelUpdate, this);
      this.game.events.off("rainbowTravelComplete", this.onRainbowTravelComplete, this);
    });
  }

  private drawHeader(): void {
    const g = this.add.graphics();
    g.fillStyle(parseInt(COLORS.headerBg.slice(1), 16), 1);
    g.fillRect(0, 0, GAME_WIDTH, HEADER_HEIGHT);
    g.lineStyle(1, 0xe5e7eb, 1);
    g.lineBetween(0, HEADER_HEIGHT - 0.5, GAME_WIDTH, HEADER_HEIGHT - 0.5);

    // Left: title (does not run into icon toolbar).
    const headerPadX = 16;
    const headerPadR = 14;
    const iconSlot = 54;
    const titleMaxWidth = GAME_WIDTH - headerPadX - headerPadR - iconSlot * 4 - 8;
    const title = this.add.text(headerPadX, HEADER_HEIGHT / 2, GAME_TITLE, {
      fontSize: "17px",
      color: "#0f172a",
      fontStyle: "700",
      stroke: "#ffffff",
      strokeThickness: 1,
      wordWrap: { width: Math.max(120, titleMaxWidth) },
      maxLines: 2,
      align: "left",
    }).setOrigin(0, 0.5);

    // Right: [ Undo ] [ Option ] [ Reset ] — fixed spacing from screen right.
    const cy = HEADER_HEIGHT / 2;
    const xReset = GAME_WIDTH - headerPadR;
    const xOption = xReset - iconSlot;
    const xUndo = xOption - iconSlot;
    const xHint = xUndo - iconSlot;

    this.hintBtn = this.add.text(xHint, cy, "?", {
      fontSize: "20px",
      color: "#111827",
      fontStyle: "700",
      backgroundColor: "#f2f4f7",
    }).setOrigin(1, 0.5).setPadding(12, 8).setInteractive({ useHandCursor: true });
    this.hintBtn.on("pointerdown", () => {
      this.game.events.emit("requestHint");
    });

    this.undoBtn = this.add.text(xUndo, cy, "↶", {
      fontSize: "20px",
      color: "#111827",
      fontStyle: "700",
      backgroundColor: "#f2f4f7",
    }).setOrigin(1, 0.5).setPadding(12, 8).setInteractive({ useHandCursor: true });
    this.undoBtn.on("pointerdown", () => {
      this.game.events.emit("requestUndo");
    });

    const optionBtn = this.add.text(xOption, cy, "⚙", {
      fontSize: "20px",
      color: "#111827",
      fontStyle: "700",
      backgroundColor: "#f2f4f7",
    }).setOrigin(1, 0.5).setPadding(12, 8).setInteractive({ useHandCursor: true });
    optionBtn.on("pointerdown", () => {
      this.registry.set(REG_UI_MODAL_OPEN, true);
      this.game.events.emit("clearBufferedInput");
      this.optionsOverlay.setVisible(true);
    });

    const closeBtn = this.add.text(xReset, cy, "↻", {
      fontSize: "20px",
      color: "#111827",
      fontStyle: "700",
      backgroundColor: "#f2f4f7",
    }).setOrigin(1, 0.5).setPadding(12, 8).setInteractive({ useHandCursor: true });
    closeBtn.on("pointerdown", () => {
      if (this.quickResetEnabled) {
        this.scene.start(SCENE_KEYS.BOOT);
        return;
      }
      this.openResetConfirmOverlay();
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
      color: "#0f172a",
      fontStyle: "700",
      stroke: "#ffffff",
      strokeThickness: 1,
    }).setOrigin(0.5);

    this.bestText = this.add.text(GAME_WIDTH / 2, SCORE_PANEL_TOP + 67, "Best: 0", {
      fontSize: "15px",
      color: "#1f2937",
      fontStyle: "700",
    }).setOrigin(0.5);

    this.hintText = this.add.text(GAME_WIDTH / 2, SCORE_PANEL_TOP + SCORE_PANEL_HEIGHT + 14, "Swipe to move", {
      fontSize: "15px",
      color: "#374151",
      fontStyle: "700",
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
    this.heroPulseOverlay = this.add.rectangle(
      GAME_WIDTH / 2,
      HERO_TOP + HERO_HEIGHT / 2,
      GAME_WIDTH,
      HERO_HEIGHT,
      0xffffff,
      0
    );
    this.heroPulseOverlay.setDepth(5);
    this.heroAbsorbShimmer = this.add.circle(GAME_WIDTH / 2, arcY, Math.round(arcRadius * 0.42), 0xffffff, 0);
    this.heroAbsorbShimmer.setDepth(6);

  }

  private playRainbowHeroPulse(): void {
    if (!this.heroPulseOverlay) return;
    this.heroPulseOverlay.setAlpha(0);
    this.tweens.add({
      targets: this.heroPulseOverlay,
      alpha: { from: 0, to: 0.18 },
      yoyo: true,
      duration: 180,
      ease: "Sine.easeOut",
    });
  }

  private playRainbowAbsorbReaction(): void {
    if (!this.heroAbsorbShimmer) return;
    this.heroAbsorbShimmer.setAlpha(0);
    this.heroAbsorbShimmer.setScale(0.9);
    this.tweens.add({
      targets: this.heroAbsorbShimmer,
      alpha: { from: 0, to: 0.22 },
      scale: { from: 0.9, to: 1.06 },
      yoyo: true,
      duration: 160,
      ease: "Sine.easeOut",
    });
  }

  private onRainbowTravelStart(payload: { x: number; y: number }): void {
    if (this.rainbowTravelOrb) this.rainbowTravelOrb.destroy();
    if (this.rainbowTravelTrail) this.rainbowTravelTrail.destroy();
    this.rainbowTravelPoints = [];
    void payload;
  }

  private onRainbowTravelUpdate(payload: { x: number; y: number }): void {
    if (!this.rainbowTravelOrb || !this.rainbowTravelTrail) {
      const orb = this.add.container(payload.x, payload.y);
      orb.setDepth(30);
      orb.setScale(0.75);
      orb.setAlpha(0.95);
      const aura = this.add.circle(0, 0, 24, 0x60a5fa, 0.35);
      const shell = this.add.circle(0, 0, 18, 0xffffff, 0.92);
      const core = this.add.circle(0, 0, 12, 0xf472b6, 0.78);
      const highlight = this.add.circle(-5, -6, 4, 0xffffff, 0.9);
      orb.add([aura, shell, core, highlight]);
      this.rainbowTravelOrb = orb;

      const trail = this.add.graphics();
      trail.setDepth(29);
      this.rainbowTravelTrail = trail;
    }
    if (!this.rainbowTravelOrb || !this.rainbowTravelTrail) return;
    this.rainbowTravelOrb.setPosition(payload.x, payload.y);
    this.rainbowTravelPoints.push({ x: payload.x, y: payload.y });
    if (this.rainbowTravelPoints.length > 10) this.rainbowTravelPoints.shift();
    this.rainbowTravelTrail.clear();
    this.rainbowTravelPoints.forEach((p, i) => {
      const a = (i + 1) / this.rainbowTravelPoints.length;
      this.rainbowTravelTrail?.fillStyle(0xffffff, a * 0.23);
      this.rainbowTravelTrail?.fillCircle(p.x, p.y, 2 + a * 2.6);
    });
  }

  private onRainbowTravelComplete(): void {
    if (!this.rainbowTravelOrb) return;
    const orb = this.rainbowTravelOrb;
    this.tweens.add({
      targets: orb,
      alpha: 0,
      scale: 1.25,
      duration: 160,
      ease: "Sine.easeOut",
      onComplete: () => {
        orb.destroy();
        this.rainbowTravelOrb = null;
        if (this.rainbowTravelTrail) {
          this.rainbowTravelTrail.destroy();
          this.rainbowTravelTrail = null;
        }
        this.rainbowTravelPoints = [];
      },
    });
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
        fontSize: "20px",
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
      bg.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT),
        Phaser.Geom.Rectangle.Contains
      );
      bg.on("pointerdown", () => {});

      const card = drawOverlayCard(0xf97316);
      const title = this.add.text(GAME_WIDTH / 2, cardY + 92, "GAME OVER", {
        fontSize: "34px",
        color: "#111827",
        fontStyle: "700",
        stroke: "#ffffff",
        strokeThickness: 1,
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

      return this.add.container(0, 0, [bg, card, title, subtitle, restartBtn]);
    };

    const makeWinOverlay = () => {
      const bg = this.add.graphics();
      bg.fillStyle(0x0b1020, 0.52);
      bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      bg.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT),
        Phaser.Geom.Rectangle.Contains
      );
      bg.on("pointerdown", () => {});

      const card = drawOverlayCard(0x22c55e);
      const title = this.add.text(GAME_WIDTH / 2, cardY + 92, "VICTORY", {
        fontSize: "36px",
        color: "#111827",
        fontStyle: "700",
        stroke: "#ffffff",
        strokeThickness: 1,
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
        this.game.events.emit("clearBufferedInput");
        this.winOverlay.setVisible(false);
      });
      restartBtn.on("pointerdown", () => this.scene.start(SCENE_KEYS.BOOT));

      return this.add.container(0, 0, [bg, card, title, subtitle, continueBtn, restartBtn]);
    };

    this.winOverlay = makeWinOverlay();
    this.winOverlay.setVisible(false);
    this.gameOverOverlay = makeGameOverOverlay();
    this.gameOverOverlay.setVisible(false);
  }

  private drawOptionsOverlay(): void {
    const cardW = GAME_WIDTH - 72;
    const cardH = 420;
    const cardX = (GAME_WIDTH - cardW) / 2;
    const cardY = (GAME_HEIGHT - cardH) / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x0b1020, 0.5);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    bg.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT),
      Phaser.Geom.Rectangle.Contains
    );
    bg.on("pointerdown", () => {
      // Block click-through. Close via explicit close button.
    });

    const persistOptionsSlidersToStorage = (): void => {
      const anim = this.registry.get(REG_ANIM_SPEED_PERCENT);
      if (typeof anim === "number") setAnimationSpeedPercent(anim);
      const swipe = this.registry.get(REG_SWIPE_THRESHOLD);
      if (typeof swipe === "number") setSwipeThreshold(swipe);
    };

    const closeOptions = (): void => {
      persistOptionsSlidersToStorage();
      this.registry.set(REG_UI_MODAL_OPEN, false);
      this.optionsOverlay.setVisible(false);
    };

    const card = this.add.graphics();
    card.fillStyle(0xffffff, 1);
    card.fillRoundedRect(cardX, cardY, cardW, cardH, 16);
    card.lineStyle(2, 0xe5e7eb, 1);
    card.strokeRoundedRect(cardX + 1, cardY + 1, cardW - 2, cardH - 2, 15);

    const title = this.add.text(GAME_WIDTH / 2, cardY + 34, "Animation Time", {
      fontSize: "24px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0.5);
    const closeBtn = this.add.text(cardX + cardW - 18, cardY + 18, "X", {
      fontSize: "16px",
      color: "#475467",
      fontStyle: "700",
      backgroundColor: "#f8fafc",
      stroke: "#e5e7eb",
      strokeThickness: 1,
    }).setOrigin(0.5).setPadding(9, 4).setInteractive({ useHandCursor: true });
    closeBtn.on("pointerdown", closeOptions);

    this.animSpeedValueText = this.add.text(GAME_WIDTH / 2, cardY + 76, "100%", {
      fontSize: "28px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0.5);

    const sliderX = cardX + 26;
    const sliderY = cardY + 116;
    const sliderW = cardW - 52;
    const sliderH = 8;
    this.animSliderX = sliderX;
    this.animSliderY = sliderY;
    this.animSliderW = sliderW;
    this.animSliderH = sliderH;
    const knobR = 12;

    const sliderTrackBg = this.add.graphics();
    sliderTrackBg.fillStyle(0xe5e7eb, 1);
    sliderTrackBg.fillRoundedRect(sliderX, sliderY, sliderW, sliderH, 4);

    this.animSliderFill = this.add.graphics();
    this.animSliderKnob = this.add.circle(sliderX + sliderW / 2, sliderY + sliderH / 2, knobR, 0x2563eb);
    this.animSliderKnob.setStrokeStyle(3, 0xffffff, 1);

    const sliderHit = this.add.zone(sliderX, sliderY - 12, sliderW, sliderH + 24).setOrigin(0, 0);
    sliderHit.setInteractive({ useHandCursor: true });


    const textSizeLabel = this.add.text(cardX + 26, cardY + 176, "Text Size", {
      fontSize: "15px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0, 0.5);

    const textMinusBtn = this.add.text(cardX + cardW - 120, cardY + 176, "−", {
      fontSize: "24px",
      color: "#111827",
      fontStyle: "700",
      backgroundColor: "#eef2ff",
    }).setOrigin(0.5).setPadding(14, 2).setInteractive({ useHandCursor: true });

    this.textSizeOffsetValueText = this.add.text(cardX + cardW - 72, cardY + 176, "0px", {
      fontSize: "20px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0.5);

    const textPlusBtn = this.add.text(cardX + cardW - 26, cardY + 176, "+", {
      fontSize: "24px",
      color: "#111827",
      fontStyle: "700",
      backgroundColor: "#eef2ff",
    }).setOrigin(0.5).setPadding(10, 2).setInteractive({ useHandCursor: true });

    const quickLabel = this.add.text(cardX + 26, cardY + 216, "Quick Reset", {
      fontSize: "15px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0, 0.5);

    this.quickResetValueText = this.add.text(cardX + cardW - 26, cardY + 216, "☐", {
      fontSize: "24px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    const swipeLabel = this.add.text(cardX + 26, cardY + 252, "Swipe Distance", {
      fontSize: "15px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0, 0.5);
    this.swipeThresholdValueText = this.add.text(cardX + cardW - 26, cardY + 252, "40", {
      fontSize: "20px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0.5);

    const swipeSliderX = cardX + 26;
    const swipeSliderY = cardY + 276;
    const swipeSliderW = cardW - 52;
    const swipeSliderH = 8;
    this.swipeSliderX = swipeSliderX;
    this.swipeSliderY = swipeSliderY;
    this.swipeSliderW = swipeSliderW;
    this.swipeSliderH = swipeSliderH;
    const swipeTrackBg = this.add.graphics();
    swipeTrackBg.fillStyle(0xe5e7eb, 1);
    swipeTrackBg.fillRoundedRect(swipeSliderX, swipeSliderY, swipeSliderW, swipeSliderH, 4);
    this.swipeSliderFill = this.add.graphics();
    this.swipeSliderKnob = this.add.circle(swipeSliderX, swipeSliderY + swipeSliderH / 2, 12, 0x2563eb);
    this.swipeSliderKnob.setStrokeStyle(3, 0xffffff, 1);
    const swipeHit = this.add.zone(swipeSliderX, swipeSliderY - 12, swipeSliderW, swipeSliderH + 24).setOrigin(0, 0);
    swipeHit.setInteractive({ useHandCursor: true });

    const traceLabel = this.add.text(cardX + 26, cardY + 312, "Input trace", {
      fontSize: "15px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0, 0.5);

    this.inputTraceValueText = this.add.text(cardX + cardW - 26, cardY + 312, "☐", {
      fontSize: "24px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    const setFromPosition = (pointerX: number): void => {
      const ratio = Phaser.Math.Clamp((pointerX - sliderX) / sliderW, 0, 1);
      const next = Math.round(ratio * 200);
      this.registry.set(REG_ANIM_SPEED_PERCENT, next);
      this.syncAnimationSlider(next, sliderX, sliderY, sliderW, sliderH);
    };

    sliderHit.on("pointerdown", (p: Phaser.Input.Pointer) => {
      setFromPosition(p.x);
    });
    sliderHit.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      setFromPosition(p.x);
    });
    sliderHit.on("pointerup", persistOptionsSlidersToStorage);

    this.animSliderKnob.setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(this.animSliderKnob);
    this.animSliderKnob.on("drag", (p: Phaser.Input.Pointer) => {
      setFromPosition(p.x);
    });
    this.animSliderKnob.on("pointerup", persistOptionsSlidersToStorage);

    textMinusBtn.on("pointerdown", () => this.setTextBaseSizeStep(this.textBaseSize - 1));
    textPlusBtn.on("pointerdown", () => this.setTextBaseSizeStep(this.textBaseSize + 1));
    this.quickResetValueText.on("pointerdown", () => this.setQuickResetState(!this.quickResetEnabled));
    const setSwipeFromPosition = (pointerX: number): void => {
      const ratio = Phaser.Math.Clamp((pointerX - swipeSliderX) / swipeSliderW, 0, 1);
      const next = Math.round(10 + ratio * (100 - 10));
      this.registry.set(REG_SWIPE_THRESHOLD, next);
      this.syncSwipeSlider(next, swipeSliderX, swipeSliderY, swipeSliderW, swipeSliderH);
    };

    swipeHit.on("pointerdown", (p: Phaser.Input.Pointer) => setSwipeFromPosition(p.x));
    swipeHit.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      setSwipeFromPosition(p.x);
    });
    swipeHit.on("pointerup", persistOptionsSlidersToStorage);
    this.swipeSliderKnob.setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(this.swipeSliderKnob);
    this.swipeSliderKnob.on("drag", (p: Phaser.Input.Pointer) => setSwipeFromPosition(p.x));
    this.swipeSliderKnob.on("pointerup", persistOptionsSlidersToStorage);

    this.inputTraceValueText.on("pointerdown", () => {
      this.setInputTraceState(!this.inputTraceEnabled, true);
    });

    const speedRaw = this.registry.get(REG_ANIM_SPEED_PERCENT);
    const speed = typeof speedRaw === "number" ? speedRaw : 100;
    this.syncAnimationSlider(speed, sliderX, sliderY, sliderW, sliderH);
    const swipeRaw = this.registry.get(REG_SWIPE_THRESHOLD);
    const swipe = typeof swipeRaw === "number" ? swipeRaw : 40;
    this.syncSwipeSlider(swipe, swipeSliderX, swipeSliderY, swipeSliderW, swipeSliderH);

    const traceRaw = this.registry.get(REG_SHOW_DRAG_TRACE);
    this.setInputTraceState(Boolean(traceRaw), false);

    this.optionsOverlay = this.add.container(0, 0, [
      bg,
      card,
      title,
      closeBtn,
      this.animSpeedValueText,
      sliderTrackBg,
      this.animSliderFill,
      this.animSliderKnob,
      sliderHit,
      textSizeLabel,
      textMinusBtn,
      this.textSizeOffsetValueText,
      textPlusBtn,
      quickLabel,
      this.quickResetValueText,
      swipeLabel,
      this.swipeThresholdValueText,
      swipeTrackBg,
      this.swipeSliderFill,
      this.swipeSliderKnob,
      swipeHit,
      traceLabel,
      this.inputTraceValueText,
    ]);
    this.optionsOverlay.setDepth(1000);
    this.optionsOverlay.setVisible(false);
  }

  private drawResetConfirmOverlay(): void {
    const cardW = GAME_WIDTH - 88;
    const cardH = 138;
    const cardX = (GAME_WIDTH - cardW) / 2;
    const cardY = (GAME_HEIGHT - cardH) / 2;

    const bg = this.add.graphics();
    bg.fillStyle(0x0b1020, 0.52);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    bg.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT),
      Phaser.Geom.Rectangle.Contains
    );
    bg.on("pointerdown", () => {
      // Block click-through. Explicit button only.
    });

    const card = this.add.graphics();
    card.fillStyle(0xffffff, 1);
    card.fillRoundedRect(cardX, cardY, cardW, cardH, 16);
    card.lineStyle(2, 0xe5e7eb, 1);
    card.strokeRoundedRect(cardX + 1, cardY + 1, cardW - 2, cardH - 2, 15);

    const title = this.add.text(GAME_WIDTH / 2, cardY + 38, "Reset?", {
      fontSize: "28px",
      color: "#111827",
      fontStyle: "700",
    }).setOrigin(0.5);

    const cancelBtn = this.add.text(cardX + 74, cardY + 92, "✕", {
      fontSize: "26px",
      color: "#475467",
      fontStyle: "700",
      backgroundColor: "#f3f4f6",
      stroke: "#e5e7eb",
      strokeThickness: 1,
    }).setOrigin(0.5).setPadding(16, 6).setInteractive({ useHandCursor: true });

    const confirmBtn = this.add.text(cardX + cardW - 74, cardY + 92, "↻", {
      fontSize: "26px",
      color: "#ffffff",
      fontStyle: "700",
      backgroundColor: "#ef4444",
      stroke: "#b91c1c",
      strokeThickness: 1,
    }).setOrigin(0.5).setPadding(16, 6).setInteractive({ useHandCursor: true });

    cancelBtn.on("pointerdown", () => {
      this.resetConfirmOverlay.setVisible(false);
      this.registry.set(REG_UI_MODAL_OPEN, false);
    });
    confirmBtn.on("pointerdown", () => {
      this.scene.start(SCENE_KEYS.BOOT);
    });

    this.resetConfirmOverlay = this.add.container(0, 0, [
      bg,
      card,
      title,
      cancelBtn,
      confirmBtn,
    ]);
    this.resetConfirmOverlay.setDepth(1200);
    this.resetConfirmOverlay.setVisible(false);
  }

  private openResetConfirmOverlay(): void {
    this.game.events.emit("clearBufferedInput");
    this.registry.set(REG_UI_MODAL_OPEN, true);
    this.resetConfirmOverlay.setVisible(true);
  }

  private syncAnimationSlider(
    value: number,
    sliderX: number,
    sliderY: number,
    sliderW: number,
    sliderH: number
  ): void {
    const clamped = Phaser.Math.Clamp(value, 0, 200);
    const ratio = clamped / 200;
    const filledW = Math.max(0, Math.round(sliderW * ratio));
    this.animSpeedValueText.setText(`${clamped}%`);
    this.animSliderFill.clear();
    this.animSliderFill.fillStyle(0x60a5fa, 1);
    this.animSliderFill.fillRoundedRect(sliderX, sliderY, filledW, sliderH, 4);
    this.animSliderKnob.setPosition(sliderX + sliderW * ratio, sliderY + sliderH / 2);
  }

  private syncSwipeSlider(
    value: number,
    sliderX: number,
    sliderY: number,
    sliderW: number,
    sliderH: number
  ): void {
    const clamped = Phaser.Math.Clamp(value, 10, 100);
    const ratio = (clamped - 10) / (100 - 10);
    const filledW = Math.max(0, Math.round(sliderW * ratio));
    this.swipeThresholdValueText.setText(String(clamped));
    this.swipeSliderFill.clear();
    this.swipeSliderFill.fillStyle(0x60a5fa, 1);
    this.swipeSliderFill.fillRoundedRect(sliderX, sliderY, filledW, sliderH, 4);
    this.swipeSliderKnob.setPosition(sliderX + sliderW * ratio, sliderY + sliderH / 2);
  }

  private initTextResizeState(): void {
    this.children.list.forEach((obj) => {
      if (!(obj instanceof Phaser.GameObjects.Text)) return;
      const px = parseInt(String(obj.style.fontSize), 10);
      const base = Number.isFinite(px) ? px : 14;
      obj.setData("baseFontSize", base);
    });
    const raw = this.registry.get(REG_TEXT_BASE_SIZE);
    const size = typeof raw === "number" ? raw : UIScene.DEFAULT_TEXT_BASE_SIZE;
    this.setTextBaseSizeStep(size, false);
    const quickRaw = this.registry.get(REG_QUICK_RESET_ENABLED);
    this.setQuickResetState(Boolean(quickRaw), false);
    const swipeRaw = this.registry.get(REG_SWIPE_THRESHOLD);
    const swipe = typeof swipeRaw === "number" ? swipeRaw : 40;
    if (this.swipeSliderFill && this.swipeSliderKnob) {
      this.syncSwipeSlider(
        swipe,
        this.swipeSliderX,
        this.swipeSliderY,
        this.swipeSliderW,
        this.swipeSliderH
      );
    }
  }

  private setTextBaseSizeStep(next: number, persist = true): void {
    const clamped = Math.max(1, Math.min(200, Math.round(next)));
    this.textBaseSize = clamped;
    this.registry.set(REG_TEXT_BASE_SIZE, clamped);
    if (persist) {
      setTextBaseSize(clamped);
    }
    const ratio = clamped / UIScene.DEFAULT_TEXT_BASE_SIZE;
    if (this.textSizeOffsetValueText) {
      this.textSizeOffsetValueText.setText(`${clamped}px`);
    }
    this.children.list.forEach((obj) => {
      if (!(obj instanceof Phaser.GameObjects.Text)) return;
      const base = Number(obj.getData("baseFontSize"));
      if (!Number.isFinite(base)) return;
      obj.setFontSize(`${Math.max(1, Math.round(base * ratio))}px`);
    });
  }

  private setInputTraceState(enabled: boolean, persist = true): void {
    this.inputTraceEnabled = enabled;
    this.registry.set(REG_SHOW_DRAG_TRACE, enabled);
    if (persist) {
      setShowDragTrace(enabled);
    }
    if (this.inputTraceValueText) {
      this.inputTraceValueText.setText(enabled ? "☑" : "☐");
    }
  }

  private setQuickResetState(enabled: boolean, persist = true): void {
    this.quickResetEnabled = enabled;
    this.registry.set(REG_QUICK_RESET_ENABLED, enabled);
    if (persist) {
      setQuickResetEnabled(enabled);
    }
    if (this.quickResetValueText) {
      this.quickResetValueText.setText(enabled ? "☑" : "☐");
    }
  }

  private refreshFromRegistry(): void {
    const score = this.registry.get(REG_SCORE) as number;
    const best = this.registry.get(REG_BEST) as number;
    const gameOver = this.registry.get(REG_GAMEOVER) as boolean;

    this.scoreText.setText(String(score));
    this.bestText.setText("Best: " + best);
    if (this.hintText) this.hintText.setVisible(score === 0);
    const speedRaw = this.registry.get(REG_ANIM_SPEED_PERCENT);
    const speed = typeof speedRaw === "number" ? speedRaw : 100;
    if (this.animSpeedValueText) this.animSpeedValueText.setText(`${speed}%`);
    if (this.animSliderFill && this.animSliderKnob) {
      this.syncAnimationSlider(
        speed,
        this.animSliderX,
        this.animSliderY,
        this.animSliderW,
        this.animSliderH
      );
    }
    if (this.textSizeOffsetValueText) {
      this.textSizeOffsetValueText.setText(`${this.textBaseSize}px`);
    }
    const quickRaw = this.registry.get(REG_QUICK_RESET_ENABLED);
    this.setQuickResetState(Boolean(quickRaw), false);
    const traceRaw = this.registry.get(REG_SHOW_DRAG_TRACE);
    if (this.inputTraceValueText) {
      this.setInputTraceState(Boolean(traceRaw), false);
    }

    this.winOverlay.setVisible(false);
    this.gameOverOverlay.setVisible(gameOver);

    const canUndo = this.registry.get(REG_UNDO_AVAILABLE) === true;
    if (this.undoBtn) {
      this.undoBtn.setAlpha(canUndo ? 1 : 0.38);
    }
    if (this.hintBtn) {
      const hintBusy = this.registry.get(REG_HINT_BUSY) === true;
      const hintUsable = !gameOver && !hintBusy;
      this.hintBtn.setAlpha(hintUsable ? 1 : 0.38);
      if (this.hintBtn.input) {
        this.hintBtn.input.enabled = hintUsable;
      }
    }
  }
}

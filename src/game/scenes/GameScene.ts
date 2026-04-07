import Phaser from "phaser";
import type { Board } from "../core/types";
import { SCENE_KEYS } from "../constants";
import { GAME_WIDTH } from "../config";
import { step as coreStep, isGameOver, hasWon, getEmptyCount } from "../core";
import {
  getHint,
  createHintSearchContext,
  experimentCEndgameWith78MergeTiming,
  type HintSearchConfig,
} from "../../sim";
import { gameBoardToSim, simDirectionToGame } from "../hintBridge";
import { copyBoard } from "../core/board";
import { setBestScore } from "../storage";
import { TILE_TEXTURE_BY_LEVEL } from "../assets";
import { Lv1FringeFixPipeline } from "../pipelines/Lv1FringeFixPipeline";
import {
  BOARD_MARGIN,
  BOARD_TOP,
  BOARD_CELL_GAP,
  CELL_SIZE,
  HERO_TOP,
  HERO_HEIGHT,
  COLORS,
} from "../config/layout";
import {
  REG_BOARD,
  REG_SCORE,
  REG_BEST,
  REG_GAMEOVER,
  REG_HASWON,
  REG_ANIM_SPEED_PERCENT,
  REG_UI_MODAL_OPEN,
  REG_SWIPE_THRESHOLD,
  REG_WIN_EFFECT_DONE,
  REG_UNDO_AVAILABLE,
  REG_HINT_BUSY,
  REG_SHOW_DRAG_TRACE,
  REG_AUTO_HINT_ENABLED,
} from "../registry";

// 타일이 셀의 약 70~75%를 차지하도록 약간 크게 설정.
const TILE_SIZE_RATIO = 0.51;

type Lv1ShaderPreset = {
  baseRed: [number, number, number];
  alphaMin: number;
  alphaMax: number;
  darkLumThreshold: number;
  strength: number;
};

const LV1_SHADER_PRESET: Lv1ShaderPreset = {
  baseRed: [0.89, 0.24, 0.24],
  alphaMin: 0.03,
  alphaMax: 0.38,
  darkLumThreshold: 0.34,
  strength: 0.55,
};

type UndoSnapshot = {
  board: Board;
  score: number;
  gameOver: boolean;
  hasWon: boolean;
  winEffectDone: boolean;
};

const DRAG_TRACE_FADE_MS = 1000;

export class GameScene extends Phaser.Scene {
  private boardGraphics!: Phaser.GameObjects.Graphics;
  private staticTiles: Phaser.GameObjects.Image[] = [];
  private inputLocked = false;
  private hardInputLock = false;
  private lv1PipelineReady = false;
  private bufferedDirection: "up" | "down" | "left" | "right" | null = null;
  private rainbowImpactPulse!: Phaser.GameObjects.Rectangle;
  private dragTraceGraphics!: Phaser.GameObjects.Graphics;
  private dragPoints: Array<{ x: number; y: number }> = [];
  private dragTraceFadeTween: Phaser.Tweens.Tween | null = null;
  private dragActive = false;
  /** Only the state before the last successful move can be restored. */
  private lastUndoSnapshot: UndoSnapshot | null = null;
  private autoHintScheduled = false;
  /** 연속 힌트 호출 간 재사용; `getHint` 종료 시 상한 초과분은 오래된 키부터 제거. */
  private readonly hintValueCache = new Map<string, number>();
  private readonly hintLeafScoreCache = new Map<string, number>();
  private readonly hintSlidePenaltyCache = new Map<string, number>();
  private readonly hintPreferredValueKeys = new Set<string>();
  private readonly hintSearchContext = createHintSearchContext();
  constructor() {
    super({ key: SCENE_KEYS.GAME });
  }

  create(): void {
    this.ensureLv1Pipeline();
    this.game.events.on("clearBufferedInput", this.clearBufferedInput, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off("clearBufferedInput", this.clearBufferedInput, this);
    });
    if (this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      // Apply stronger edge anti-aliasing at output stage (keeps source textures unchanged).
      this.cameras.main.setPostPipeline("FXAA");
    }
    this.boardGraphics = this.add.graphics();
    this.rainbowImpactPulse = this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      0xffffff,
      0
    );
    this.rainbowImpactPulse.setDepth(40);
    this.rainbowImpactPulse.setScrollFactor(0);
    this.dragTraceGraphics = this.add.graphics();
    this.dragTraceGraphics.setDepth(25);
    this.registry.set(REG_UNDO_AVAILABLE, false);
    this.registry.set(REG_HINT_BUSY, false);
    this.hintValueCache.clear();
    this.hintLeafScoreCache.clear();
    this.hintSlidePenaltyCache.clear();
    this.hintPreferredValueKeys.clear();
    this.hintSearchContext.nodes.clear();
    this.hintSearchContext.tick = 0;
    this.hintSearchContext.generation = 0;
    this.hintSearchContext.rootKey = undefined;
    this.refreshBoard();
    this.setupInput();
    this.game.events.on("requestUndo", this.performUndo, this);
    this.game.events.on("requestHint", this.performHint, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off("requestUndo", this.performUndo, this);
      this.game.events.off("requestHint", this.performHint, this);
    });
  }

  private setupInput(): void {
    const keys = this.input.keyboard?.addKeys("UP,DOWN,LEFT,RIGHT") as
      | { UP: Phaser.Input.Keyboard.Key; DOWN: Phaser.Input.Keyboard.Key; LEFT: Phaser.Input.Keyboard.Key; RIGHT: Phaser.Input.Keyboard.Key }
      | undefined;
    if (keys) {
      ([[keys.UP, "up"], [keys.DOWN, "down"], [keys.LEFT, "left"], [keys.RIGHT, "right"]] as const).forEach(([key, dir]) => {
        key.on("down", () => {
          this.enqueueMove(dir);
        });
      });
    }

    let startX = 0;
    let startY = 0;
    let hasSwipeStart = false;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const modalOpen = this.registry.get(REG_UI_MODAL_OPEN) as boolean;
      if (modalOpen) {
        this.dragActive = false;
        hasSwipeStart = false;
        return;
      }
      startX = p.x;
      startY = p.y;
      hasSwipeStart = true;
      if (this.isDragTraceEnabled()) {
        this.dragTraceFadeTween?.stop();
        this.dragTraceFadeTween = null;
        this.dragTraceGraphics.clear();
        this.dragTraceGraphics.setAlpha(1);
        this.dragPoints = [{ x: p.x, y: p.y }];
        this.dragActive = true;
      } else {
        this.dragActive = false;
      }
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.isDragTraceEnabled() || !this.dragActive || !p.isDown) return;
      if (this.registry.get(REG_UI_MODAL_OPEN) as boolean) return;
      const last = this.dragPoints[this.dragPoints.length - 1];
      const dist = Phaser.Math.Distance.Between(last.x, last.y, p.x, p.y);
      if (dist < 2.5) return;
      this.dragPoints.push({ x: p.x, y: p.y });
      this.redrawDragTracePathOnly();
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this.dragActive) {
        const last = this.dragPoints[this.dragPoints.length - 1];
        if (!last || last.x !== p.x || last.y !== p.y) {
          this.dragPoints.push({ x: p.x, y: p.y });
        }
        this.finalizeDragTraceDebug(p.x, p.y, startX, startY);
        this.dragActive = false;
      }
      if (!hasSwipeStart) return;
      hasSwipeStart = false;
      const dx = p.x - startX;
      const dy = p.y - startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const thresholdRaw = this.registry.get(REG_SWIPE_THRESHOLD);
      const swipeThreshold = typeof thresholdRaw === "number" ? thresholdRaw : 40;
      if (adx > ady && adx >= swipeThreshold) {
        this.enqueueMove(dx > 0 ? "right" : "left");
      } else if (ady >= swipeThreshold) {
        this.enqueueMove(dy > 0 ? "down" : "up");
      }
    });
    this.input.on("gameout", () => {
      hasSwipeStart = false;
      if (this.dragActive) {
        this.dragActive = false;
        this.dragTraceGraphics.clear();
        this.dragPoints = [];
      }
    });
  }

  /** Same swipe direction detection as pointerup handler (for debug overlay). */
  private detectSwipeDirection(
    dx: number,
    dy: number,
    swipeThreshold: number
  ): "up" | "down" | "left" | "right" | null {
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx > ady && adx >= swipeThreshold) {
      return dx > 0 ? "right" : "left";
    }
    if (ady >= swipeThreshold) {
      return dy > 0 ? "down" : "up";
    }
    return null;
  }

  private redrawDragTracePathOnly(): void {
    const g = this.dragTraceGraphics;
    g.clear();
    if (this.dragPoints.length < 2) return;
    g.lineStyle(3, 0x2563eb, 0.82);
    g.beginPath();
    g.moveTo(this.dragPoints[0].x, this.dragPoints[0].y);
    for (let i = 1; i < this.dragPoints.length; i++) {
      g.lineTo(this.dragPoints[i].x, this.dragPoints[i].y);
    }
    g.strokePath();
  }

  /**
   * Shows stroke + end marker color: why the swipe did or did not act.
   * Fades out over {@link DRAG_TRACE_FADE_MS}.
   */
  private finalizeDragTraceDebug(endX: number, endY: number, startX: number, startY: number): void {
    const thresholdRaw = this.registry.get(REG_SWIPE_THRESHOLD);
    const swipeThreshold = typeof thresholdRaw === "number" ? thresholdRaw : 40;
    const dx = endX - startX;
    const dy = endY - startY;
    const dir = this.detectSwipeDirection(dx, dy, swipeThreshold);

    const modalOpen = this.registry.get(REG_UI_MODAL_OPEN) as boolean;
    const gameOver = this.registry.get(REG_GAMEOVER) as boolean;

    let markerColor = 0x22c55e;
    if (modalOpen) {
      markerColor = 0x9ca3af;
    } else if (gameOver) {
      markerColor = 0xf97316;
    } else if (!dir) {
      markerColor = 0xef4444;
    } else if (this.inputLocked && this.hardInputLock) {
      markerColor = 0xa855f7;
    } else if (this.inputLocked) {
      markerColor = 0x06b6d4;
    }

    const g = this.dragTraceGraphics;
    g.clear();
    if (this.dragPoints.length >= 2) {
      g.lineStyle(3, 0x2563eb, 0.82);
      g.beginPath();
      g.moveTo(this.dragPoints[0].x, this.dragPoints[0].y);
      for (let i = 1; i < this.dragPoints.length; i++) {
        g.lineTo(this.dragPoints[i].x, this.dragPoints[i].y);
      }
      g.strokePath();
    }
    g.fillStyle(markerColor, 0.95);
    g.fillCircle(endX, endY, 5);

    this.dragTraceFadeTween?.stop();
    this.dragTraceFadeTween = this.tweens.add({
      targets: this.dragTraceGraphics,
      alpha: 0,
      duration: DRAG_TRACE_FADE_MS,
      ease: "Sine.easeOut",
      onComplete: () => {
        this.dragTraceGraphics.clear();
        this.dragTraceGraphics.setAlpha(1);
        this.dragTraceFadeTween = null;
        this.dragPoints = [];
      },
    });
  }

  private enqueueMove(direction: "up" | "down" | "left" | "right"): void {
    const modalOpen = this.registry.get(REG_UI_MODAL_OPEN) as boolean;
    if (modalOpen) {
      this.bufferedDirection = null;
      return;
    }
    if (this.inputLocked) {
      if (this.hardInputLock) return;
      // Keep one latest buffered intent while animations are running.
      this.bufferedDirection = direction;
      return;
    }
    this.tryMove(direction);
  }

  private releaseInputLock(): void {
    this.inputLocked = false;
    this.hardInputLock = false;
    const next = this.bufferedDirection;
    this.bufferedDirection = null;
    if (next) {
      this.tryMove(next);
      return;
    }
    this.maybeScheduleAutoHint();
  }

  private maybeScheduleAutoHint(): void {
    if (this.autoHintScheduled) return;
    if (this.registry.get(REG_AUTO_HINT_ENABLED) !== true) return;
    if (this.registry.get(REG_UI_MODAL_OPEN) === true) return;
    if (this.registry.get(REG_GAMEOVER) === true) return;
    if (this.registry.get(REG_HINT_BUSY) === true) return;
    if (this.inputLocked || this.hardInputLock) return;
    const board = this.registry.get(REG_BOARD) as Board;
    if (isGameOver(board)) return;

    this.autoHintScheduled = true;
    this.time.delayedCall(0, () => {
      this.autoHintScheduled = false;
      this.performHint();
    });
  }

  private clearBufferedInput(): void {
    this.bufferedDirection = null;
  }

  private syncUndoAvailable(): void {
    this.registry.set(REG_UNDO_AVAILABLE, this.lastUndoSnapshot !== null);
  }

  private isDragTraceEnabled(): boolean {
    return this.registry.get(REG_SHOW_DRAG_TRACE) === true;
  }

  private hintSearchOptions(): HintSearchConfig {
    return {
      tuning: {
        ...experimentCEndgameWith78MergeTiming,
        active7MergeBonus: 1800,
        mergePotential7Weight: 820,
        deltaMergePotential7Weight: 1100,
        mergeNow7Bonus: 5200,
        mergeNow8Bonus: 26000,
        deferMerge7Penalty: 1200,
        deferMerge8Penalty: 3600,
        deltaImmediateMerge7Gain: 2800,
        deltaImmediateMerge7Loss: 3600,
        deltaImmediateMerge8Gain: 11000,
        deltaImmediateMerge8Loss: 15000,
        adjacent77Bonus: 1200,
        separatedTwo7Penalty: 800,
        two7DistancePenaltyWeight: 900,
        highLevelNoMergePenalty: 2400,
        highLevelNoMergePerTilePenalty: 900,
        highLevelNoMergeLowEmptyPenalty: 1300,
        highLevelEmptyCellReward: 160,
        endgame78Weight: 320,
        rebuildWeight: 240,
        deltaRebuildPreferenceWeight: 260,
      },
      lateThreshold: 7,
      depthEarly: 5,
      beamWidthEarly: 8,
      depthLate: 10,
      beamWidthLate: 14,
      maxMs: 500,
      maxExpandedNodes: 90_000,
      valueCache: this.hintValueCache,
      leafScoreCache: this.hintLeafScoreCache,
      slidePenaltyCache: this.hintSlidePenaltyCache,
      sessionPreferredValueKeys: this.hintPreferredValueKeys,
      searchContext: this.hintSearchContext,
      prewarmNodeExpansions: 12,
    };
  }

  private performHint(): void {
    if (this.registry.get(REG_UI_MODAL_OPEN) as boolean) return;
    if (this.inputLocked || this.hardInputLock) return;
    if (this.registry.get(REG_GAMEOVER) as boolean) return;

    const board = this.registry.get(REG_BOARD) as Board;
    if (isGameOver(board)) return;

    const simBoard = gameBoardToSim(board);

    this.registry.set(REG_HINT_BUSY, true);
    this.game.events.emit("stateChanged");
    try {
      const hint = getHint(simBoard, this.hintSearchOptions());
      this.enqueueMove(simDirectionToGame(hint.bestDirection));
    } finally {
      this.registry.set(REG_HINT_BUSY, false);
      this.game.events.emit("stateChanged");
    }
  }

  private performUndo(): void {
    if (this.registry.get(REG_UI_MODAL_OPEN) as boolean) return;
    if (this.inputLocked || this.hardInputLock) return;
    const snap = this.lastUndoSnapshot;
    if (!snap) return;

    this.lastUndoSnapshot = null;
    this.syncUndoAvailable();
    this.bufferedDirection = null;

    this.registry.set(REG_BOARD, snap.board);
    this.registry.set(REG_SCORE, snap.score);
    this.registry.set(REG_GAMEOVER, snap.gameOver);
    this.registry.set(REG_HASWON, snap.hasWon);
    this.registry.set(REG_WIN_EFFECT_DONE, snap.winEffectDone);
    this.refreshBoard();
    this.game.events.emit("stateChanged");
  }

  private playRainbowMergeFx(
    cx: number,
    cy: number,
    level: number,
    depth: number,
    onDone: () => void
  ): void {
    const m = Phaser.Math.Clamp(this.getAnimationMultiplier(), 0.8, 1.4);
    const freezeMs = Math.round(100 * m);
    const mergeMs = Math.round(160 * m);
    const transformMs = Math.round(140 * m);
    const orbitMs = Math.round(1000 * m);
    const travelMs = Math.round(380 * m);
    const absorbMs = Math.round(160 * m);
    const afterglowMs = Math.round(120 * m);

    const container = this.add.container(cx, cy);
    container.setDepth(depth);

    const preGlow = this.add.circle(0, 0, Math.round(CELL_SIZE * 0.32), 0xffffff, 0);
    preGlow.setDepth(depth);
    container.addAt(preGlow, 0);

    const burst = this.add.graphics();
    const colors = [0xff5f6d, 0xffb347, 0xffe066, 0x6ee7b7, 0x60a5fa, 0xa78bfa];
    const ringR = Math.max(18, Math.round(CELL_SIZE * 0.24));
    colors.forEach((color, i) => {
      burst.lineStyle(2, color, 0.35);
      burst.strokeCircle(0, 0, ringR + i * 1.5);
    });
    burst.setScale(0.6);
    burst.setAlpha(0.35);
    burst.setDepth(depth);
    container.add(burst);

    const spinHalo = this.add.graphics();
    const haloColors = [0xff5f6d, 0xffb347, 0xffe066, 0x6ee7b7, 0x60a5fa, 0xa78bfa];
    const haloBaseR = Math.round(CELL_SIZE * 0.23);
    spinHalo.fillStyle(0xffffff, 0.1);
    spinHalo.fillCircle(0, 0, haloBaseR + 10);
    haloColors.forEach((color, i) => {
      spinHalo.lineStyle(8, color, 0.78);
      spinHalo.strokeCircle(0, 0, haloBaseR + i * 3);
    });
    spinHalo.setAlpha(0);
    spinHalo.setDepth(depth + 1);
    container.add(spinHalo);

    // Core orb that "forms" during fusion transform.
    const mergeCore = this.add.circle(0, 0, Math.round(CELL_SIZE * 0.13), 0xffffff, 0);
    mergeCore.setScale(0.2);
    mergeCore.setDepth(depth + 2);
    container.add(mergeCore);

    const mergeShell = this.add.circle(0, 0, Math.round(CELL_SIZE * 0.2), 0x60a5fa, 0);
    mergeShell.setScale(0.5);
    mergeShell.setDepth(depth + 1);
    container.add(mergeShell);

    const sparkleCount = 8;
    for (let i = 0; i < sparkleCount; i++) {
      const angle = (Math.PI * 2 * i) / sparkleCount + Phaser.Math.FloatBetween(-0.14, 0.14);
      const distance = Phaser.Math.Between(20, 36);
      const sparkle = this.add.rectangle(0, 0, Phaser.Math.Between(3, 6), Phaser.Math.Between(2, 3), 0xffffff, 0.95);
      sparkle.setRotation(angle);
      sparkle.setDepth(depth + 2);
      container.add(sparkle);
      this.tweens.add({
        targets: sparkle,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.2,
        duration: Phaser.Math.Between(220, 280),
        ease: "Sine.easeOut",
      });
    }

    const targetX = GAME_WIDTH / 2;
    const targetY = HERO_TOP + HERO_HEIGHT / 2 + 15;
    const ctrlX = cx + (targetX - cx) * 0.35 + Phaser.Math.Between(-26, 26);
    const ctrlY = cy + (targetY - cy) * 0.4 - 90;
    const startMergePhase = (): void => {
      this.playGlobalRainbowImpact();
      this.game.events.emit("rainbowClimax");
      this.tweens.add({
        targets: container,
        scale: { from: 1, to: 1.22 },
        yoyo: true,
        duration: mergeMs,
        ease: "Back.Out",
      });
      this.tweens.add({
        targets: burst,
        scale: 1.7,
        alpha: 0,
        duration: mergeMs,
        ease: "Sine.easeOut",
      });
      this.tweens.add({
        targets: mergeCore,
        alpha: { from: 0, to: 0.95 },
        scale: { from: 0.2, to: 0.92 },
        duration: Math.max(120, Math.round(mergeMs * 0.9)),
        ease: "Back.Out",
      });
      this.tweens.add({
        targets: mergeShell,
        alpha: { from: 0, to: 0.55 },
        scale: { from: 0.5, to: 1.15 },
        duration: Math.max(130, Math.round(mergeMs * 1.05)),
        ease: "Sine.easeOut",
      });

      this.time.delayedCall(mergeMs, () => {
        this.tweens.add({
          targets: preGlow,
          alpha: { from: 0.24, to: 0 },
          duration: transformMs,
          ease: "Sine.easeIn",
        });
        this.tweens.add({
          targets: mergeCore,
          alpha: { from: 0.95, to: 0.8 },
          scale: { from: 0.92, to: 1.08 },
          duration: transformMs,
          ease: "Sine.easeInOut",
        });
        this.tweens.add({
          targets: mergeShell,
          alpha: { from: 0.55, to: 0.12 },
          scale: { from: 1.15, to: 1.45 },
          duration: transformMs,
          ease: "Sine.easeOut",
        });
        this.tweens.add({
          targets: spinHalo,
          alpha: { from: 0, to: 0.9 },
          duration: Math.min(220, transformMs),
          ease: "Sine.easeOut",
        });

        this.time.delayedCall(transformMs, () => {
          this.tweens.add({
            targets: spinHalo,
            angle: 360,
            duration: orbitMs,
            ease: "Sine.easeInOut",
            onComplete: () => {
              this.tweens.add({ targets: spinHalo, alpha: 0, duration: 140, ease: "Sine.easeOut" });
              this.game.events.emit("rainbowTravelStart", {
                x: cx,
                y: cy,
              });
              const travelTween = this.tweens.addCounter({
                from: 0,
                to: 1,
                duration: travelMs,
                ease: "Sine.easeInOut",
                onUpdate: (tw) => {
                  const t = tw.getValue();
                  const x = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * ctrlX + t * t * targetX;
                  const y = (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * ctrlY + t * t * targetY;
                  this.game.events.emit("rainbowTravelUpdate", { x, y });
                },
                onComplete: () => {
                  this.game.events.emit("rainbowTravelComplete");
                  this.game.events.emit("rainbowAbsorb");
                  this.time.delayedCall(absorbMs + afterglowMs, () => {
                    container.destroy(true);
                    onDone();
                  });
                },
              });
              void travelTween;
            },
          });
        });
      });
    };

    // Phase 1: brief anticipation freeze with soft brightening.
    this.tweens.add({
      targets: preGlow,
      alpha: { from: 0, to: 0.24 },
      yoyo: true,
      duration: freezeMs,
      ease: "Sine.easeOut",
      onComplete: startMergePhase,
    });
  }

  private playGlobalRainbowImpact(): void {
    if (this.rainbowImpactPulse) {
      this.rainbowImpactPulse.setAlpha(0);
      this.tweens.add({
        targets: this.rainbowImpactPulse,
        alpha: { from: 0, to: 0.12 },
        yoyo: true,
        duration: 80,
        ease: "Sine.easeOut",
      });
    }

    const cam = this.cameras.main;
    this.tweens.add({
      targets: cam,
      zoom: 1.02,
      yoyo: true,
      duration: 75,
      ease: "Sine.easeOut",
    });
  }

  private getAnimationMultiplier(): number {
    const percentRaw = this.registry.get(REG_ANIM_SPEED_PERCENT);
    const percent = typeof percentRaw === "number" ? percentRaw : 100;
    return Math.max(0, Math.min(2, percent / 100));
  }

  private tryMove(direction: "up" | "down" | "left" | "right"): void {
    const gameOver = this.registry.get(REG_GAMEOVER) as boolean;
    if (gameOver) return;
    const modalOpen = this.registry.get(REG_UI_MODAL_OPEN) as boolean;
    if (modalOpen) return;

    const board = this.registry.get(REG_BOARD) as Board;
    this.inputLocked = true;

    const undoSnapshot: UndoSnapshot = {
      board: copyBoard(board) as Board,
      score: this.registry.get(REG_SCORE) as number,
      gameOver: this.registry.get(REG_GAMEOVER) as boolean,
      hasWon: this.registry.get(REG_HASWON) as boolean,
      winEffectDone: this.registry.get(REG_WIN_EFFECT_DONE) as boolean,
    };

    const emptyCount = getEmptyCount(board);
    const randomIndex =
      emptyCount > 0 ? Math.floor(Math.random() * emptyCount) : 0;
    const result = coreStep(board, direction, randomIndex);
    if (!result.changed) {
      this.releaseInputLock();
      return;
    }

    // Single-step undo: keep only the state before this move.
    this.lastUndoSnapshot = undoSnapshot;
    this.syncUndoAvailable();

    this.registry.set(REG_BOARD, result.board);
    const score = (this.registry.get(REG_SCORE) as number) + result.scoreDelta;
    this.registry.set(REG_SCORE, score);

    const best = this.registry.get(REG_BEST) as number;
    if (score > best) {
      this.registry.set(REG_BEST, score);
      setBestScore(score);
    }

    this.registry.set(REG_GAMEOVER, isGameOver(result.board));
    this.registry.set(REG_HASWON, hasWon(result.board));
    const hasRainbowMerge = result.merged.some(({ row, col }) => result.board[row][col] >= 8);
    const verifiedRainbowFusion = result.rainbowMerged.filter(({ row, col }) => {
      const sources = result.traces.filter(
        (t) =>
          t.mergedInto &&
          t.to.row === row &&
          t.to.col === col &&
          board[t.from.row][t.from.col] === 8
      );
      return sources.length >= 2;
    });
    const hasRainbowFusion = verifiedRainbowFusion.length > 0;
    if (hasRainbowFusion) {
      this.hardInputLock = true;
      this.bufferedDirection = null;
    }
    this.registry.set(REG_WIN_EFFECT_DONE, !(hasRainbowMerge || hasRainbowFusion));
    // UI(스코어, 오버레이)는 즉시 업데이트하되,
    // 보드 그래픽은 애니메이션 안에서 단계적으로 갱신한다.
    this.game.events.emit("stateChanged");

    this.playTileAnimations(
      board,
      result.board,
      result.traces,
      result.merged,
      verifiedRainbowFusion,
      result.spawnedAt ?? null
    );
  }

  refreshBoard(): void {
    const board = this.registry.get(REG_BOARD) as Board | undefined;
    if (!board) return;
    this.renderBoard(board);
  }

  private renderBoard(board: Board): void {
    const g = this.boardGraphics;
    g.clear();

    const radius = 12;
    const gap = BOARD_CELL_GAP;

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const x = BOARD_MARGIN + gap + c * (CELL_SIZE + gap);
        const y = BOARD_TOP + gap + r * (CELL_SIZE + gap);
        g.fillStyle(parseInt(COLORS.cellBg.slice(1), 16), 1);
        g.fillRoundedRect(x, y, CELL_SIZE, CELL_SIZE, radius);
      }
    }

    this.staticTiles.forEach((tile) => tile.destroy());
    this.staticTiles = [];

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const level = board[r][c];
        if (level === 0) continue;
        const cx = BOARD_MARGIN + gap + c * (CELL_SIZE + gap) + CELL_SIZE / 2;
        const cy = BOARD_TOP + gap + r * (CELL_SIZE + gap) + CELL_SIZE / 2;
        const tile = this.createTileImage(cx, cy, level, 5);
        tile.setDataEnabled();
        tile.setData("row", r);
        tile.setData("col", c);
        this.staticTiles.push(tile);
      }
    }
  }

  private removeStaticTileAt(row: number, col: number): void {
    for (let i = this.staticTiles.length - 1; i >= 0; i -= 1) {
      const tile = this.staticTiles[i];
      const tr = tile.getData("row") as number | undefined;
      const tc = tile.getData("col") as number | undefined;
      if (tr === row && tc === col) {
        tile.destroy();
        this.staticTiles.splice(i, 1);
      }
    }
  }

  private createTileImage(
    cx: number,
    cy: number,
    level: number,
    depth: number
  ): Phaser.GameObjects.Image {
    const key = TILE_TEXTURE_BY_LEVEL[level];
    const image = this.add.image(cx, cy, key);
    const levelScale = level === 1 ? 0.96 : 1;
    const display = Math.max(
      1,
      Math.round(CELL_SIZE * TILE_SIZE_RATIO * 2 * levelScale)
    );
    image.setDisplaySize(display, display);
    if (level === 1 && this.lv1PipelineReady) {
      image.setPipeline(Lv1FringeFixPipeline.KEY);
      this.applyLv1ShaderUniforms(image);
    }
    image.setDepth(depth);
    return image;
  }

  private ensureLv1Pipeline(): void {
    const renderer = this.game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
    if (renderer.pipelines.has(Lv1FringeFixPipeline.KEY)) {
      this.lv1PipelineReady = true;
      return;
    }
    renderer.pipelines.add(Lv1FringeFixPipeline.KEY, new Lv1FringeFixPipeline(this.game));
    this.lv1PipelineReady = true;
  }

  private applyLv1ShaderUniforms(image: Phaser.GameObjects.Image): void {
    const preset = LV1_SHADER_PRESET;
    const pipeline = image.pipeline as unknown as {
      set3f?: (name: string, x: number, y: number, z: number) => void;
      set2f?: (name: string, x: number, y: number) => void;
      set1f?: (name: string, value: number) => void;
      setFloat3?: (name: string, x: number, y: number, z: number) => void;
      setFloat2?: (name: string, x: number, y: number) => void;
      setFloat1?: (name: string, value: number) => void;
    };

    if (pipeline.set3f) {
      pipeline.set3f("uBaseRed", preset.baseRed[0], preset.baseRed[1], preset.baseRed[2]);
    } else if (pipeline.setFloat3) {
      pipeline.setFloat3("uBaseRed", preset.baseRed[0], preset.baseRed[1], preset.baseRed[2]);
    }

    const setScalar = (name: string, value: number): void => {
      if (pipeline.set1f) {
        pipeline.set1f(name, value);
      } else if (pipeline.setFloat1) {
        pipeline.setFloat1(name, value);
      }
    };

    setScalar("uAlphaMin", preset.alphaMin);
    setScalar("uAlphaMax", preset.alphaMax);
    setScalar("uDarkLumThreshold", preset.darkLumThreshold);
    setScalar("uStrength", preset.strength);

    const texW = image.texture.source[0]?.width ?? 1024;
    const texH = image.texture.source[0]?.height ?? 1024;
    const tx = 1 / Math.max(1, texW);
    const ty = 1 / Math.max(1, texH);
    if (pipeline.set2f) {
      pipeline.set2f("uTexelSize", tx, ty);
    } else if (pipeline.setFloat2) {
      pipeline.setFloat2("uTexelSize", tx, ty);
    }
  }

  private playTileAnimations(
    previousBoard: Board,
    nextBoard: Board,
    traces: { from: { row: number; col: number }; to: { row: number; col: number }; mergedInto: boolean }[],
    merged: { row: number; col: number }[],
    rainbowMerged: { row: number; col: number }[],
    spawnedAt: { row: number; col: number } | null
  ): void {
    const gap = BOARD_CELL_GAP;
    const animMultiplier = this.getAnimationMultiplier();
    const moveDuration = Math.round(140 * animMultiplier);
    const mergeDuration = Math.round(90 * animMultiplier);
    const spawnDuration = Math.round(190 * animMultiplier);

    const makeContainerWithLevel = (
      row: number,
      col: number,
      level: number,
      depth = 10
    ): Phaser.GameObjects.Container => {
      const cx = BOARD_MARGIN + gap + col * (CELL_SIZE + gap) + CELL_SIZE / 2;
      const cy = BOARD_TOP + gap + row * (CELL_SIZE + gap) + CELL_SIZE / 2;
      const tile = this.createTileImage(0, 0, level, depth);
      const container = this.add.container(cx, cy, [tile]);
      container.setDepth(depth);
      return container;
    };

    const runFinishPhase = () => {
      const tweens: Phaser.Tweens.Tween[] = [];
      const hasRainbowFusionFx = rainbowMerged.length > 0;
      const shouldAnimateSpawn = Boolean(spawnedAt && !hasRainbowFusionFx);
      const finishTargets = merged.length + rainbowMerged.length + (shouldAnimateSpawn ? 1 : 0);
      if (finishTargets === 0) {
        this.releaseInputLock();
        return;
      }

      // 이동 애니메이션 직후에는, 스폰 칸만 비운 보드를 그려서
      // 작은 점에서 커지는 효과가 더 잘 보이도록 한다.
      let baseBoard: Board = nextBoard;
      if (spawnedAt) {
        const temp: number[][] = nextBoard.map((r) => [...r]);
        if (spawnedAt) {
          const { row, col } = spawnedAt;
          temp[row][col] = 0;
        }
        baseBoard = temp as unknown as Board;
      }
      // For rainbow fusion, keep board frozen until FX completes to avoid mid-animation flicker.
      if (!hasRainbowFusionFx) {
        this.renderBoard(baseBoard);
      }

      let finished = 0;
      const onDone = () => {
        finished += 1;
        if (finished >= finishTargets) {
          // 머지/스폰 애니메이션이 모두 끝난 뒤 최종 보드를 한 번 더 그려서
          // 스폰 칸까지 포함된 실제 상태를 확정한다.
          this.renderBoard(nextBoard);
          tweens.forEach((t) => t.remove());
          this.releaseInputLock();
        }
      };
      const toWorld = (row: number, col: number): { x: number; y: number } => ({
        x: BOARD_MARGIN + gap + col * (CELL_SIZE + gap) + CELL_SIZE / 2,
        y: BOARD_TOP + gap + row * (CELL_SIZE + gap) + CELL_SIZE / 2,
      });

      // Merge pop
      merged.forEach(({ row, col }) => {
        const level = nextBoard[row][col];
        const container = makeContainerWithLevel(row, col, level, 11);
        const tween = this.tweens.add({
          targets: container,
          scale: { from: 1, to: 1.18 },
          yoyo: true,
          duration: mergeDuration,
          ease: "Sine.easeOut",
          onComplete: () => {
            container.destroy();
            onDone();
          },
        });
        tweens.push(tween);
      });

      // Rainbow fusion (8+8 -> absorbed)
      rainbowMerged.forEach(({ row, col }) => {
        // Consume the board tile immediately at fusion start.
        this.removeStaticTileAt(row, col);
        const { x: cx, y: cy } = toWorld(row, col);
        this.playRainbowMergeFx(cx, cy, 8, 11, () => {
          onDone();
          this.time.delayedCall(120, () => {
            this.registry.set(REG_WIN_EFFECT_DONE, true);
            this.game.events.emit("stateChanged");
          });
        });
      });

      // Spawn scale-in
      // During rainbow fusion, defer spawn visibility to final board render
      // to avoid "appear -> disappear -> reappear" flicker.
      if (shouldAnimateSpawn && spawnedAt) {
        const { row, col } = spawnedAt;
        const level = nextBoard[row][col];
        const container = makeContainerWithLevel(row, col, level, 11);
        // 좀 더 작은 크기에서 부드럽게 커지도록 조정
        container.setScale(0.2);
        container.setAlpha(0);
        const tween = this.tweens.add({
          targets: container,
          scale: 1,
          alpha: 1,
          duration: spawnDuration,
          ease: "Sine.easeOut",
          onComplete: () => {
            container.destroy();
            onDone();
          },
        });
        tweens.push(tween);
      }
    };

    // Movement phase
    const moveTraces = traces.filter((t) => {
      const level = previousBoard[t.from.row][t.from.col];
      return level !== 0 && (t.from.row !== t.to.row || t.from.col !== t.to.col);
    });

    if (moveTraces.length === 0) {
      runFinishPhase();
      return;
    }

    const rainbowFusionTargetKeys = new Set(rainbowMerged.map(({ row, col }) => `${row},${col}`));
    const moveTweens: Phaser.Tweens.Tween[] = [];
    let movesCompleted = 0;
    moveTraces.forEach((trace) => {
      const level = previousBoard[trace.from.row][trace.from.col];
      const container = makeContainerWithLevel(trace.from.row, trace.from.col, level, 12);
      const destX = BOARD_MARGIN + gap + trace.to.col * (CELL_SIZE + gap) + CELL_SIZE / 2;
      const destY = BOARD_TOP + gap + trace.to.row * (CELL_SIZE + gap) + CELL_SIZE / 2;
      const isRainbowFusionMove =
        level === 8 &&
        trace.mergedInto &&
        rainbowFusionTargetKeys.has(`${trace.to.row},${trace.to.col}`);
      const completeMove = () => {
        container.destroy();
        movesCompleted += 1;
        if (movesCompleted >= moveTraces.length) {
          moveTweens.forEach((t) => t.remove());
          runFinishPhase();
        }
      };

      if (isRainbowFusionMove) {
        // Remove both source and fusion-target static tiles immediately
        // so no temporary center tile flashes during rainbow fusion movement.
        this.removeStaticTileAt(trace.from.row, trace.from.col);
        this.removeStaticTileAt(trace.to.row, trace.to.col);
        const startX = container.x;
        const startY = container.y;
        const ctrlX = (startX + destX) / 2 + Phaser.Math.Between(-10, 10);
        const ctrlY = (startY + destY) / 2 - 18;
        const rainbowMoveTween = this.tweens.addCounter({
          from: 0,
          to: 1,
          duration: Math.round(moveDuration * 1.3),
          ease: "Sine.easeInOut",
          onUpdate: (tw) => {
            const t = tw.getValue();
            container.x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * ctrlX + t * t * destX;
            container.y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * ctrlY + t * t * destY;
            container.rotation = Phaser.Math.DegToRad(10) * Math.sin(Math.PI * t);
          },
          onComplete: completeMove,
        });
        const pulseTween = this.tweens.add({
          targets: container,
          scale: { from: 0.96, to: 1.16 },
          yoyo: true,
          duration: Math.round(moveDuration * 0.72),
          ease: "Cubic.easeInOut",
        });
        moveTweens.push(rainbowMoveTween, pulseTween);
      } else {
        const tween = this.tweens.add({
          targets: container,
          x: destX,
          y: destY,
          duration: moveDuration,
          ease: "Sine.easeInOut",
          onComplete: completeMove,
        });
        moveTweens.push(tween);
      }
    });
  }
}

import Phaser from "phaser";
import type { Board } from "../core/types";
import { SCENE_KEYS } from "../constants";
import { GAME_WIDTH } from "../config";
import { step as coreStep, isGameOver, hasWon, getEmptyCount } from "../core";
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
import { REG_BOARD, REG_SCORE, REG_BEST, REG_GAMEOVER, REG_HASWON, REG_ANIM_SPEED_PERCENT, REG_UI_MODAL_OPEN, REG_SWIPE_THRESHOLD, REG_WIN_EFFECT_DONE } from "../registry";

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

export class GameScene extends Phaser.Scene {
  private boardGraphics!: Phaser.GameObjects.Graphics;
  private staticTiles: Phaser.GameObjects.Image[] = [];
  private inputLocked = false;
  private lv1PipelineReady = false;
  private bufferedDirection: "up" | "down" | "left" | "right" | null = null;
  private rainbowImpactPulse!: Phaser.GameObjects.Rectangle;

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
    this.refreshBoard();
    this.setupInput();
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
      startX = p.x;
      startY = p.y;
      hasSwipeStart = true;
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
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
    });
  }

  private enqueueMove(direction: "up" | "down" | "left" | "right"): void {
    const modalOpen = this.registry.get(REG_UI_MODAL_OPEN) as boolean;
    if (modalOpen) {
      this.bufferedDirection = null;
      return;
    }
    if (this.inputLocked) {
      // Keep one latest buffered intent while animations are running.
      this.bufferedDirection = direction;
      return;
    }
    this.tryMove(direction);
  }

  private releaseInputLock(): void {
    this.inputLocked = false;
    const next = this.bufferedDirection;
    this.bufferedDirection = null;
    if (next) {
      this.tryMove(next);
    }
  }

  private clearBufferedInput(): void {
    this.bufferedDirection = null;
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
    const travelMs = Math.round(380 * m);
    const absorbMs = Math.round(160 * m);
    const afterglowMs = Math.round(120 * m);

    const container = this.add.container(cx, cy);
    container.setDepth(depth);
    const tile = this.createTileImage(0, 0, level, depth + 1);
    container.add(tile);

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

    const orb = this.add.circle(0, 0, Math.round(CELL_SIZE * 0.13), 0xffffff, 0);
    orb.setScale(0.45);
    orb.setDepth(depth + 3);
    container.add(orb);

    const trail = this.add.graphics();
    trail.setDepth(depth + 2);
    container.add(trail);
    const trailPoints: Array<{ x: number; y: number }> = [];

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
    const toLocal = (x: number, y: number): { x: number; y: number } => ({ x: x - cx, y: y - cy });

    const startMergePhase = (): void => {
      this.playGlobalRainbowImpact();
      this.game.events.emit("rainbowClimax");
      this.tweens.add({
        targets: container,
        scale: { from: 1, to: 1.15 },
        yoyo: true,
        duration: mergeMs,
        ease: "Sine.easeOut",
      });
      this.tweens.add({
        targets: burst,
        scale: 1.5,
        alpha: 0,
        duration: mergeMs,
        ease: "Sine.easeOut",
      });

      this.time.delayedCall(mergeMs, () => {
        this.tweens.add({
          targets: [tile, preGlow],
          alpha: { from: 1, to: 0 },
          duration: transformMs,
          ease: "Sine.easeIn",
        });
        this.tweens.add({
          targets: orb,
          alpha: { from: 0, to: 0.95 },
          scale: { from: 0.45, to: 1.05 },
          duration: transformMs,
          ease: "Sine.easeOut",
        });

        this.time.delayedCall(transformMs, () => {
          const travelTween = this.tweens.addCounter({
            from: 0,
            to: 1,
            duration: travelMs,
            ease: "Sine.easeInOut",
            onUpdate: (tw) => {
              const t = tw.getValue();
              const x = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * ctrlX + t * t * targetX;
              const y = (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * ctrlY + t * t * targetY;
              const local = toLocal(x, y);
              orb.setPosition(local.x, local.y);
              trailPoints.push(local);
              if (trailPoints.length > 8) trailPoints.shift();
              trail.clear();
              trailPoints.forEach((p, i) => {
                const a = (i + 1) / trailPoints.length;
                trail.fillStyle(0xffffff, a * 0.2);
                trail.fillCircle(p.x, p.y, 2 + a * 2);
              });
            },
            onComplete: () => {
              this.game.events.emit("rainbowAbsorb");
              this.tweens.add({
                targets: orb,
                alpha: 0,
                scale: 1.3,
                duration: absorbMs,
                ease: "Sine.easeOut",
                onComplete: () => {
                  this.time.delayedCall(afterglowMs, () => {
                    container.destroy(true);
                    onDone();
                  });
                },
              });
            },
          });
          void travelTween;
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

    const emptyCount = getEmptyCount(board);
    const randomIndex =
      emptyCount > 0 ? Math.floor(Math.random() * emptyCount) : 0;
    const result = coreStep(board, direction, randomIndex);
    if (!result.changed) {
      this.releaseInputLock();
      return;
    }

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
    this.registry.set(REG_WIN_EFFECT_DONE, !hasRainbowMerge);
    // UI(스코어, 오버레이)는 즉시 업데이트하되,
    // 보드 그래픽은 애니메이션 안에서 단계적으로 갱신한다.
    this.game.events.emit("stateChanged");

    this.playTileAnimations(
      board,
      result.board,
      result.traces,
      result.merged,
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
        this.staticTiles.push(tile);
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
      const finishTargets = merged.length + (spawnedAt ? 1 : 0);
      if (finishTargets === 0) {
        this.releaseInputLock();
        return;
      }

      // 이동 애니메이션 직후에는, 스폰 칸만 비운 보드를 그려서
      // 작은 점에서 커지는 효과가 더 잘 보이도록 한다.
      let baseBoard: Board = nextBoard;
      if (spawnedAt) {
        const { row, col } = spawnedAt;
        const temp: number[][] = nextBoard.map((r) => [...r]);
        temp[row][col] = 0;
        baseBoard = temp as unknown as Board;
      }
      this.renderBoard(baseBoard);

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

      // Merge pop
      merged.forEach(({ row, col }) => {
        const level = nextBoard[row][col];
        const cx = BOARD_MARGIN + gap + col * (CELL_SIZE + gap) + CELL_SIZE / 2;
        const cy = BOARD_TOP + gap + row * (CELL_SIZE + gap) + CELL_SIZE / 2;
        if (level >= 8) {
          this.playRainbowMergeFx(cx, cy, level, 11, () => {
            // 보드 렌더 확정은 즉시 진행해 타일 공백이 생기지 않게 한다.
            onDone();
            // 승리 오버레이만 살짝 늦게 띄운다.
            this.time.delayedCall(120, () => {
              this.registry.set(REG_WIN_EFFECT_DONE, true);
              this.game.events.emit("stateChanged");
            });
          });
        } else {
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
        }
      });

      // Spawn scale-in
      if (spawnedAt) {
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

    const moveTweens: Phaser.Tweens.Tween[] = [];
    let movesCompleted = 0;
    moveTraces.forEach((trace) => {
      const level = previousBoard[trace.from.row][trace.from.col];
      const container = makeContainerWithLevel(trace.from.row, trace.from.col, level, 12);
      const destX = BOARD_MARGIN + gap + trace.to.col * (CELL_SIZE + gap) + CELL_SIZE / 2;
      const destY = BOARD_TOP + gap + trace.to.row * (CELL_SIZE + gap) + CELL_SIZE / 2;

      const tween = this.tweens.add({
        targets: container,
        x: destX,
        y: destY,
        duration: moveDuration,
        ease: "Sine.easeInOut",
        onComplete: () => {
          container.destroy();
          movesCompleted += 1;
          if (movesCompleted >= moveTraces.length) {
            moveTweens.forEach((t) => t.remove());
            runFinishPhase();
          }
        },
      });
      moveTweens.push(tween);
    });
  }
}

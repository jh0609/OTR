import Phaser from "phaser";
import type { Board } from "../core/types";
import { SCENE_KEYS } from "../constants";
import { step as coreStep, isGameOver, hasWon, getEmptyCount } from "../core";
import { setBestScore } from "../storage";
import { TILE_TEXTURE_BY_LEVEL } from "../assets";
import { Lv1FringeFixPipeline } from "../pipelines/Lv1FringeFixPipeline";
import {
  BOARD_MARGIN,
  BOARD_TOP,
  BOARD_CELL_GAP,
  CELL_SIZE,
  COLORS,
} from "../config/layout";
import { REG_BOARD, REG_SCORE, REG_BEST, REG_GAMEOVER, REG_HASWON, REG_WIN_DISMISSED, REG_ANIM_SPEED_PERCENT, REG_UI_MODAL_OPEN, REG_SWIPE_THRESHOLD } from "../registry";

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
      const swipeThreshold = typeof thresholdRaw === "number" ? thresholdRaw : 55;
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
    const hasWonNow = this.registry.get(REG_HASWON) as boolean;
    const winDismissed = this.registry.get(REG_WIN_DISMISSED) as boolean;
    if (hasWonNow && !winDismissed) return;

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

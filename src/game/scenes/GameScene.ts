import Phaser from "phaser";
import type { Board } from "../core/types";
import { SCENE_KEYS } from "../constants";
import { step as coreStep, isGameOver, hasWon, getEmptyCount } from "../core";
import { setBestScore } from "../storage";
import {
  BOARD_MARGIN,
  BOARD_TOP,
  BOARD_CELL_GAP,
  CELL_SIZE,
  COLORS,
} from "../config/layout";
import { TILE_COLORS, TILE_SHADOW, TILE_SHADOW_ALPHA } from "../config/colors";
import { REG_BOARD, REG_SCORE, REG_BEST, REG_GAMEOVER, REG_HASWON } from "../registry";

// 타일이 셀의 약 70~75%를 차지하도록 약간 크게 설정.
const TILE_SIZE_RATIO = 0.45;

export class GameScene extends Phaser.Scene {
  private boardGraphics!: Phaser.GameObjects.Graphics;
  private inputLocked = false;

  constructor() {
    super({ key: SCENE_KEYS.GAME });
  }

  create(): void {
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
          if (this.inputLocked) return;
          this.tryMove(dir);
        });
      });
    }

    const swipeThreshold = 40;
    let startX = 0;
    let startY = 0;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      startX = p.x;
      startY = p.y;
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (this.inputLocked) return;
      const dx = p.x - startX;
      const dy = p.y - startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (adx > ady && adx >= swipeThreshold) {
        this.tryMove(dx > 0 ? "right" : "left");
      } else if (ady >= swipeThreshold) {
        this.tryMove(dy > 0 ? "down" : "up");
      }
    });
  }

  private tryMove(direction: "up" | "down" | "left" | "right"): void {
    const gameOver = this.registry.get(REG_GAMEOVER) as boolean;
    if (gameOver) return;

    const board = this.registry.get(REG_BOARD) as Board;
    this.inputLocked = true;

    const emptyCount = getEmptyCount(board);
    const randomIndex =
      emptyCount > 0 ? Math.floor(Math.random() * emptyCount) : 0;
    const result = coreStep(board, direction, randomIndex);
    if (!result.changed) {
      this.inputLocked = false;
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

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const level = board[r][c];
        if (level === 0) continue;
        const cx = BOARD_MARGIN + gap + c * (CELL_SIZE + gap) + CELL_SIZE / 2;
        const cy = BOARD_TOP + gap + r * (CELL_SIZE + gap) + CELL_SIZE / 2;
        const size = CELL_SIZE * TILE_SIZE_RATIO;
        this.drawTile(g, cx, cy, size, level);
      }
    }
  }

  private drawTile(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    size: number,
    level: number
  ): void {
    const shadowOff = 3;
    const baseColor = TILE_COLORS[level] ?? 0xcccccc;

    // 레인보우 타일은 전용 렌더링으로 처리.
    if (level === 8) {
      this.drawRainbowTile(g, cx, cy, size, shadowOff);
      return;
    }

    const shapeLevel = level;

    const drawShapeAtSize = (ox: number, oy: number, s: number, col: number, alpha: number) => {
      g.fillStyle(col, alpha);
      const x = cx + ox;
      const y = cy + oy;

      switch (shapeLevel) {
        case 1:
          g.fillCircle(x, y, s);
          break;
        case 2: {
          // 단순하지만 덜 뾰족한 이등변 삼각형
          const h = s * 0.9;
          const halfBase = s * 0.9;
          g.fillTriangle(
            x,            y - h,          // top
            x + halfBase, y + h * 0.75,   // bottom-right
            x - halfBase, y + h * 0.75    // bottom-left
          );
          break;
        }
        case 3:
          g.fillRoundedRect(x - s, y - s, s * 2, s * 2, 6);
          break;
        case 4: {
          const pts: Phaser.Geom.Point[] = [];
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
            const px = x + Math.cos(a) * s;
            const py = y + Math.sin(a) * s;
            pts.push(new Phaser.Geom.Point(px, py));
          }
          g.fillPoints(pts, true);
          break;
        }
        case 5: {
          const pts: Phaser.Geom.Point[] = [];
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 - Math.PI / 8;
            const px = x + Math.cos(a) * s;
            const py = y + Math.sin(a) * s;
            pts.push(new Phaser.Geom.Point(px, py));
          }
          g.fillPoints(pts, true);
          const rCorner = s * 0.2;
          pts.forEach((p) => g.fillCircle(p.x, p.y, rCorner));
          break;
        }
        case 6: {
          const outer = s;
          const inner = s * 0.6; // 덜 뾰족한 별
          const pts: Phaser.Geom.Point[] = [];
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? outer : inner;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            pts.push(new Phaser.Geom.Point(px, py));
          }
          g.fillPoints(pts, true);
          const rCorner = s * 0.18;
          // 바깥 꼭짓점에만 부드러운 라운딩
          pts.filter((_, i) => i % 2 === 0).forEach((p) => g.fillCircle(p.x, p.y, rCorner));
          break;
        }
        case 7: {
          const outer = s;
          const inner = s * 0.75; // 더 부드러운 꽃/별 느낌
          const pts: Phaser.Geom.Point[] = [];
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2 - Math.PI / 16;
            const r = i % 2 === 0 ? outer : inner;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            pts.push(new Phaser.Geom.Point(px, py));
          }
          g.fillPoints(pts, true);
          const rCorner = s * 0.18;
          pts.filter((_, i) => i % 2 === 0).forEach((p) => g.fillCircle(p.x, p.y, rCorner));
          break;
        }
        default:
          g.fillCircle(x, y, s * 0.5);
      }
    };

    // 1) 부드러운 드롭 섀도우
    drawShapeAtSize(shadowOff, shadowOff, size, TILE_SHADOW, TILE_SHADOW_ALPHA);
    // 2) 본체
    drawShapeAtSize(0, 0, size, baseColor, 1);
    // 3) 은은한 외곽선(밝은 링)
    drawShapeAtSize(0, 0, size * 1.04, 0xffffff, 0.22);
  }

  private drawRainbowTile(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    size: number,
    shadowOff: number
  ): void {
    const baseRadius = size * 0.55;
    const width = size * 2;
    const height = size * 2;
    const left = cx - size;
    const top = cy - size;

    // 1) 부드러운 드롭 섀도우
    g.fillStyle(TILE_SHADOW, TILE_SHADOW_ALPHA);
    g.fillRoundedRect(left + shadowOff, top + shadowOff, width, height, baseRadius);

    // 2) 베이스 바탕 (밝은 톤)
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(left, top, width, height, baseRadius);

    // 3) 레인보우 수평 밴드
    const bandColors = [
      0xf36c6c, // red
      0xf5a742, // orange
      0xf7d64a, // yellow
      0x64c878, // green
      0x5a8cf0, // blue
      0x4655b8, // indigo
      0xca78f5, // violet
    ];
    const innerPaddingX = size * 0.18;
    const innerPaddingY = size * 0.18;
    const innerLeft = left + innerPaddingX;
    const innerTop = top + innerPaddingY;
    const innerWidth = width - innerPaddingX * 2;
    const innerHeight = height - innerPaddingY * 2;
    const bandHeight = innerHeight / bandColors.length;

    bandColors.forEach((col, index) => {
      const y = innerTop + bandHeight * index;
      const isFirst = index === 0;
      const isLast = index === bandColors.length - 1;
      const radius = isFirst || isLast ? baseRadius * 0.5 : 0;
      g.fillStyle(col, 1);
      if (radius > 0) {
        g.fillRoundedRect(innerLeft, y, innerWidth, bandHeight + 0.5, radius);
      } else {
        g.fillRect(innerLeft, y, innerWidth, bandHeight + 0.5);
      }
    });

    // 4) 은은한 외곽선
    g.lineStyle(2, 0xffffff, 0.6);
    g.strokeRoundedRect(left, top, width, height, baseRadius);
  }

  // drawRoundedPolygon 헬퍼는 현재 사용하지 않으므로 제거했습니다.

  private playTileAnimations(
    previousBoard: Board,
    nextBoard: Board,
    traces: { from: { row: number; col: number }; to: { row: number; col: number }; mergedInto: boolean }[],
    merged: { row: number; col: number }[],
    spawnedAt: { row: number; col: number } | null
  ): void {
    const gap = BOARD_CELL_GAP;
    const moveDuration = 140;

    const makeContainerWithLevel = (
      row: number,
      col: number,
      level: number,
      depth = 10
    ): Phaser.GameObjects.Container => {
      const cx = BOARD_MARGIN + gap + col * (CELL_SIZE + gap) + CELL_SIZE / 2;
      const cy = BOARD_TOP + gap + row * (CELL_SIZE + gap) + CELL_SIZE / 2;
      const size = CELL_SIZE * 0.4;
      const g = this.add.graphics();
      this.drawTile(g, 0, 0, size, level);
      const container = this.add.container(cx, cy, [g]);
      container.setDepth(depth);
      return container;
    };

    const runFinishPhase = () => {
      const tweens: Phaser.Tweens.Tween[] = [];
      const finishTargets = merged.length + (spawnedAt ? 1 : 0);
      if (finishTargets === 0) {
        this.inputLocked = false;
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
          this.inputLocked = false;
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
          duration: 90,
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
          duration: 190,
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

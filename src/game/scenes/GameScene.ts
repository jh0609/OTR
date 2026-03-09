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
        const size = CELL_SIZE * 0.4;
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
    const color = TILE_COLORS[level] ?? 0xcccccc;

    const drawShape = (ox: number, oy: number, col: number, alpha: number) => {
      g.fillStyle(col, alpha);
      const x = cx + ox;
      const y = cy + oy;

      switch (level) {
        case 1:
          g.fillCircle(x, y, size);
          break;
        case 2: {
          const h = size * 1.2;
          g.fillTriangle(
            x, y - h,
            x - size, y + h * 0.6,
            x + size, y + h * 0.6
          );
          break;
        }
        case 3:
          g.fillRoundedRect(x - size, y - size, size * 2, size * 2, 4);
          break;
        case 4: {
          const pts: Phaser.Geom.Point[] = [];
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
            const px = x + Math.cos(a) * size;
            const py = y + Math.sin(a) * size;
            pts.push(new Phaser.Geom.Point(px, py));
          }
          g.fillPoints(pts, true);
          break;
        }
        case 5: {
          const pts: Phaser.Geom.Point[] = [];
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 - Math.PI / 8;
            const px = x + Math.cos(a) * size;
            const py = y + Math.sin(a) * size;
            pts.push(new Phaser.Geom.Point(px, py));
          }
          g.fillPoints(pts, true);
          break;
        }
        case 6: {
          const outer = size;
          const inner = size * 0.45;
          const pts: Phaser.Geom.Point[] = [];
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? outer : inner;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            pts.push(new Phaser.Geom.Point(px, py));
          }
          g.fillPoints(pts, true);
          break;
        }
        case 7: {
          const outer = size;
          const inner = size * 0.55;
          const pts: Phaser.Geom.Point[] = [];
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2 - Math.PI / 16;
            const r = i % 2 === 0 ? outer : inner;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            pts.push(new Phaser.Geom.Point(px, py));
          }
          g.fillPoints(pts, true);
          break;
        }
        case 8: {
          g.fillStyle(0xe8a0a0, alpha);
          g.fillRoundedRect(x - size, y - size, size * 2, size * 2, size * 0.4);
          g.fillStyle(0xf0e890, alpha * 0.9);
          g.fillRoundedRect(x - size * 0.7, y - size * 0.7, size * 1.4, size * 1.4, size * 0.3);
          g.fillStyle(0x90d8d8, alpha * 0.8);
          g.fillRoundedRect(x - size * 0.4, y - size * 0.4, size * 0.8, size * 0.8, size * 0.2);
          return;
        }
        default:
          g.fillCircle(x, y, size * 0.5);
      }
    };

    drawShape(shadowOff, shadowOff, TILE_SHADOW, TILE_SHADOW_ALPHA);
    drawShape(0, 0, color, 1);
  }

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

       // 이동 애니메이션이 끝난 시점에 실제 보드를 최종 상태로 다시 그림.
       this.renderBoard(nextBoard);

      let finished = 0;
      const onDone = () => {
        finished += 1;
        if (finished >= finishTargets) {
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
        container.setScale(0.3);
        container.setAlpha(0);
        const tween = this.tweens.add({
          targets: container,
          scale: 1,
          alpha: 1,
          duration: 140,
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

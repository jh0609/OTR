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
        key.on("down", () => this.tryMove(dir));
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
    const emptyCount = getEmptyCount(board);
    if (emptyCount === 0) return;

    const randomIndex = Math.floor(Math.random() * emptyCount);
    const result = coreStep(board, direction, randomIndex);
    if (!result.changed) return;

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
    this.refreshBoard();
    this.events.emit("stateChanged");
  }

  refreshBoard(): void {
    const board = this.registry.get(REG_BOARD) as Board | undefined;
    if (!board) return;

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
          const pts: number[] = [];
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
            pts.push(x + Math.cos(a) * size, y + Math.sin(a) * size);
          }
          g.fillPoints(pts, true);
          break;
        }
        case 5: {
          const pts: number[] = [];
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 - Math.PI / 8;
            pts.push(x + Math.cos(a) * size, y + Math.sin(a) * size);
          }
          g.fillPoints(pts, true);
          break;
        }
        case 6: {
          const outer = size;
          const inner = size * 0.45;
          const pts: number[] = [];
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? outer : inner;
            pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
          }
          g.fillPoints(pts, true);
          break;
        }
        case 7: {
          const outer = size;
          const inner = size * 0.55;
          const pts: number[] = [];
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2 - Math.PI / 16;
            const r = i % 2 === 0 ? outer : inner;
            pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
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
}

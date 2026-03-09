/** Pastel tile colors by level (1-8). */
export const TILE_COLORS: Record<number, number> = {
  1: 0xe8a0a0, // red
  2: 0xe8c090, // orange
  3: 0xf0e890, // yellow
  4: 0xa8d8a0, // green
  5: 0x90d8d8, // cyan
  6: 0x90b0e8, // blue
  7: 0xc8a8e0, // purple
  8: 0xffffff, // rainbow (we'll use gradient in draw)
};

export const TILE_SHADOW = 0x000000;
export const TILE_SHADOW_ALPHA = 0.2;

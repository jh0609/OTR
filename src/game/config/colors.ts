/** Pastel-but-vivid tile colors by level (1-8). */
export const TILE_COLORS: Record<number, number> = {
  1: 0xf36c6c, // warm red
  2: 0xf5a742, // peachy orange
  3: 0xf7d64a, // richer yellow for contrast
  4: 0x64c878, // soft green
  5: 0x52d1d1, // brighter cyan
  6: 0x5a8cf0, // clear blue
  7: 0xca78f5, // vivid purple
  8: 0xffffff, // rainbow base (gradient/glow in drawTile)
};

export const TILE_SHADOW = 0x000000;
export const TILE_SHADOW_ALPHA = 0.18;

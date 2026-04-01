export const TILE_TEXTURE_BY_LEVEL: Record<number, string> = {
  1: "tile-lv1",
  2: "tile-lv2",
  3: "tile-lv3",
  4: "tile-lv4",
  5: "tile-lv5",
  6: "tile-lv6",
  7: "tile-lv7",
  8: "tile-lv8",
};

export const TILE_TEXTURE_SOURCES: Array<{ key: string; path: string }> = [
  { key: TILE_TEXTURE_BY_LEVEL[1], path: "assets/raw/1.png" },
  { key: TILE_TEXTURE_BY_LEVEL[2], path: "assets/raw/2.png" },
  { key: TILE_TEXTURE_BY_LEVEL[3], path: "assets/raw/3.png" },
  { key: TILE_TEXTURE_BY_LEVEL[4], path: "assets/raw/4.png" },
  { key: TILE_TEXTURE_BY_LEVEL[5], path: "assets/raw/5.png" },
  { key: TILE_TEXTURE_BY_LEVEL[6], path: "assets/raw/6.png" },
  { key: TILE_TEXTURE_BY_LEVEL[7], path: "assets/raw/7.png" },
  { key: TILE_TEXTURE_BY_LEVEL[8], path: "assets/raw/8.png" },
];


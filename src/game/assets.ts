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
  { key: TILE_TEXTURE_BY_LEVEL[1], path: "assets/tiles/tile_lv1_red_circle.png" },
  { key: TILE_TEXTURE_BY_LEVEL[2], path: "assets/tiles/tile_lv2_orange_triangle.png" },
  { key: TILE_TEXTURE_BY_LEVEL[3], path: "assets/tiles/tile_lv3_yellow_square.png" },
  { key: TILE_TEXTURE_BY_LEVEL[4], path: "assets/tiles/tile_lv4_green_hexagon.png" },
  { key: TILE_TEXTURE_BY_LEVEL[5], path: "assets/tiles/tile_lv5_cyan_octagon.png" },
  { key: TILE_TEXTURE_BY_LEVEL[6], path: "assets/tiles/tile_lv6_blue_star.png" },
  { key: TILE_TEXTURE_BY_LEVEL[7], path: "assets/tiles/tile_lv7_purple_octagram.png" },
  { key: TILE_TEXTURE_BY_LEVEL[8], path: "assets/tiles/tile_lv8_rainbow_rounded_square.png" },
];


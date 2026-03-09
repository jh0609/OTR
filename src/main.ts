import Phaser from "phaser";
import { getPhaserConfig } from "./game/config";

const container = document.getElementById("game-container") ?? document.querySelector("#game-shell #game-container");
if (!container || !(container instanceof HTMLElement)) {
  throw new Error("Missing #game-container element.");
}

const config = getPhaserConfig(container);
// Expose the Phaser game instance in case debugging or tooling needs access.
export const game = new Phaser.Game(config);

import { getPhaserConfig } from "./game/config";

const container = document.getElementById("game-container") ?? document.querySelector("#game-shell #game-container");
if (!container || !(container instanceof HTMLElement)) {
  throw new Error("Missing #game-container element.");
}

const config = getPhaserConfig(container);
const game = new Phaser.Game(config);

export { game };

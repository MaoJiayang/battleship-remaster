import "./styles/base.css";
import "./styles/ships.css";
import { initGame } from "./game/game";
import { GAME_TITLE, GAME_VERSION } from "./config/constants";

window.addEventListener("DOMContentLoaded", () => {
  const titleEl = document.querySelector("header h1");
  if (titleEl) {
    titleEl.textContent = `${GAME_TITLE} (${GAME_VERSION})`;
  }
  initGame();
});

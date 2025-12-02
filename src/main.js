import "./styles/base.css";
import "./styles/ships.css";
import { initGame } from "./game/game";
import { GAME_TITLE, GAME_VERSION } from "./config/constants";

// 导入参数调优工具（暴露到全局 window.GridSearch）
import "./ai/GridSearch.js";

window.addEventListener("DOMContentLoaded", () => {
  const titleEl = document.querySelector("header h1");
  if (titleEl) {
    titleEl.textContent = `${GAME_TITLE} (${GAME_VERSION})`;
  }
  initGame();
});

import { startGame } from "./game.js";

const menu = document.getElementById("menu");
const playBtn = document.getElementById("play-btn");
const status = document.getElementById("status");
const usernameInput = document.getElementById("username");

playBtn.addEventListener("click", async () => {
  playBtn.disabled = true;
  status.textContent = "Connecting...";
  try {
    await startGame();
    menu.remove();
  } catch (error) {
    console.error(error);
    status.textContent = error.message;
    playBtn.disabled = false;
  }
});

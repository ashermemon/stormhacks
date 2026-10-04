import { startGame } from "./game.js";
import { identity } from "./identity.js";
import { enterFullscreen, keepFullscreen } from "./fullscreen.js";

const menu = document.getElementById("menu");
const playBtn = document.getElementById("play-btn");
const usernameInput = document.getElementById("username");
const status = document.getElementById("status");

usernameInput.value = identity.getName();

usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") playBtn.click();
});

playBtn.addEventListener("click", async () => {
  const name = usernameInput.value.trim();
  if (!name) {
    status.textContent = "Enter a name first.";
    usernameInput.focus();
    return;
  }
  identity.setName(name);
  enterFullscreen(); // needs this click, so before anything async
  keepFullscreen();

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

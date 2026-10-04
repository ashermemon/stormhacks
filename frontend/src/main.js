import { startGame } from "./game.js";
import { identity } from "./identity.js";

const menu = document.getElementById("menu");
const playBtn = document.getElementById("play-btn");
const usernameInput = document.getElementById("username");
const status = document.getElementById("status");

usernameInput.value = identity.getName();
function launchFullScreen(element) {
  if(element.requestFullScreen) {
    element.requestFullScreen();
  } else if(element.mozRequestFullScreen) {
    element.mozRequestFullScreen();
  } else if(element.webkitRequestFullScreen) {
    element.webkitRequestFullScreen();
  }
}

// Launch fullscreen for browsers that support it!
launchFullScreen(document.documentElement);
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

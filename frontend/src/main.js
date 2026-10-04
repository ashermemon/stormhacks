import { loadScene, startGame } from "./game.js";
import { startMenuTour } from "./menuTour.js";
import { identity } from "./identity.js";
import { enterFullscreen, keepFullscreen } from "./fullscreen.js";
import { playMusic } from "./music.js";

const menu = document.getElementById("menu");
const playBtn = document.getElementById("play-btn");
const usernameInput = document.getElementById("username");
const status = document.getElementById("status");

usernameInput.value = identity.getName();

playMusic("menu");

// Load the world straight away and film it behind the menu until Play.
status.textContent = "Loading the river, this may take a while...";
const scenePromise = loadScene().then((view) => {
  startMenuTour(view, document.getElementById("menu-fade"));
  menu.classList.add("ready");
  if (!playBtn.disabled) status.textContent = "";
  return view;
});
scenePromise.catch((error) => {
  console.error(error);
  status.textContent = "Couldn't load the world. Try reloading.";
});
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
  enterFullscreen(); // needs this click, so before anything async
  playMusic("game"); // also a click-only thing, for browsers that block autoplay
  keepFullscreen();

  playBtn.disabled = true;
  status.textContent = "Connecting…";
  try {
    const view = await scenePromise;
    // Dip to dark while the camera jumps from the tour to your otter, then fade the menu away.
    menu.classList.add("covering");
    await startGame(view);
    menu.classList.add("leaving");
    setTimeout(() => menu.remove(), 900);
  } catch (error) {
    console.error(error);
    menu.classList.remove("covering");
    playMusic("menu");
    status.textContent = error.message;
    playBtn.disabled = false;
  }
});

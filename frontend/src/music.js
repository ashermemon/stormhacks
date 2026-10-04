import menuUrl from "../assets/music/menu.ogg?url";
import gameUrl from "../assets/music/game.mp3?url";

// Looping background music: one track for the menu, one for the game, crossfaded.
// Browsers refuse to start audio before the user has interacted with the page, so a
// refused track waits for the first click, tap or key press and starts then.

const VOLUME = 0.4;
const FADE_SECONDS = 1.5;

const tracks = {
  menu: makeTrack(menuUrl, "auto"),
  game: makeTrack(gameUrl, "none"), // fetched on Play, so it doesn't compete with loading the world
};
let current = null;

function makeTrack(url, preload) {
  const audio = new Audio(url);
  audio.loop = true;
  audio.preload = preload;
  audio.volume = 0;
  return audio;
}

function fade(audio, target, onDone) {
  clearInterval(audio.fadeTimer);
  const step = (VOLUME * 0.05) / FADE_SECONDS; // 20 steps a second
  audio.fadeTimer = setInterval(() => {
    const next = audio.volume + Math.sign(target - audio.volume) * step;
    const done = Math.abs(target - next) <= step;
    audio.volume = done ? target : next;
    if (done) {
      clearInterval(audio.fadeTimer);
      onDone?.();
    }
  }, 50);
}

function startWhenAllowed(name) {
  const audio = tracks[name];
  audio.play().catch(() => {
    const retry = () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      if (current === name) audio.play().catch(() => {});
    };
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);
  });
}

/** Fades to the "menu" or "game" track (the other one fades out and pauses). */
export function playMusic(name) {
  if (current === name) return;
  const previous = current && tracks[current];
  current = name;
  if (previous) fade(previous, 0, () => previous.pause());
  startWhenAllowed(name);
  fade(tracks[name], VOLUME);
}

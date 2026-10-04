// Fullscreen on PC and phones. Browsers only allow it from a user gesture (a click or
// tap), so call this straight from the handler, before anything async. iPhone Safari
// has no fullscreen for web pages, so there it quietly does nothing.

export function enterFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const root = document.documentElement;
  const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
  if (!request) return;
  try {
    request.call(root, { navigationUI: "hide" })?.catch?.(() => {});
  } catch {
    // Refused (no gesture, or not allowed in this frame): stay windowed.
  }
}

let keeping = false;

/** Re-enter fullscreen on the next click or tap after leaving it (e.g. with Esc). */
export function keepFullscreen() {
  if (keeping) return;
  keeping = true;
  window.addEventListener("pointerdown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    enterFullscreen();
  });
}

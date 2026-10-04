const down = new Set();

/** Touch / on-screen control state, combined with keyboard in the getters below. */
const touch = {
  forward: 0,
  right: 0,
  jump: false,
  sink: false,
};

window.addEventListener('keydown', (e) => {
  // Typing in a text box (chat, name) must not move the avatar. keyup is not
  // filtered, so keys held when the box opened still get released.
  if (e.target instanceof HTMLInputElement) return;
  down.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => down.delete(e.code));
window.addEventListener('blur', () => down.clear());

export function setTouchAxes(forward, right) {
  touch.forward = Math.max(-1, Math.min(1, forward));
  touch.right = Math.max(-1, Math.min(1, right));
}

export function setTouchButton(name, pressed) {
  if (name === 'jump') touch.jump = pressed;
  else if (name === 'sink') touch.sink = pressed;
}

function clampAxis(v) {
  return Math.max(-1, Math.min(1, v));
}

export const keys = {
  /** Movement axes in [-1, 1]. forward: +1 = away from camera. right: +1 = to the right. */
  axes() {
    const forward =
      (down.has('KeyW') || down.has('ArrowUp') ? 1 : 0) -
      (down.has('KeyS') || down.has('ArrowDown') ? 1 : 0) +
      touch.forward;
    const right =
      (down.has('KeyD') || down.has('ArrowRight') ? 1 : 0) -
      (down.has('KeyA') || down.has('ArrowLeft') ? 1 : 0) +
      touch.right;
    return { forward: clampAxis(forward), right: clampAxis(right) };
  },
  jump: () => down.has('Space') || touch.jump,
  /** Camera orbit axis: +1 = E, -1 = Q. */
  orbit: () => (down.has('KeyE') ? 1 : 0) - (down.has('KeyQ') ? 1 : 0),
  /** In water: Space swims up (hold to keep rising), Shift dives (hold to keep going down). */
  rise: () => down.has('Space') || touch.jump,
  dive: () => down.has('ShiftLeft') || down.has('ShiftRight') || touch.sink,
};

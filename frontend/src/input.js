const down = new Set();

window.addEventListener('keydown', (e) => {
  // Typing in a text box (chat, name) must not move the avatar. keyup is not
  // filtered, so keys held when the box opened still get released.
  if (e.target instanceof HTMLInputElement) return;
  down.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => down.delete(e.code));
window.addEventListener('blur', () => down.clear());

export const keys = {
  /** Movement axes in [-1, 1]. forward: +1 = away from camera. right: +1 = to the right. */
  axes() {
    const forward = (down.has('KeyW') || down.has('ArrowUp') ? 1 : 0) - (down.has('KeyS') || down.has('ArrowDown') ? 1 : 0);
    const right = (down.has('KeyD') || down.has('ArrowRight') ? 1 : 0) - (down.has('KeyA') || down.has('ArrowLeft') ? 1 : 0);
    return { forward, right };
  },
  jump: () => down.has('Space'),
  /** Camera orbit axis: +1 = E, -1 = Q. */
  
  /** In water: Space dives (hold to keep going down), Shift swims back up. */
  dive: () => down.has('Space'),
  rise: () => down.has('ShiftLeft') || down.has('ShiftRight'),
  orbit: () => (down.has('KeyE') ? 1 : 0) - (down.has('KeyQ') ? 1 : 0),
};

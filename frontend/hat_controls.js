import { createHatWardrobe } from "./hats.js";

let hatWardrobe = null;

export function setupHatControls(getCharacter, playerId) {
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.repeat) return;

    if (e.code !== "KeyP") return;

    const character = getCharacter(playerId);

    if (!character) {
      console.warn(
        "Cannot open hat wardrobe: character not loaded.",
      );
      return;
    }

    if (!hatWardrobe) {
      hatWardrobe = createHatWardrobe(character);
    }

    hatWardrobe.toggle();
  });

  return {
    toggle() {
      const character = getCharacter(playerId);

      if (!character) return;

      if (!hatWardrobe) {
        hatWardrobe =
          createHatWardrobe(character);
      }

      hatWardrobe.toggle();
    },

    getWardrobe() {
      return hatWardrobe;
    },
  };
}

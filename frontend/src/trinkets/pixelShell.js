// A pixel-art scallop shell for the shell counter, drawn to sit beside the Pixelta
// font: one SVG rect per pixel with crisp edges, so it stays sharp at any size.
// Colours: the game's dark brown ink outline, cream and peach ridges, coral hinge.

const PALETTE = {
  o: "#3c220e", // ink outline (the same as every outline in the world)
  h: "#fff7ea", // highlight
  a: "#ffe9cc", // cream
  b: "#ef8a62", // ridges
  p: "#f7b38c", // peach shading low on the shell
  c: "#e77556", // coral hinge ears
};

// 15 x 13: ridges fan out from the hinge at the bottom, with its two little "ears".
const PIXELS = [
  "....ooooooo....",
  "..oobaabaaboo..",
  ".oahbaabaabaao.",
  "obhaabababaaabo",
  "oabaabababaabao",
  "oaabababababaao",
  ".oabababababao.",
  "..opbpbbbpbpo..",
  "...opbpbpbpo...",
  "....opbbbpo....",
  "...oocpppcoo...",
  "...occpppcco...",
  "...ooooooooo...",
];

export const PIXEL_SHELL_SVG = (() => {
  const rects = [];
  PIXELS.forEach((row, y) => {
    [...row].forEach((key, x) => {
      if (PALETTE[key]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${PALETTE[key]}"/>`);
    });
  });
  return `<svg class="pixel-shell" viewBox="0 0 15 13" shape-rendering="crispEdges" aria-hidden="true">${rects.join("")}</svg>`;
})();

import * as THREE from "three";
import pixeltaUrl from "../assets/fonts/Pixelta.ttf?url";

const FONT_FAMILY = "Pixelta";
// Pixelta has fine stepped outlines, so draw it large rather than at a tiny pixel size.
const FONT_SIZE = 64;
const ASCENT = 0.85;
const DESCENT = 0.213;
const PADDING_X = 12;
const PADDING_Y = 4;
const BACKGROUND = "rgba(0, 0, 0, 0.35)";
const WORLD_HEIGHT = 0.3;

const fontFace = new FontFace(FONT_FAMILY, `url(${pixeltaUrl})`);
const fontReady = fontFace
  .load()
  .then(() => document.fonts.add(fontFace))
  .catch((error) => console.error("Failed to load nametag font", error));
let fontLoaded = false;
fontReady.then(() => (fontLoaded = true));

let lastUsername = "";

export function getUsername() {
  const value = document.getElementById("username")?.value.trim();
  if (value) lastUsername = value;
  return lastUsername || "Player";
}

function paintNametag(sprite, text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `${FONT_SIZE}px ${FONT_FAMILY}, monospace`;

  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + PADDING_X * 2;
  canvas.height = Math.ceil(FONT_SIZE * (ASCENT + DESCENT)) + PADDING_Y * 2;

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = font;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, PADDING_X, PADDING_Y + Math.round(FONT_SIZE * ASCENT));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  sprite.material.map?.dispose();
  sprite.material.map = texture;
  sprite.material.needsUpdate = true;
  sprite.scale.set((WORLD_HEIGHT * canvas.width) / canvas.height, WORLD_HEIGHT, 1);
}

export function createNametag(text) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ depthTest: false, transparent: true }),
  );
  sprite.renderOrder = 999;
  paintNametag(sprite, text);

  if (!fontLoaded) {
    fontReady.then(() => {
      if (sprite.material.map) paintNametag(sprite, text);
    });
  }
  return sprite;
}

export function disposeNametag(sprite) {
  sprite.material.map?.dispose();
  sprite.material.map = null;
  sprite.material.dispose();
}

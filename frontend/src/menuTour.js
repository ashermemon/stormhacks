import * as THREE from "three";
import { updateWater } from "./watershader.js";
import { updateWind } from "./toonshading.js";
import { WATER_SURFACE_Y } from "./world.js";

// The menu's background: the real world, filmed by a slow camera gliding through a
// few shots of the map, dipping to dark between them. Water flows, grass sways and
// the day/night cycle keeps running. startGame() takes over the render loop on Play.
//
// Each shot glides the camera from `from` to `to` while it looks from `look` to
// `lookTo`. Heights (the middle numbers) are above the ground, or above the water
// where there is some.

const SHOT_SECONDS = 10;
const FADE_SECONDS = 0.9; // dip to dark at the start and end of each shot
export const SHOTS = [
  // Low along the stream, toward the pond and the twisted trees.
  { from: [10, 2.2, -50], to: [5, 2.2, -32], look: [-12, 1, 20], lookTo: [-16, 1, 24] },
  // Across the pond to the mountains.
  { from: [30, 7, 55], to: [14, 7, 60], look: [-25, 3, 18], lookTo: [-30, 3, 14] },
  // High over the meadow, the whole valley below.
  { from: [60, 22, -30], to: [55, 22, 5], look: [0, 0, 5], lookTo: [-5, 0, 10] },
  // Low over the pond, looking out across it.
  { from: [2, 2.5, 46], to: [-12, 2.5, 49], look: [-38, 3, 2], lookTo: [-42, 3, 6] },
];

const smooth = (t) => t * t * (3 - 2 * t);

export function startMenuTour(view, fadeElement) {
  const { scene, environment, world, scenery, camera, renderer, fish } = view;
  const ground = (x, z) => Math.max(world.getGroundHeight(x, z), WATER_SURFACE_Y);
  const clock = new THREE.Clock();
  const nobody = { x: 1e4, y: 0, z: 1e4 }; // fish have no one to flee from
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();
  const lerp = (a, b, t) => a + (b - a) * t;
  const place = (out, a, b, t) => {
    const x = lerp(a[0], b[0], t);
    const z = lerp(a[2], b[2], t);
    return out.set(x, ground(x, z) + lerp(a[1], b[1], t), z);
  };

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const time = clock.elapsedTime;
    const shot = SHOTS[Math.floor(time / SHOT_SECONDS) % SHOTS.length];
    const into = time % SHOT_SECONDS;
    const t = smooth(into / SHOT_SECONDS);
    place(position, shot.from, shot.to, t);
    place(target, shot.look, shot.lookTo, t);
    camera.position.copy(position);
    camera.lookAt(target);

    const edge = Math.min(into, SHOT_SECONDS - into);
    if (fadeElement) fadeElement.style.opacity = String(1 - smooth(Math.min(1, edge / FADE_SECONDS)));

    updateWater(time);
    updateWind(time);
    fish.update(dt, nobody);
    scenery.update(camera);
    environment.update(camera, time);
    renderer.render(scene, camera);
  });
}

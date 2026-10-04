import * as THREE from "three";
import { isOnWater } from "./functions.js";

export const WATER_WIDTH = 14;
const WATER_DEPTH = 80;
const WATER_HEIGHT = 18;
const WATER_X = 0;
const WATER_Y = -9;
const WATER_Z = 0;
export const WATER_BOTTOM = WATER_Y - WATER_HEIGHT / 2;
const GRAVITY = 25;
const JUMP_VELOCITY = 9;
const DIVE_ANGLE = (35 * Math.PI) / 180;
const DIVE_SPEED = 3.5;
const RISE_SPEED = 3;
const SWIM_WALL_MARGIN = 0.5;
const SWIM_FLOOR_MARGIN = 0.6;



const underwaterOverlay = document.createElement('div');

underwaterOverlay.style.position = 'fixed';
underwaterOverlay.style.inset = '0';
underwaterOverlay.style.background = 'rgba(0, 100, 255, 0.35)';
underwaterOverlay.style.pointerEvents = 'none';
underwaterOverlay.style.zIndex = '9999';
underwaterOverlay.style.opacity = '0';
underwaterOverlay.style.transition = 'opacity 0.3s ease';

document.body.appendChild(underwaterOverlay);

export function createAquaticArea(scene) {
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(WATER_WIDTH, WATER_HEIGHT, WATER_DEPTH),
    new THREE.MeshStandardMaterial({
      color: 0x087fca,
      transparent: true,
      opacity: 0.58,
      roughness: 0.2,
      metalness: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  water.position.set(WATER_X, WATER_Y, WATER_Z);
  scene.add(water);

  const waterSurface = water.position.y + WATER_HEIGHT / 2;
  const bounds = {
    minX: WATER_X - WATER_WIDTH / 2 + SWIM_WALL_MARGIN,
    maxX: WATER_X + WATER_WIDTH / 2 - SWIM_WALL_MARGIN,
    minZ: WATER_Z - WATER_DEPTH / 2 + SWIM_WALL_MARGIN,
    maxZ: WATER_Z + WATER_DEPTH / 2 - SWIM_WALL_MARGIN,
    minY: WATER_BOTTOM + SWIM_FLOOR_MARGIN,
  };
  // null = on land / in the air, "surface" = swimming on top, "under" = below the surface.
  let swimState = null;
  let jumpWasDown = false;

  function stepVerticalMotion(player, controls, dt, overArenaFloor) {
    const onWater = isOnWater(player, water);
    const jumpPressed = controls.jumpDown && !jumpWasDown;
    jumpWasDown = controls.jumpDown;

    if (!onWater) swimState = null;

    if (swimState === null) {
      if (jumpPressed && player.y === 0) player.vy = JUMP_VELOCITY;
      player.vy -= GRAVITY * dt;
      player.y += player.vy * dt;
      if (onWater && player.y <= waterSurface) {
        if (player.vy < -0.5) {
          // A jump landing in the water carries its downward momentum into a sink animation.
          swimState = "under";
          player.vy = -Math.min(14, Math.abs(player.vy) * 1.4);
        } else {
          swimState = "surface";
        }
      } else if (!onWater && overArenaFloor && player.y <= 0) {
        player.y = 0;
        player.vy = 0;
      }
    }

    if (swimState === "surface") {
      player.y = waterSurface;
      player.vy = 0;
      if (controls.dive) swimState = "under";
    }

    if (swimState === "under") {
      if (controls.dive) {
        // The tilt is baked into the Dive clip, so travel along that same angle.
        const step = DIVE_SPEED * dt;
        player.x += Math.sin(player.ry) * Math.cos(DIVE_ANGLE) * step;
        player.z += Math.cos(player.ry) * Math.cos(DIVE_ANGLE) * step;
        player.y -= Math.sin(DIVE_ANGLE) * step;
        player.vy = 0;
      } else if (controls.rise) {
        player.y += RISE_SPEED * dt;
        player.vy = 0;
      } else {
        player.y += player.vy * dt;
        player.vy *= Math.exp(-3.5 * dt);
      }
      if (player.y >= waterSurface) {
        player.y = waterSurface;
        swimState = "surface";
      }
      // Underwater you're boxed in by the banks and the bed.
      player.x = Math.min(bounds.maxX, Math.max(bounds.minX, player.x));
      player.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, player.z));
      player.y = Math.max(bounds.minY, player.y);
    }

    const underwater = swimState === "under" && player.y < -1;
    underwaterOverlay.style.opacity = underwater ? "1" : "0";
  }

  // Which swim animation fits an otter at this position moving vertically at vy.
  // Works for remote players too, since it only needs what the network sends.
  function swimModeAt(position, vy) {
    if (!isOnWater(position, water) || position.y > waterSurface + 0.05) {
      return "land";
    }
    if (position.y > waterSurface - 0.15) return "surface";
    if (vy > 0.3) return "rise";
    if (vy < -0.3) return "dive";
    return "hover";
  }

  return {
    stepPhysics: stepVerticalMotion,
    swimState: () => swimState,
    swimModeAt,
  };
}

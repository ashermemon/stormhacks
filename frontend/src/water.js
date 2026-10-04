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
const UP_SPEED = 2;
const DOWN_SPEED = 2;
const WATER_JUMP_VELOCITY = 8;



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
  let wasOnWater = false;
  let leftWaterUnderwater = false;
  let jumpWasDown = false;

  function stepVerticalMotion(player, controls, dt, overArenaFloor) {
    const onWater = isOnWater(player, water);
    const inWater = onWater && player.y < waterSurface;
    const jumpPressed = controls.jumpDown && !jumpWasDown;
    jumpWasDown = controls.jumpDown;

    if (jumpPressed && !onWater && player.y === 0) {
      player.vy = JUMP_VELOCITY;
    } else if (jumpPressed && onWater && player.y <= waterSurface) {
      player.vy = WATER_JUMP_VELOCITY;
    }

    if (wasOnWater && !onWater && player.y < 0) {
      leftWaterUnderwater = true;
    }
    if (onWater || player.y >= 0) leftWaterUnderwater = false;
    wasOnWater = onWater;

    if (onWater) {
      if (controls.upward && player.y < waterSurface) {
        player.y = Math.min(waterSurface, player.y + UP_SPEED * 2 * dt);
      }
      if (controls.downward) player.y -= DOWN_SPEED * dt;
    }

    if (inWater) {
      player.vy -= GRAVITY * 0.45 * dt;
      player.vy = Math.max(player.vy, -2);
    } else {
      player.vy -= GRAVITY * dt;
    }

    player.y += player.vy * dt;
    if (!onWater && !leftWaterUnderwater && overArenaFloor && player.y <= 0) {
      player.y = 0;
      player.vy = 0;
    }
    
	const underwater = onWater && player.y < -1;

	underwaterOverlay.style.opacity = underwater ? '1' : '0';
	
  }

  return {
    stepPhysics: stepVerticalMotion,
  };
}

import * as THREE from "three";

export const WATER_WIDTH = 14;
const WATER_DEPTH = 80;
const WATER_HEIGHT = 18;
const WATER_X = 0;
const WATER_Y = -9;
const WATER_Z = 0;

export function createWater(scene) {
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

  return {
    water,
    waterSurface: water.position.y + WATER_HEIGHT / 2,
  };
}

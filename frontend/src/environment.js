import * as THREE from "three";

// Sky, fog and lights. The ground, water and mountains all come from World.glb (world.js).
export function createEnvironment(scene) {
  scene.background = new THREE.Color(0x9bd8ed);
  scene.fog = new THREE.Fog(0x9bd8ed, 60, 160);

  scene.add(new THREE.HemisphereLight(0xfff4d6, 0x315447, 1.5));
  const sun = new THREE.DirectionalLight(0xffe2a6, 2);
  sun.position.set(-25, 35, 12);
  scene.add(sun);
}

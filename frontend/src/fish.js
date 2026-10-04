import * as THREE from "three";

const COLORS = [0xf2b84b, 0xf08a6b, 0x8cc9d8, 0xd98fca];
const FISH_MIN_X = -5.5;
const FISH_MAX_X = 5.5;
const FISH_MIN_Z = -38;
const FISH_MAX_Z = 38;

export function createFish(scene, count = 12) {
  const group = new THREE.Group();
  group.name = "fish";
  scene.add(group);
  const fish = [];

  for (let index = 0; index < count; index += 1) {
    const root = new THREE.Group();
    const scale = 0.22 + Math.random() * 0.12;
    const material = new THREE.MeshStandardMaterial({
      color: COLORS[index % COLORS.length],
      roughness: 0.7,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 5), material);
    body.scale.set(1.5 * scale, 0.65 * scale, 0.65 * scale);
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.65 * scale, 0.9 * scale, 4),
      material,
    );
    tail.rotation.z = -Math.PI / 2;
    tail.position.x = -1.1 * scale;
    root.add(body, tail);
    root.position.set(
      (Math.random() * 2 - 1) * 5.5,
      -7 + Math.random() * 5,
      -38 + Math.random() * 76,
    );
    root.rotation.y = Math.random() * Math.PI * 2;
    group.add(root);
    fish.push({
      root,
      phase: Math.random() * Math.PI * 2,
      speed: 0.25 + Math.random() * 0.5,
      turn: Math.random() < 0.5 ? -1 : 1,
    });
  }

  let elapsed = 0;
  return {
    update(dt, player) {
      elapsed += dt;
      for (const swimmer of fish) {
        const dx = swimmer.root.position.x - (player?.x ?? 0);
        const dz = swimmer.root.position.z - (player?.z ?? 0);
        const distance = Math.hypot(dx, dz);
        const fleeing = distance < 4;
        if (fleeing) swimmer.turn = dx >= 0 ? 1 : -1;
        const speed = swimmer.speed * (fleeing ? 3 : 1);
        swimmer.root.position.x = Math.max(
          FISH_MIN_X,
          Math.min(FISH_MAX_X, swimmer.root.position.x + swimmer.turn * speed * dt),
        );
        swimmer.root.position.z = Math.max(FISH_MIN_Z, Math.min(FISH_MAX_Z, swimmer.root.position.z));
        swimmer.root.position.y += Math.sin(elapsed * 1.8 + swimmer.phase) * dt * 0.08;
        swimmer.root.rotation.y = swimmer.turn < 0 ? Math.PI : 0;
        if (swimmer.root.position.x >= FISH_MAX_X || swimmer.root.position.x <= FISH_MIN_X) {
          swimmer.turn *= -1;
        }
      }
    },
  };
}

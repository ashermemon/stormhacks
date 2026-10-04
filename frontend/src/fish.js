import * as THREE from "three";
import { WATER_SURFACE_Y } from "./world.js";
import { FISH_MODELS, trinketModel } from "./trinkets/models.js";

const FISH_SCALE = 5; // the Trinkets.glb fish are real-world sized

const COLORS = [0xf2b84b, 0xf08a6b, 0x8cc9d8, 0xd98fca];
const MIN_DEPTH = 0.7; // fish turn back before water gets shallower than this
const FLEE_DISTANCE = 4;

// Fish start at random points on the underwater spawn zones and wander wherever the
// water is deep enough, bobbing between the bed and the surface.
// Where a fish's mouth is: the front tip of its model (it swims along +x), a little
// below the middle.
function mouthOf(root, scale) {
  const at = root.position.clone();
  root.position.set(0, 0, 0); // measure in the fish's own space
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.position.copy(at);
  if (box.isEmpty()) return { mouth: 1.6 * scale, mouthY: 0 };
  return { mouth: box.max.x * 0.95, mouthY: (box.min.y + box.max.y) / 2 - (box.max.y - box.min.y) * 0.1 };
}

export function createFish(scene, count, { getGroundHeight, zones, bubbles = null }) {
  const group = new THREE.Group();
  group.name = "fish";
  scene.add(group);
  const fish = [];
  const spot = new THREE.Vector3();
  const deepEnough = (x, z) => WATER_SURFACE_Y - getGroundHeight(x, z) > MIN_DEPTH;

  for (let index = 0; index < count && zones.length; index += 1) {
    const zone = zones[index % zones.length];
    zone.sampler.setRandomGenerator(Math.random);
    zone.sampler.sample(spot);
    zone.mesh.localToWorld(spot);

    const root = new THREE.Group();
    const scale = 0.22 + Math.random() * 0.12;
    const material = new THREE.MeshStandardMaterial({
      color: COLORS[index % COLORS.length],
      roughness: 0.7,
    });
    // Built facing +x. The Trinkets.glb fish face +z, so turn them a quarter.
    const model = trinketModel(
      FISH_MODELS[index % FISH_MODELS.length],
      COLORS[index % COLORS.length],
      FISH_SCALE * (scale / 0.28),
    );
    if (model) {
      model.rotation.y = Math.PI / 2;
      root.add(model);
    } else {
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 5), material);
      body.scale.set(1.5 * scale, 0.65 * scale, 0.65 * scale);
      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(0.65 * scale, 0.9 * scale, 4),
        material,
      );
      tail.rotation.z = -Math.PI / 2;
      tail.position.x = -1.1 * scale;
      root.add(body, tail);
    }
    root.position.set(spot.x, 0, spot.z);
    group.add(root);
    fish.push({
      root,
      heading: Math.random() * Math.PI * 2,
      depthMix: 0.3 + Math.random() * 0.4, // 0 = bed, 1 = surface
      phase: Math.random() * Math.PI * 2,
      speed: 0.25 + Math.random() * 0.5,
      ...mouthOf(root, scale),
      breath: Math.random() * 3, // seconds until it next breathes out bubbles
    });
  }

  let elapsed = 0;
  const mouth = new THREE.Vector3();
  return {
    update(dt, player) {
      elapsed += dt;
      for (const swimmer of fish) {
        const { position } = swimmer.root;
        const dx = position.x - (player?.x ?? 0);
        const dz = position.z - (player?.z ?? 0);
        const fleeing = Math.hypot(dx, dz) < FLEE_DISTANCE;
        if (fleeing) swimmer.heading = Math.atan2(-dz, dx);
        else swimmer.heading += Math.sin(elapsed * 0.7 + swimmer.phase) * 0.4 * dt;

        const step = swimmer.speed * (fleeing ? 3 : 1) * dt;
        const nextX = position.x + Math.cos(swimmer.heading) * step;
        const nextZ = position.z - Math.sin(swimmer.heading) * step;
        if (deepEnough(nextX, nextZ)) {
          position.x = nextX;
          position.z = nextZ;
        } else {
          swimmer.heading += Math.PI * (0.75 + Math.random() * 0.5);
        }

        const bed = getGroundHeight(position.x, position.z) + 0.25;
        const top = WATER_SURFACE_Y - 0.25;
        const bob = Math.sin(elapsed * 1.8 + swimmer.phase) * 0.1;
        position.y = THREE.MathUtils.lerp(bed, top, swimmer.depthMix) + bob;
        swimmer.root.rotation.y = swimmer.heading;

        // Every couple of seconds, a few little bubbles from its mouth.
        swimmer.breath -= dt;
        if (bubbles && swimmer.breath <= 0) {
          swimmer.breath = 1.5 + Math.random() * 2.5;
          mouth.set(
            position.x + Math.cos(swimmer.heading) * swimmer.mouth,
            position.y + swimmer.mouthY,
            position.z - Math.sin(swimmer.heading) * swimmer.mouth,
          );
          bubbles.emit(mouth, 1 + Math.floor(Math.random() * 3));
        }
      }
    },
  };
}

// Where trinkets lie. This is the ONLY place that knows about the map.
//
// Map contract (World.glb): any mesh with `userData.spawnZone` (e.g. "pond", "stream")
// sitting exactly on the underwater floor, normals pointing up into the water.
// game.js calls collectSpawnZones(world.root) once World.glb has loaded.
//
// Positions come from the trinket's server seed, so every client puts the same
// trinket in the same spot without the server knowing anything about the map.

import * as THREE from "three";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";

/** Find every tagged spawn mesh under root, hide it and prepare a sampler for it. */
export function collectSpawnZones(root) {
  const zones = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.userData.spawnZone) return;
    o.visible = false;
    const sampler = new MeshSurfaceSampler(o).build();
    zones.push({
      mesh: o,
      name: o.userData.spawnZone,
      sampler,
      area: sampler.distribution[sampler.distribution.length - 1], // total surface area
    });
  });
  // Stable order, so the seed picks the same zone on every client.
  zones.sort((a, b) => (a.mesh.name < b.mesh.name ? -1 : a.mesh.name > b.mesh.name ? 1 : 0));
  return zones;
}

/** Tiny seeded random generator (mulberry32). Same seed -> same numbers everywhere. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * World position + up normal for a trinket seed. Bigger zones get more trinkets,
 * because the zone is picked by area and the point is picked evenly over the surface.
 */
export function spawnPointFromSeed(zones, seed) {
  const random = seededRandom(seed);
  const totalArea = zones.reduce((sum, z) => sum + z.area, 0);
  let pick = random() * totalArea;
  const zone = zones.find((z) => (pick -= z.area) <= 0) ?? zones[zones.length - 1];

  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();
  zone.sampler.setRandomGenerator(random);
  zone.sampler.sample(position, normal);
  zone.mesh.localToWorld(position);
  normal.transformDirection(zone.mesh.matrixWorld);
  return { position, normal, yaw: random() * Math.PI * 2 };
}

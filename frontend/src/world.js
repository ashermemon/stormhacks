import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import worldUrl from "../assets/models/world/World.glb?url";
import { softenTerrainTexture } from "./terrainTexture.js";

// World.glb: Y-up, centred on the origin, water surface at y = 0. The terrain is a
// regular square vertex grid; its size and extent are read from the mesh itself.
export const WATER_SURFACE_Y = 0;
const MAX_STEP_UP = 0.35; // per frame's step; steeper than this is a wall
const MAX_WALK_HEIGHT = 4; // the mountain ring above this is the world edge
const COLLIDER_RADIUS = 0.6; // how close the otter's origin gets to cave walls

const caveMaterial = new THREE.MeshStandardMaterial({
  color: 0x6b6862,
  roughness: 1,
  flatShading: true,
});

export async function loadWorld() {
  const gltf = await new GLTFLoader().loadAsync(worldUrl);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  let terrain = null;
  const colliders = [];
  root.traverse((o) => {
    if (o.userData.spawnZone) o.visible = false;
    if (!o.isMesh) return;
    if (o.userData.surface === "ground") {
      terrain = o;
      // Ink the ridges and skyline so the ground matches the toon style.
      o.userData.noOutline = false;
      o.userData.outline = "contour";
    }
    if (o.userData.cave) o.material = caveMaterial; // exported without a material
    if (o.userData.collider) colliders.push(o);
  });
  if (!terrain) throw new Error("World.glb has no Terrain mesh");
  if (terrain.material.map) softenTerrainTexture(terrain.material.map);

  const { getGroundHeight, mapHalf } = buildHeightLookup(terrain);
  const resolveColliders = buildColliders(colliders);
  const obstacles = buildObstacleGrid();

  // Moves the player by (dx, dz) unless the ground there is too steep or too high,
  // or a trunk/boulder is in the way, sliding along the blocked axis when only one
  // direction is the problem.
  function resolveHorizontalMovement(player, dx, dz) {
    const from = getGroundHeight(player.x, player.z);
    const walkable = (x, z) => {
      if (Math.abs(x) > mapHalf || Math.abs(z) > mapHalf) return false;
      if (obstacles.blocks(player.x, player.z, x, z)) return false;
      const ground = getGroundHeight(x, z);
      return ground <= MAX_WALK_HEIGHT && ground - from <= MAX_STEP_UP;
    };
    if (walkable(player.x + dx, player.z + dz)) {
      player.x += dx;
      player.z += dz;
    } else if (walkable(player.x + dx, player.z)) {
      player.x += dx;
    } else if (walkable(player.x, player.z + dz)) {
      player.z += dz;
    }
  }

  return {
    root,
    terrain,
    mapHalf,
    getGroundHeight,
    resolveHorizontalMovement,
    resolveColliders,
    addObstacle: obstacles.add,
  };
}

// Round obstacles on the ground (tree trunks, boulders), bucketed into a coarse grid so
// a move only checks its neighbours. blocks(fromX, fromZ, toX, toZ) is true when the move
// ends inside one and gets closer to its centre, so nothing can trap the otter.
function buildObstacleGrid() {
  const CELL = 8;
  const cells = new Map();
  const key = (i, j) => `${i},${j}`;

  function add(x, z, radius) {
    const i = Math.floor(x / CELL);
    const j = Math.floor(z / CELL);
    if (!cells.has(key(i, j))) cells.set(key(i, j), []);
    cells.get(key(i, j)).push({ x, z, r: radius + COLLIDER_RADIUS * 0.5 });
  }

  function blocks(fromX, fromZ, toX, toZ) {
    const i = Math.floor(toX / CELL);
    const j = Math.floor(toZ / CELL);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const o of cells.get(key(i + di, j + dj)) ?? []) {
          const to = Math.hypot(toX - o.x, toZ - o.z);
          if (to < o.r && to < Math.hypot(fromX - o.x, fromZ - o.z)) return true;
        }
      }
    }
    return false;
  }

  return { add, blocks };
}

// Raycasting the whole terrain every frame is too slow, so sample the grid once and
// interpolate: each vertex is bucketed into its grid cell, then lookups are bilinear.
function buildHeightLookup(terrain) {
  const pos = terrain.geometry.attributes.position;
  const size = Math.round(Math.sqrt(pos.count));
  const grid = size - 1;
  const box = new THREE.Box3().setFromObject(terrain);
  const mapHalf = box.max.x;
  const span = mapHalf * 2;
  const heights = new Float32Array(size * size);
  const v = new THREE.Vector3();
  for (let n = 0; n < pos.count; n++) {
    v.fromBufferAttribute(pos, n).applyMatrix4(terrain.matrixWorld);
    const i = Math.round(((v.x + mapHalf) / span) * grid);
    const j = Math.round(((v.z + mapHalf) / span) * grid);
    if (i >= 0 && i < size && j >= 0 && j < size) heights[j * size + i] = v.y;
  }

  const clamp = (value) => Math.max(-mapHalf, Math.min(mapHalf, value));
  function getGroundHeight(x, z) {
    const gx = ((clamp(x) + mapHalf) / span) * grid;
    const gz = ((clamp(z) + mapHalf) / span) * grid;
    const i0 = Math.min(Math.floor(gx), grid - 1);
    const j0 = Math.min(Math.floor(gz), grid - 1);
    const tx = gx - i0;
    const tz = gz - j0;
    const h = (i, j) => heights[j * size + i];
    const top = h(i0, j0) * (1 - tx) + h(i0 + 1, j0) * tx;
    const bottom = h(i0, j0 + 1) * (1 - tx) + h(i0 + 1, j0 + 1) * tx;
    return top * (1 - tz) + bottom * tz;
  }
  return { getGroundHeight, mapHalf };
}

// Solid meshes the heightmap can't describe (the underwater caves). Returns
// resolveColliders(from, to): pulls `to` back so the move from `from` doesn't pass
// through a wall, sliding along it when it can. Only does work near a collider.
function buildColliders(meshes) {
  if (!meshes.length) return () => {};
  // Double-sided stand-ins so walls block from inside the cave as well as outside.
  const side = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const targets = meshes.map((mesh) => {
    const target = new THREE.Mesh(mesh.geometry, side);
    target.matrixWorld.copy(mesh.matrixWorld);
    target.matrixAutoUpdate = false;
    return target;
  });
  const bounds = new THREE.Box3();
  for (const mesh of meshes) bounds.expandByObject(mesh);
  bounds.expandByScalar(COLLIDER_RADIUS + 1);

  const raycaster = new THREE.Raycaster();
  const start = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const normal = new THREE.Vector3();

  const firstHit = (dir, length) => {
    raycaster.set(start, dir);
    raycaster.far = length + COLLIDER_RADIUS;
    return raycaster.intersectObjects(targets, false)[0];
  };

  return function resolveColliders(from, to) {
    start.set(from.x, from.y, from.z);
    if (!bounds.containsPoint(start)) return;
    delta.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const length = delta.length();
    if (length < 1e-6) return;

    const hit = firstHit(delta.clone().divideScalar(length), length);
    if (!hit) return;
    normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (normal.dot(delta) > 0) normal.negate();

    // Slide: drop the part of the move that goes into the wall.
    delta.addScaledVector(normal, -delta.dot(normal));
    const slideLength = delta.length();
    if (slideLength < 1e-6 || firstHit(delta.clone().divideScalar(slideLength), slideLength)) {
      delta.set(0, 0, 0);
    }
    to.x = from.x + delta.x;
    to.y = from.y + delta.y;
    to.z = from.z + delta.z;
  };
}

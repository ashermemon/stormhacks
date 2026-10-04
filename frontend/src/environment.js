import * as THREE from "three";
import { WATER_BOTTOM, WATER_WIDTH } from "./water.js";

const GROUND_TOP = -0.08;
const GROUND_BOTTOM = WATER_BOTTOM - 2;

function addTree(scene, x, z, scale = 1) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * scale, 0.32 * scale, 2.2 * scale, 7),
    new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 1 }),
  );
  trunk.position.y = 1.1 * scale;
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(1.35 * scale, 3 * scale, 8),
    new THREE.MeshStandardMaterial({
      color: 0x237a45,
      roughness: 0.95,
      flatShading: true,
    }),
  );
  crown.position.y = 3.2 * scale;
  tree.add(trunk, crown);
  tree.position.set(x, 0, z);
  scene.add(tree);
  return tree;
}

function addRock(scene, x, z, scale = 1) {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(scale, 0),
    new THREE.MeshStandardMaterial({
      color: 0x687477,
      roughness: 1,
      flatShading: true,
    }),
  );
  rock.scale.y = 0.6;
  rock.position.set(x, scale * 0.45, z);
  scene.add(rock);
  return rock;
}

function addMountain(scene, x, z, width, height, color) {
  const mountain = new THREE.Mesh(
    new THREE.ConeGeometry(width, height, 6),
    new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }),
  );
  mountain.position.set(x, height / 2 - 0.5, z);
  scene.add(mountain);
}

// Solid blocks of earth on either side of the water channel, plus a bed under it.
function addGround(scene, arenaHalf) {
  const grass = new THREE.MeshStandardMaterial({ color: 0x4e9a62, roughness: 1 });
  const dirt = new THREE.MeshStandardMaterial({ color: 0x6b4f36, roughness: 1 });
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
  const grassTop = [dirt, dirt, grass, dirt, dirt, dirt];

  const addBlock = (minX, maxX, topY, materials) => {
    const height = topY - GROUND_BOTTOM;
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(maxX - minX, height, arenaHalf * 2),
      materials,
    );
    block.position.set((minX + maxX) / 2, topY - height / 2, 0);
    block.userData.noOutline = true;
    scene.add(block);
  };

  const channelHalf = WATER_WIDTH / 2;
  addBlock(-arenaHalf, -channelHalf, GROUND_TOP, grassTop);
  addBlock(channelHalf, arenaHalf, GROUND_TOP, grassTop);
  addBlock(-channelHalf, channelHalf, WATER_BOTTOM, dirt);
}

export function createEnvironment(scene, arenaHalf) {
  const collisionObjects = [];
  scene.background = new THREE.Color(0x9bd8ed);
  scene.fog = new THREE.Fog(0x9bd8ed, 45, 115);

  scene.add(new THREE.HemisphereLight(0xfff4d6, 0x315447, 1.5));
  const sun = new THREE.DirectionalLight(0xffe2a6, 2);
  sun.position.set(-25, 35, 12);
  scene.add(sun);

  addGround(scene, arenaHalf);

  for (const [x, z, scale] of [
    [-17, -15, 1.2],
    [-12, 16, 0.9],
    [15, -14, 1.1],
    [16, 14, 1.3],
    [-18, 8, 0.8],
    [18, -4, 0.9],
    [-7, -18, 0.75],
    [8, 18, 0.8],
  ]) {
    collisionObjects.push(addTree(scene, x, z, scale));
  }

  for (const [x, z, scale] of [
    [-13, -5, 1.1],
    [12, -10, 0.8],
    [-16, 13, 0.7],
    [14, 17, 0.9],
  ]) {
    collisionObjects.push(addRock(scene, x, z, scale));
  }

  addMountain(scene, -46, -38, 18, 26, 0x476b68);
  addMountain(scene, -18, -48, 22, 32, 0x587875);
  addMountain(scene, 18, -50, 20, 28, 0x3f6465);
  addMountain(scene, 48, -35, 16, 23, 0x52716d);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x8888aa });
  for (const [x, z, width, depth] of [
    [0, -arenaHalf, arenaHalf * 2, 0.4],
    [0, arenaHalf, arenaHalf * 2, 0.4],
    [-arenaHalf, 0, 0.4, arenaHalf * 2],
    [arenaHalf, 0, 0.4, arenaHalf * 2],
  ]) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(width, 1, depth),
      wallMaterial,
    );
    wall.position.set(x, 0.5, z);
    scene.add(wall);
    collisionObjects.push(wall);
  }

  const collisionBoxes = collisionObjects.map((object) =>
    shrinkCollisionBox(new THREE.Box3().setFromObject(object), 0.7),
  );

  function resolveHorizontalMovement(player, deltaX, deltaZ, radius) {
    let nextX = player.x + deltaX;
    let nextZ = player.z;

    if (collisionBoxes.some((box) => overlaps(box, nextX, nextZ, radius))) {
      nextX = player.x;
    }

    nextZ = player.z + deltaZ;
    if (collisionBoxes.some((box) => overlaps(box, nextX, nextZ, radius))) {
      nextZ = player.z;
    }

    player.x = nextX;
    player.z = nextZ;
  }

  return { resolveHorizontalMovement };
}

function overlaps(box, x, z, radius) {
  return (
    x + radius > box.min.x &&
    x - radius < box.max.x &&
    z + radius > box.min.z &&
    z - radius < box.max.z
  );
}

function shrinkCollisionBox(box, factor) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(factor);
  return new THREE.Box3().setFromCenterAndSize(center, size);
}

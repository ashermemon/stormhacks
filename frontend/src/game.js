import * as THREE from "three";
import { connect } from "./net.js";
import { keys } from "./input.js";
import { isOnWater } from "./functions.js";

const ARENA_HALF = 20;
const AVATAR = { w: 1, h: 2, d: 0.6 };
const SPEED = 7;
const GRAVITY = 25;
const JUMP_VELOCITY = 9;
const SEND_INTERVAL = 1 / 30;
const CAMERA_DISTANCE = 8;
const CAMERA_HEIGHT = 4;
const ORBIT_SPEED = 2;
const UP_SPEED = 2;
const DOWN_SPEED = 2;
const REMOTE_SMOOTHING = 15;

function colorFor(id) {
  return new THREE.Color().setHSL((parseInt(id, 16) % 360) / 360, 0.7, 0.55);
}

function createAvatar(color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(AVATAR.w, AVATAR.h, AVATAR.d),
    new THREE.MeshStandardMaterial({ color }),
  );
  body.position.y = AVATAR.h / 2;
  // Lighter strip on the front (+z) so facing direction is visible.
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(AVATAR.w * 0.6, AVATAR.h * 0.2, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  face.position.set(0, AVATAR.h * 0.8, AVATAR.d / 2 + 0.025);
  group.add(body, face);
  return group;
}

function lerpAngle(a, b, t) {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

function addTree(scene, x, z, scale = 1) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * scale, 0.32 * scale, 2.2 * scale, 7),
    new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 1 }),
  );
  trunk.position.y = 1.1 * scale;
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(1.35 * scale, 3 * scale, 8),
    new THREE.MeshStandardMaterial({ color: 0x237a45, roughness: 0.95, flatShading: true }),
  );
  crown.position.y = 3.2 * scale;
  tree.add(trunk, crown);
  tree.position.set(x, 0, z);
  scene.add(tree);
}

function addRock(scene, x, z, scale = 1) {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(scale, 0),
    new THREE.MeshStandardMaterial({ color: 0x687477, roughness: 1, flatShading: true }),
  );
  rock.scale.y = 0.6;
  rock.position.set(x, scale * 0.45, z);
  scene.add(rock);
}

function addMountain(scene, x, z, width, height, color) {
  const mountain = new THREE.Mesh(
    new THREE.ConeGeometry(width, height, 6),
    new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }),
  );
  mountain.position.set(x, height / 2 - 0.5, z);
  scene.add(mountain);
}

export async function startGame() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9bd8ed);
  scene.fog = new THREE.Fog(0x9bd8ed, 45, 115);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  scene.add(new THREE.HemisphereLight(0xfff4d6, 0x315447, 1.5));
  const sun = new THREE.DirectionalLight(0xffe2a6, 2);
  sun.position.set(-25, 35, 12);
  scene.add(sun);

  // Bounded flat world.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x4e9a62, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  scene.add(
    new THREE.GridHelper(ARENA_HALF * 2, ARENA_HALF * 2, 0x376c4b, 0x5aa36a),
  );

  const meadow = new THREE.Mesh(
    new THREE.CircleGeometry(72, 48),
    new THREE.MeshStandardMaterial({ color: 0x397b50, roughness: 1 }),
  );
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = -0.08;
  scene.add(meadow);

  for (const [x, z, scale] of [
    [-17, -15, 1.2], [-12, 16, 0.9], [15, -14, 1.1], [16, 14, 1.3],
    [-18, 8, 0.8], [18, -4, 0.9], [-7, -18, 0.75], [8, 18, 0.8],
  ]) addTree(scene, x, z, scale);
  for (const [x, z, scale] of [[-13, -5, 1.1], [12, -10, 0.8], [-16, 13, 0.7], [14, 17, 0.9]]) {
    addRock(scene, x, z, scale);
  }
  addMountain(scene, -46, -38, 18, 26, 0x476b68);
  addMountain(scene, -18, -48, 22, 32, 0x587875);
  addMountain(scene, 18, -50, 20, 28, 0x3f6465);
  addMountain(scene, 48, -35, 16, 23, 0x52716d);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x8888aa });
  for (const [x, z, w, d] of [
    [0, -ARENA_HALF, ARENA_HALF * 2, 0.4],
    [0, ARENA_HALF, ARENA_HALF * 2, 0.4],
    [-ARENA_HALF, 0, 0.4, ARENA_HALF * 2],
    [ARENA_HALF, 0, 0.4, ARENA_HALF * 2],
  ]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), wallMaterial);
    wall.position.set(x, 0.5, z);
    scene.add(wall);
  }

  const water = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA_HALF * 2, 2, ARENA_HALF),
    new THREE.MeshStandardMaterial({
      color: 0x2d9cdb,
      transparent: true,
      opacity: 0.4,
      roughness: 0.2,
      metalness: 0.1,
      depthWrite: false,
    }),
  );

  // A shallow pool sits at the far side of the meadow.
  water.position.set(0, -1, 10);

  scene.add(water);

  const waterFloor = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA_HALF * 2, 0.2, ARENA_HALF),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
    }),
  );

  waterFloor.position.set(0, -2.1, 10);

  scene.add(waterFloor);

  // Remote players.
  const remotes = new Map(); // id -> { mesh, target: {x,y,z,ry} }

  function setRemote(id, state) {
    let remote = remotes.get(id);
    if (!remote) {
      const mesh = createAvatar(colorFor(id));
      mesh.position.set(state.x, state.y, state.z);
      mesh.rotation.y = state.ry;
      scene.add(mesh);
      remote = { mesh, target: state };
      remotes.set(id, remote);
    }
    remote.target = state;
  }

  const net = await connect({
    onState: setRemote,
    onLeave(id) {
      const remote = remotes.get(id);
      if (remote) {
        scene.remove(remote.mesh);
        remotes.delete(id);
      }
    },
    onClose() {
      alert("Disconnected from server. Reload to rejoin.");
    },
  });

  for (const [id, state] of Object.entries(net.players)) setRemote(id, state);

  // Local player.
  const me = createAvatar(colorFor(net.id));
  const spawn = () => (Math.random() * 2 - 1) * (ARENA_HALF - 2);
  const player = { x: spawn(), y: 0, z: spawn(), vy: 0, ry: 0 };
  scene.add(me);

  let cameraYaw = 0;
  let dragging = false;
  renderer.domElement.addEventListener("pointerdown", () => (dragging = true));
  window.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("pointermove", (e) => {
    if (dragging) cameraYaw -= e.movementX * 0.005;
  });

  let sendTimer = 0;
  const clock = new THREE.Clock();
  const limit = ARENA_HALF - AVATAR.w / 2;
  const isOverArenaFloor = () =>
    Math.abs(player.x) <= ARENA_HALF && Math.abs(player.z) <= ARENA_HALF;
  let wasOnWater = false;
  let leftWaterUnderwater = false;
  let previousPlayerPosition = {
    x: player.x,
    y: player.y,
    z: player.z,
    ry: player.ry,
  };
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);

    cameraYaw += keys.orbit() * ORBIT_SPEED * dt;

    // Movement relative to camera heading.
    const { forward, right } = keys.axes();
    const fx = -Math.sin(cameraYaw);
    const fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw);
    const rz = -Math.sin(cameraYaw);
    let dx = fx * forward + rx * right;
    let dz = fz * forward + rz * right;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
      player.x += dx * SPEED * dt;
      player.z += dz * SPEED * dt;
      player.ry = lerpAngle(
        player.ry,
        Math.atan2(dx, dz),
        1 - Math.exp(-15 * dt),
      );
    }
    player.x = Math.max(-limit, Math.min(limit, player.x));
    player.z = Math.max(-limit, Math.min(limit, player.z));

    // Jump and gravity.
    if (keys.jump() && player.y === 0) player.vy = JUMP_VELOCITY;
    const onWater = isOnWater(player, water);
    if (wasOnWater && !onWater && player.y < 0) leftWaterUnderwater = true;
    if (onWater || player.y >= 0) leftWaterUnderwater = false;
    wasOnWater = onWater;

    if (onWater) {
      if (keys.upward()) {
        player.y += UP_SPEED * 2 * dt;
      }

      if (keys.downward()) {
        player.y -= DOWN_SPEED * dt;
      }
    }

    if (onWater) {
      player.vy -= GRAVITY * 0.45 * dt;
      player.vy = Math.max(player.vy, -2);
    } else {
      player.vy -= GRAVITY * dt;
    }

    player.y += player.vy * dt;
    if (!onWater && !leftWaterUnderwater && isOverArenaFloor() && player.y <= 0) {
      player.y = 0;
      player.vy = 0;
    }

    me.position.set(player.x, player.y, player.z);
    me.rotation.y = player.ry;

    // Third-person camera behind the player, looking at their head.
    camera.position.set(
      player.x + Math.sin(cameraYaw) * CAMERA_DISTANCE,
      player.y + CAMERA_HEIGHT,
      player.z + Math.cos(cameraYaw) * CAMERA_DISTANCE,
    );
    camera.lookAt(player.x, player.y + AVATAR.h, player.z);

    // Network.
    sendTimer += dt;
    if (
      previousPlayerPosition.x !== player.x ||
      previousPlayerPosition.y !== player.y ||
      previousPlayerPosition.z !== player.z ||
      previousPlayerPosition.ry !== player.ry
    ) {
      previousPlayerPosition.x = player.x;
      previousPlayerPosition.y = player.y;
      previousPlayerPosition.z = player.z;
      previousPlayerPosition.ry = player.ry;
    }
    if (sendTimer >= SEND_INTERVAL) {
      sendTimer = 0;
      net.sendState({ x: player.x, y: player.y, z: player.z, ry: player.ry });
    }

    // Smooth remote players toward their latest state.
    const t = 1 - Math.exp(-REMOTE_SMOOTHING * dt);
    for (const { mesh, target } of remotes.values()) {
      mesh.position.x += (target.x - mesh.position.x) * t;
      mesh.position.y += (target.y - mesh.position.y) * t;
      mesh.position.z += (target.z - mesh.position.z) * t;
      mesh.rotation.y = lerpAngle(mesh.rotation.y, target.ry, t);
    }

    renderer.render(scene, camera);
  });
}

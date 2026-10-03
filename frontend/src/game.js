import * as THREE from "three";
import { connect } from "./net.js";
import { keys } from "./input.js";
import { createAquaticArea } from "./water.js";
import { createEnvironment } from "./environment.js";

const ARENA_HALF = 20;
const AVATAR = { w: 1, h: 2, d: 0.6 };
const SPEED = 7;
const SEND_INTERVAL = 1 / 30;
const CAMERA_DISTANCE = 8;
const CAMERA_HEIGHT = 4;
const ORBIT_SPEED = 2;
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

export async function startGame() {
  const scene = new THREE.Scene();
  createEnvironment(scene, ARENA_HALF);

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

  const stepVerticalPhysics = createAquaticArea(scene).stepPhysics;


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

    stepVerticalPhysics(
      player,
      {
        jumpDown: keys.jump(),
        upward: keys.upward(),
        downward: keys.downward(),
      },
      dt,
      isOverArenaFloor(),
    );

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

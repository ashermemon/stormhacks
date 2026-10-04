import * as THREE from "three";
import { connect } from "./net.js";
import { keys } from "./input.js";
import { createAquaticArea, WATER_BOTTOM, WATER_WIDTH } from "./water.js";
import { createEnvironment, collideWithGround } from "./environment.js";
import { Character, OTTER_COLORS } from "./character.js";
import { createChat } from "./chat.js";
import { trackNames } from "./names.js";
import { setToonLight, toonifyScene } from "./toonshading.js";
import { createTrinkets } from "./trinkets/trinkets.js";
import { collectSpawnZones, createStandInZone } from "./trinkets/spawnZones.js";

const ARENA_HALF = 20;
const AVATAR = { w: 1, h: 1, d: 1 };
const SPEED = 4;
const SURFACE_SWIM_SPEED = 2.5;
const FLOAT_SWIM_SPEED = 0.8; // drifting on his back during the SwimSurface float
const UNDERWATER_SWIM_SPEED = 3;
const SEND_INTERVAL = 1 / 30;
const CAMERA_DISTANCE = 8;
const CAMERA_HEIGHT = 4;
const ORBIT_SPEED = 2;
const REMOTE_SMOOTHING = 15;
const MOUSE_SENSITIVITY = 0.0025; // radians per pixel
const FALL_LIMIT_Y = WATER_BOTTOM - 5; // below this you respawn

// Hash the id so each player gets a random-looking color that matches on every client.
function colorFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return OTTER_COLORS[Math.abs(h) % OTTER_COLORS.length];
}

function lerpAngle(a, b, t) {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

export async function startGame() {
  const scene = new THREE.Scene();
  const environment = createEnvironment(scene, ARENA_HALF);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    stencil: true, // silhouette-only otter outlines (toonshading.js)
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const aquatic = createAquaticArea(scene);

  // Cel-shade everything built so far; otters are styled in Character.
  setToonLight(-25, 35, 12); // match the sun in environment.js
  toonifyScene(scene);

  // Remote players.
  const remotes = new Map(); // id -> { character, target: {x,y,z,ry} }

  function setRemote(id, state) {
    let remote = remotes.get(id);
    if (!remote) {
      const character = new Character(scene, colorFor(id), names.get(id));
      character.root.position.set(state.x, state.y, state.z);
      character.root.rotation.y = state.ry;
      remote = { character, target: state };
      remotes.set(id, remote);
    }
    remote.target = state;
  }

  const net = await connect({
    onState: setRemote,
    onLeave(id) {
      const remote = remotes.get(id);
      if (remote) {
        remote.character.dispose();
        remotes.delete(id);
      }
    },
    onClose() {
      alert("Disconnected from server. Reload to rejoin.");
    },
  });

  // Player id -> Character (local player or remote), and the names that go on their tags.
  const characterOf = (id) => (id === net.id ? me : remotes.get(id)?.character);
  const names = trackNames(net, (id, name) => characterOf(id)?.setName(name));

  for (const [id, state] of Object.entries(net.players)) setRemote(id, state);

  // Local player.
  const me = new Character(scene, colorFor(net.id), net.name);
  const spawn = () => (Math.random() * 2 - 1) * (ARENA_HALF - 2);
  const player = { x: spawn(), y: 0, z: spawn(), vy: 0, ry: 0 };
  const respawn = () => {
    player.x = spawn();
    player.z = spawn();
    player.y = 0;
    player.vy = 0;
  };

  const chat = createChat({ net, camera, getCharacter: characterOf });

  // Trinkets lie on the spawn-zone meshes. When World.glb lands, swap the stand-in for
  // collectSpawnZones(worldGltf.scene); nothing else changes.
  createStandInZone(scene, {
    floorY: WATER_BOTTOM - 0.1,
    width: WATER_WIDTH - 1,
    length: (ARENA_HALF - 1) * 2,
  });
  const trinkets = createTrinkets({
    scene,
    net,
    zones: collectSpawnZones(scene),
    getCharacter: characterOf,
    swimState: aquatic.swimState,
  });

  let cameraYaw = 0;
  // Mouse look: click the game to lock the cursor, then just move the mouse. Esc releases it.
  const canvas = renderer.domElement;
  const lockPointer = () => canvas.requestPointerLock()?.catch?.(() => {});
  canvas.addEventListener("click", lockPointer);
  lockPointer(); // may work straight away thanks to the Play button click
  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas)
      cameraYaw -= e.movementX * MOUSE_SENSITIVITY;
  });

  let sendTimer = 0;
  const clock = new THREE.Clock();
  const limit = ARENA_HALF - AVATAR.w / 2;
  const isOverArenaFloor = () => {
    const halfWidth = AVATAR.w / 2;
    const halfDepth = AVATAR.d / 2;
    const footprintPoints = [
      [player.x, player.z],
      [player.x - halfWidth, player.z - halfDepth],
      [player.x - halfWidth, player.z + halfDepth],
      [player.x + halfWidth, player.z - halfDepth],
      [player.x + halfWidth, player.z + halfDepth],
    ];

    return footprintPoints.some(
      ([x, z]) =>
        x >= -ARENA_HALF &&
        x <= ARENA_HALF &&
        z >= -ARENA_HALF &&
        z <= ARENA_HALF,
    );
  };
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
    // Cracking a trinket holds the otter still.
    const busy = trinkets.busy();
    const { forward, right } = busy ? { forward: 0, right: 0 } : keys.axes();
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
      const swimState = aquatic.swimState();
      const speed =
        swimState === "surface"
          ? me.isFloating()
            ? FLOAT_SWIM_SPEED
            : SURFACE_SWIM_SPEED
          : swimState === "under"
            ? UNDERWATER_SWIM_SPEED
            : SPEED;
      environment.resolveHorizontalMovement(
        player,
        dx * speed * dt,
        dz * speed * dt,
        AVATAR.w / 2,
        AVATAR.h,
      );
      player.ry = lerpAngle(
        player.ry,
        Math.atan2(dx, dz),
        1 - Math.exp(-15 * dt),
      );
    }
    player.x = Math.max(-limit, Math.min(limit, player.x));
    player.z = Math.max(-limit, Math.min(limit, player.z));

    aquatic.stepPhysics(
      player,
      {
        jumpDown: !busy && keys.jump(),
        dive: !busy && keys.dive(),
        rise: !busy && keys.rise(),
      },
      dt,
      isOverArenaFloor(),
    );
    collideWithGround(player, ARENA_HALF);
    if (player.y < FALL_LIMIT_Y) respawn();

    me.root.position.set(player.x, player.y, player.z);
    me.root.rotation.y = player.ry;
    me.update(dt, aquatic.swimModeAt);

    // Third-person camera behind the player, looking at their head.
    camera.position.set(
      player.x + Math.sin(cameraYaw) * CAMERA_DISTANCE,
      player.y + CAMERA_HEIGHT,
      player.z + Math.cos(cameraYaw) * CAMERA_DISTANCE,
    );
    camera.lookAt(player.x, player.y + AVATAR.h, player.z);
    trinkets.update(dt, player, camera);

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
    for (const { character, target } of remotes.values()) {
      const { position, rotation } = character.root;
      position.x += (target.x - position.x) * t;
      position.y += (target.y - position.y) * t;
      position.z += (target.z - position.z) * t;
      rotation.y = lerpAngle(rotation.y, target.ry, t);
      character.update(dt, aquatic.swimModeAt);
    }

    renderer.render(scene, camera);
    chat.update();
  });
}

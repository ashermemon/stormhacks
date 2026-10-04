import * as THREE from "three";
import { connect } from "./net.js";
import { keys } from "./input.js";
import { createAquaticArea } from "./water.js";
import { createEnvironment } from "./environment.js";
import { SUN_DIRECTION } from "./atmosphere.js";
import { loadWorld } from "./world.js";
import { applyToonWater, updateWater } from "./watershader.js";
import { Character, OTTER_COLORS } from "./character.js";
import { createChat } from "./chat.js";
import { trackNames } from "./names.js";
import { setToonLight, toonifyScene, updateWind } from "./toonshading.js";
import { createScenery } from "./scenery.js";
import { createFish } from "./fish.js";
import { createTrinkets } from "./trinkets/trinkets.js";
import { collectSpawnZones } from "./trinkets/spawnZones.js";
import { createMobileControls } from "./mobile.js";

const AVATAR_HEIGHT = 1; // where the camera looks, above the otter's feet
const SPAWN = { x: 12, z: 5 }; // a meadow spot
const SPEED = 4;
const SURFACE_SWIM_SPEED = 2.5;
const FLOAT_SWIM_SPEED = 0.8; // drifting on his back during the SwimSurface float
const UNDERWATER_SWIM_SPEED = 3;
const SEND_INTERVAL = 1 / 30;
const CAMERA_DISTANCE = 8;
const CAMERA_DISTANCE_MIN = 3;
const CAMERA_DISTANCE_MAX = 15;
const CAMERA_HEIGHT = 4;
const ORBIT_SPEED = 2;
const REMOTE_SMOOTHING = 15;
const MOUSE_SENSITIVITY = 0.0025; // radians per pixel
const CAMERA_PITCH_MIN = -0.75;
const CAMERA_PITCH_MAX = 1.05;
const CAMERA_GROUND_CLEARANCE = 0.5; // keep the camera out of the hills

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
  const environment = createEnvironment(scene);
  const world = await loadWorld();
  const { getGroundHeight } = world;
  applyToonWater(world.root);
  scene.add(world.root);
  // Grass, flowers, trees, rocks and seaweed; keeps the spawn meadow open.
  const scenery = await createScenery(scene, world, {
    clearings: [{ x: SPAWN.x, z: SPAWN.z, r: 5 }],
  });

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    600, // past the mountain ring and the farthest clouds
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

  const aquatic = createAquaticArea(getGroundHeight);
  // Trinkets (and fish) use the World.glb spawn-zone meshes; collectSpawnZones hides them.
  const zones = collectSpawnZones(world.root);
  const fish = createFish(scene, 12, { getGroundHeight, zones });

  const canvas = renderer.domElement;
  const lockPointer = () => canvas.requestPointerLock()?.catch?.(() => {});
  const handleJournalToggle = (isOpen) => {
    if (isOpen) document.exitPointerLock();
    else if (!document.body.classList.contains("has-mobile-controls")) lockPointer();
  };

  // Cel-shade everything built so far (the water keeps its own shader); otters are styled in Character.
  setToonLight(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z); // the sun in the sky
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
  const player = {
    x: SPAWN.x,
    y: getGroundHeight(SPAWN.x, SPAWN.z),
    z: SPAWN.z,
    vy: 0,
    ry: 0,
  };

  const chat = createChat({ net, camera, getCharacter: characterOf });

  const trinkets = createTrinkets({
    scene,
    net,
    zones,
    getCharacter: characterOf,
    swimState: aquatic.swimState,
    onJournalToggle: handleJournalToggle,
  });

  let cameraYaw = 0;
  let cameraPitch = 0.25;
  let cameraDistance = CAMERA_DISTANCE;
  // Mouse look: click the game to lock the cursor, then just move the mouse. Esc releases it.
  // Mobile uses on-screen look drag instead of pointer lock.
  const mobile = createMobileControls({
    onLook(dx, dy) {
      const sens = 0.0035;
      cameraYaw -= dx * sens;
      cameraPitch = Math.max(
        CAMERA_PITCH_MIN,
        Math.min(CAMERA_PITCH_MAX, cameraPitch + dy * sens),
      );
    },
    onAction(pressed) {
      if (pressed) trinkets.pressAction();
      else trinkets.releaseAction();
    },
    onJournal: () => trinkets.toggleJournal(),
    onChat: () => chat.open(),
  });

  if (!mobile) {
    canvas.addEventListener("click", lockPointer);
    lockPointer(); // may work straight away thanks to the Play button click
  }
  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas) {
      cameraYaw -= e.movementX * MOUSE_SENSITIVITY;
      cameraPitch = Math.max(
        CAMERA_PITCH_MIN,
        Math.min(CAMERA_PITCH_MAX, cameraPitch + e.movementY * MOUSE_SENSITIVITY),
      );
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    cameraDistance = Math.max(
      CAMERA_DISTANCE_MIN,
      Math.min(CAMERA_DISTANCE_MAX, cameraDistance + e.deltaY * 0.01),
    );
  }, { passive: false });

  let sendTimer = 0;
  const clock = new THREE.Clock();
  let previousPlayerPosition = {
    x: player.x,
    y: player.y,
    z: player.z,
    ry: player.ry,
  };
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    updateWater(clock.elapsedTime);
    updateWind(clock.elapsedTime);
    fish.update(dt, player);

    cameraYaw += keys.orbit() * ORBIT_SPEED * dt;
    const frameStart = { x: player.x, y: player.y, z: player.z };

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
      world.resolveHorizontalMovement(player, dx * speed * dt, dz * speed * dt);
      player.ry = lerpAngle(
        player.ry,
        Math.atan2(dx, dz),
        1 - Math.exp(-15 * dt),
      );
    }
    aquatic.stepPhysics(
      player,
      {
        jumpDown: !busy && keys.jump(),
        dive: !busy && keys.dive(),
        rise: !busy && keys.rise(),
      },
      dt,
    );
    // Cave walls: checked on the whole frame's move (walking, diving, rising, drifting).
    world.resolveColliders(frameStart, player);

    me.root.position.set(player.x, player.y, player.z);
    me.root.rotation.y = player.ry;
    me.update(dt, aquatic.swimModeAt);

    // Smooth remote players before trinkets so held items track current paw poses.
    const t = 1 - Math.exp(-REMOTE_SMOOTHING * dt);
    for (const { character, target } of remotes.values()) {
      const { position, rotation } = character.root;
      position.x += (target.x - position.x) * t;
      position.y += (target.y - position.y) * t;
      position.z += (target.z - position.z) * t;
      rotation.y = lerpAngle(rotation.y, target.ry, t);
      character.update(dt, aquatic.swimModeAt);
    }

    // Third-person camera behind the player, looking at their head.
    const horizontalDistance = cameraDistance * Math.cos(cameraPitch);
    const camX = player.x + Math.sin(cameraYaw) * horizontalDistance;
    const camZ = player.z + Math.cos(cameraYaw) * horizontalDistance;
    camera.position.set(
      camX,
      Math.max(
        player.y + CAMERA_HEIGHT + Math.sin(cameraPitch) * cameraDistance,
        getGroundHeight(camX, camZ) + CAMERA_GROUND_CLEARANCE,
      ),
      camZ,
    );
    camera.lookAt(player.x, player.y + AVATAR_HEIGHT, player.z);
    scenery.update(camera);
    environment.update(camera, clock.elapsedTime);
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

    renderer.render(scene, camera);
    chat.update();
  });
}

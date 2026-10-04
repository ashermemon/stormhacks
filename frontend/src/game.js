import * as THREE from "three";
import { connect } from "./net.js";
import { keys } from "./input.js";
import { createAquaticArea } from "./water.js";
import { createEnvironment } from "./environment.js";
import { loadWorld, WATER_SURFACE_Y } from "./world.js";
import { applyToonWater, updateWater } from "./watershader.js";
import { Character, OTTER_COLORS } from "./character.js";
import { createChat } from "./chat.js";
import { trackNames } from "./names.js";
import { toonifyScene, updateWind } from "./toonshading.js";
import { createScenery } from "./scenery.js";
import { createSeating } from "./seating.js";
import { createCampfire } from "./campfire.js";
import { createWaterfall, WATERFALL } from "./waterfall.js";
import { createFish } from "./fish.js";
import { createBubbles } from "./bubbles.js";
import { loadTrinketModels } from "./trinkets/models.js";
import { createTrinkets } from "./trinkets/trinkets.js";
import { collectSpawnZones } from "./trinkets/spawnZones.js";
import { createMobileControls } from "./mobile.js";
import { HAT_FILES } from "./character.js";

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
// The camera follows an eased point: almost exactly while moving, but gliding for a
// moment after sitting down on or getting up from a bench, where the otter's position
// jumps between the ground and the seat (seating.js).
const CAMERA_FOLLOW = 40;
const CAMERA_SEAT_FOLLOW = 5;
const CAMERA_SEAT_GLIDE_TIME = 0.8; // seconds of gliding after each bench pose change

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

/**
 * Builds everything that doesn't need the server: sky, terrain, water, scenery and fish,
 * plus the renderer. The menu shows it behind itself (menuTour.js) until Play.
 */
export async function loadScene() {
  const scene = new THREE.Scene();
  const environment = createEnvironment(scene);
  const world = await loadWorld();
  const { getGroundHeight } = world;
  applyToonWater(world.root);
  scene.add(world.root);
  // Grass, flowers, trees, rocks and seaweed; keeps the spawn meadow open.
  const scenery = await createScenery(scene, world, {
    clearings: [{ x: SPAWN.x, z: SPAWN.z, r: 5 }],
    camps: [
      { near: SPAWN }, // a short walk from the spawn, looking out at the pond
      { near: { x: -20, z: -12 }, ring: [0, 18], ideal: 0, faceStream: true }, // across the water
    ],
    waterfall: WATERFALL,
  });
  // The waterfall the stream begins from.
  const waterfall = createWaterfall(scene, world);
  // Campfires with log seats around them.
  const campfires = await Promise.all(
    scenery.campsites.map((site) => createCampfire(scene, world, site, { openToward: SPAWN })),
  );

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
  await loadTrinketModels(); // Trinkets.glb, for the fish and the trinkets
  const bubbles = createBubbles(scene); // breath bubbles from fish and underwater otters
  const fish = createFish(scene, 12, { getGroundHeight, zones, bubbles });

  // Cel-shade everything built so far (the water keeps its own shader); otters are styled in Character.
  toonifyScene(scene);

  return { scene, environment, world, scenery, campfires, waterfall, camera, renderer, aquatic, zones, fish, bubbles };
}

/** Connects and starts playing in a scene from loadScene(). */
export async function startGame(view) {
  const { scene, environment, world, scenery, campfires, waterfall, camera, renderer, aquatic, zones, fish, bubbles } = view;
  const { getGroundHeight } = world;
  const canvas = renderer.domElement;
  const lockPointer = () => canvas.requestPointerLock()?.catch?.(() => {});
  let trinkets = null;
  const handleUIToggle = (isOpen) => {
    if (isOpen) {
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (!trinkets?.isUIOpen?.() && !document.body.classList.contains("has-mobile-controls")) {
      lockPointer();
    }
  };

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
    // Sitting down or getting up moves the otter in one step (seating.js); don't glide.
    const pose = state.pose ?? null;
    if (pose !== remote.character.pose) {
      remote.character.root.position.set(state.x, state.y, state.z);
      remote.character.root.rotation.y = state.ry;
      remote.character.setPose(pose);
    }
    const hatId = state.hat ?? "none";

    if (remote.hatId !== hatId) {
      remote.hatId = hatId;

      remote.character.setHat(
        HAT_FILES[hatId] ?? null,
        hatId,
      );
    }
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

    hats: {
      hat: false,
      wizardHat: true,
    },
  };
  const seating = createSeating([...scenery.benches, ...campfires.flatMap((c) => c.seats)], me);
  const cameraFocus = new THREE.Vector3(player.x, player.y, player.z);
  let cameraGlide = 0;
  let lastPose = null;

  const chat = createChat({ net, camera, getCharacter: characterOf });

  trinkets = createTrinkets({
    scene,
    net,
    zones,
    getCharacter: characterOf,
    swimState: aquatic.swimState,
    onJournalToggle: handleUIToggle,
    onShopToggle: handleUIToggle,
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
    canvas.addEventListener("click", () => {
      if (trinkets?.isUIOpen?.()) return;
      lockPointer();
    });
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
  // Tiny FPS readout in the top-left corner, refreshed twice a second.
  const fpsLabel = document.createElement("div");
  fpsLabel.id = "fps";
  document.body.appendChild(fpsLabel);
  let fpsFrames = 0;
  let fpsSince = performance.now();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    fpsFrames++;
    const now = performance.now();
    if (now - fpsSince >= 500) {
      fpsLabel.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsSince))} fps`;
      fpsFrames = 0;
      fpsSince = now;
    }
    updateWater(clock.elapsedTime);
    updateWind(clock.elapsedTime);
    fish.update(dt, player);

    cameraYaw += keys.orbit() * ORBIT_SPEED * dt;
    const frameStart = { x: player.x, y: player.y, z: player.z };

    // Movement relative to camera heading.
    // Cracking a trinket holds the otter still.
    const busy = trinkets.busy();
    const { forward, right } = busy ? { forward: 0, right: 0 } : keys.axes();
    // Benches: walking into one sits you down; a direction or jump gets you up.
    const seated = seating.update(player, {
      moving: forward !== 0 || right !== 0,
      jump: !busy && keys.jump(),
      onLand: aquatic.swimState() === null,
    });
    if (!seated) {
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
    }

    me.root.position.set(player.x, player.y, player.z);
    me.root.rotation.y = player.ry;
    me.update(dt, aquatic.swimModeAt);
    me.breathe(dt, bubbles, aquatic.swimState() === "under" && player.y < WATER_SURFACE_Y - 0.4);

    // Smooth remote players before trinkets so held items track current paw poses.
    const t = 1 - Math.exp(-REMOTE_SMOOTHING * dt);
    for (const { character, target } of remotes.values()) {
      const { position, rotation } = character.root;
      position.x += (target.x - position.x) * t;
      position.y += (target.y - position.y) * t;
      position.z += (target.z - position.z) * t;
      rotation.y = lerpAngle(rotation.y, target.ry, t);
      character.update(dt, aquatic.swimModeAt);
      character.breathe(dt, bubbles, position.y < WATER_SURFACE_Y - 0.6);
    }
    bubbles.update(dt, clock.elapsedTime);

    // Third-person camera behind the player, looking at their head.
    const pose = seating.pose();
    if (pose !== lastPose) {
      cameraGlide = CAMERA_SEAT_GLIDE_TIME;
      lastPose = pose;
    }
    cameraGlide = Math.max(0, cameraGlide - dt);
    const follow = 1 - Math.exp(-(cameraGlide > 0 ? CAMERA_SEAT_FOLLOW : CAMERA_FOLLOW) * dt);
    cameraFocus.x += (player.x - cameraFocus.x) * follow;
    cameraFocus.y += (player.y - cameraFocus.y) * follow;
    cameraFocus.z += (player.z - cameraFocus.z) * follow;
    const horizontalDistance = cameraDistance * Math.cos(cameraPitch);
    const camX = cameraFocus.x + Math.sin(cameraYaw) * horizontalDistance;
    const camZ = cameraFocus.z + Math.cos(cameraYaw) * horizontalDistance;
    camera.position.set(
      camX,
      Math.max(
        cameraFocus.y + CAMERA_HEIGHT + Math.sin(cameraPitch) * cameraDistance,
        getGroundHeight(camX, camZ) + CAMERA_GROUND_CLEARANCE,
      ),
      camZ,
    );
    camera.lookAt(cameraFocus.x, cameraFocus.y + AVATAR_HEIGHT, cameraFocus.z);
    scenery.update(camera);
    environment.update(camera, clock.elapsedTime);
    for (const campfire of campfires) campfire.update(clock.elapsedTime);
    waterfall.update(clock.elapsedTime);
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
      net.sendState({ x: player.x, y: player.y, z: player.z, ry: player.ry, pose: seating.pose(), hat: me.getHatId() });
    }

    renderer.render(scene, camera);
    chat.update();
  });
}
